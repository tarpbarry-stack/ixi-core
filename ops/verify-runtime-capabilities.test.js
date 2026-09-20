"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyRuntimeCapabilities } = require("./verify-runtime-capabilities");
function client({ days = 35, status = "ENABLED", probeError, unexpectedSuccess = false, batchDenied = false, authorityDenied = false } = {}) {
  const calls = [];
  return {
    calls, destroyed: false,
    async send(command) {
      calls.push(command);
      if (command.constructor.name === "DescribeContinuousBackupsCommand") {
        return { ContinuousBackupsDescription: { PointInTimeRecoveryDescription: {
          PointInTimeRecoveryStatus: status, RecoveryPeriodInDays: days
        } } };
      }
      if (command.constructor.name === "BatchGetItemCommand") {
        const table = Object.keys(command.input.RequestItems)[0];
        assert.ok(["ixi-financial-v1", "ixi-aos-authority-v1"].includes(table));
        assert.equal(command.input.RequestItems[table].ConsistentRead, true);
        if (authorityDenied && table === "ixi-aos-authority-v1") throw new Error("authority batch read denied");
        if (batchDenied) throw Object.assign(new Error("batch read denied"), { name: "AccessDeniedException" });
        return {};
      }
      const update = command.input.TransactItems[0].Update;
      assert.equal(update.ConditionExpression, "attribute_exists(PK) AND attribute_not_exists(PK)");
      if (unexpectedSuccess) return {};
      throw probeError || Object.assign(new Error("Expected no-write condition failure"), {
        name: "TransactionCanceledException", CancellationReasons: [{ Code: "ConditionalCheckFailed" }]
      });
    },
    destroy() { this.destroyed = true; }
  };
}
test("release capabilities require recoverable business tables and prove atomic access without a write", async () => {
  const connection = client();
  const result = await verifyRuntimeCapabilities(connection);
  assert.equal(result.ok, true);
  assert.equal(result.financialBatchReadAuthorized, true);
  assert.equal(result.authorityBatchReadAuthorized, true);
  assert.equal(result.writePerformed, false);
  assert.deepEqual(result.recovery.map(item => item.table), ["ixi-financial-v1", "IXIFreight", "IXITickets"]);
  assert.equal(connection.calls.length, 6);
  assert.equal(connection.destroyed, true);
});
test("missing or short recovery retention blocks release before the Treasury probe", async () => {
  for (const options of [{ days: 7 }, { status: "DISABLED" }]) {
    const connection = client(options);
    await assert.rejects(verifyRuntimeCapabilities(connection), /35-day point-in-time recovery/);
    assert.equal(connection.calls.length, 1);
    assert.equal(connection.destroyed, true);
  }
});
test("denied authorization and unexpected transaction success cannot certify a release", async () => {
  for (const options of [{ probeError: Object.assign(new Error("denied"), { name: "AccessDeniedException" }) },
    { unexpectedSuccess: true }]) {
    const connection = client(options);
    await assert.rejects(verifyRuntimeCapabilities(connection), /denied|impossible DynamoDB condition/);
    assert.equal(connection.destroyed, true);
  }
});

test("release blocks before the Treasury probe when batch read permission is absent", async () => {
  const connection = client({ batchDenied: true });
  await assert.rejects(verifyRuntimeCapabilities(connection), /batch read denied/);
  assert.equal(connection.calls.length, 4);
  assert.equal(connection.destroyed, true);
});

test("missing authority batch permission blocks release before service shutdown or Treasury probe", async () => {
  const connection = client({ authorityDenied: true });
  await assert.rejects(verifyRuntimeCapabilities(connection), /authority batch read denied/);
  assert.equal(connection.calls.length, 5);
  assert.equal(connection.destroyed, true);
});
