"use strict";

const { BatchGetCommand } = require("@aws-sdk/lib-dynamodb");
const { setTimeout: delay } = require("node:timers/promises");

// Collections use indexed IDs, never a scan. Bound both request size and fan-out.
// No completed records survive this call; every read asks for current data.
function createFinancialBatchReader({ client, tableName, wait = delay, random = Math.random }) {
  return async function getCurrentDocumentRecords(documentIds) {
    const ids = [...new Set(documentIds.map(id => String(id ?? "").trim()).filter(Boolean))];
    const batches = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
      batches.push(ids.slice(offset, offset + 100).map(id => ({ PK: `FIN#${id}`, SK: "CURRENT" })));
    }
    const records = new Map();
    let nextBatch = 0;
    let failure;
    async function worker() {
      while (!failure && nextBatch < batches.length) {
        let keys = batches[nextBatch++];
        const allowedKeys = new Set(keys.map(key => key.PK));
        try {
          for (let attempt = 0; keys.length; attempt++) {
            const response = await client.send(new BatchGetCommand({
              RequestItems: { [tableName]: { Keys: keys, ConsistentRead: true } }
            }));
            for (const item of response.Responses?.[tableName] || []) {
              if (item.SK === "CURRENT" && allowedKeys.has(item.PK)) records.set(item.PK, item.record || null);
            }
            keys = response.UnprocessedKeys?.[tableName]?.Keys || [];
            if (!keys.length) break;
            if (attempt >= 4) {
              throw Object.assign(new Error("Financial collection could not be read completely; please retry."), {
                code: "FINANCIAL_BATCH_READ_INCOMPLETE"
              });
            }
            // Retry only the keys DynamoDB did not process, never the whole collection.
            await wait(Math.round(50 * (2 ** attempt) * (1 + random())));
          }
        } catch (error) {
          failure = error;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, batches.length) }, () => worker()));
    if (failure) throw failure; // Never publish a partial financial balance.
    return ids.map(id => records.get(`FIN#${id}`) || null);
  };
}

module.exports = { createFinancialBatchReader };
