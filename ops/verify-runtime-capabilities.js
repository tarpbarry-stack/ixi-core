#!/usr/bin/env node
"use strict";
const crypto = require("node:crypto");
const { DynamoDBClient, TransactWriteItemsCommand, DescribeContinuousBackupsCommand } = require("@aws-sdk/client-dynamodb");

async function verifyAtomicTreasuryAccess(client) {
  try {
    await client.send(new TransactWriteItemsCommand({
      ClientRequestToken: crypto.randomUUID(),
      TransactItems: [{ Update: {
        TableName: "ixi-financial-v1",
        Key: { PK: { S: "IXI-RELEASE-PERMISSION-PROBE" }, SK: { S: "NEVER-WRITTEN" } },
        UpdateExpression: "SET #probe = :value",
        ExpressionAttributeNames: { "#probe": "releasePermissionProbe" },
        ExpressionAttributeValues: { ":value": { BOOL: true } },
        // This is false for every possible item, so the probe cannot write.
        ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(PK)"
      }}]
    }));
    throw new Error("An impossible DynamoDB condition unexpectedly succeeded");
  } catch (error) {
    if (error.name !== "TransactionCanceledException" ||
        error.CancellationReasons?.[0]?.Code !== "ConditionalCheckFailed") throw error;
    return { ok: true, atomicTreasuryAuthorized: true, writePerformed: false };
  }
}
async function verifyRuntimeCapabilities(client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-2", maxAttempts: 1
})) {
  try {
    const recovery = [];
    for (const table of ["ixi-financial-v1", "IXIFreight", "IXITickets"]) {
      const response = await client.send(new DescribeContinuousBackupsCommand({ TableName: table }));
      const state = response.ContinuousBackupsDescription?.PointInTimeRecoveryDescription;
      if (state?.PointInTimeRecoveryStatus !== "ENABLED" || state.RecoveryPeriodInDays !== 35) {
        throw new Error("Required 35-day point-in-time recovery is not enabled: " + table);
      }
      recovery.push({ table, status: state.PointInTimeRecoveryStatus, days: state.RecoveryPeriodInDays });
    }
    return { ...(await verifyAtomicTreasuryAccess(client)), recovery };
  } finally {
    client.destroy();
  }
}
if (require.main === module) {
  verifyRuntimeCapabilities().then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.name + ": " + error.message); process.exitCode = 1; });
}
module.exports = { verifyAtomicTreasuryAccess, verifyRuntimeCapabilities };
