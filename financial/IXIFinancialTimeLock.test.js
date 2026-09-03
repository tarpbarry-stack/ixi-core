"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  activeTimeEmployeeKey,
  createActiveTimeLockPut,
  createActiveTimeLockDelete
} = require("./IXIFinancialDynamoStore");

function record(status = "running", employeePassportId = "pass_employee_1") {
  return {
    financialDocument: {
      financialDocumentId: "ifd_time_1",
      documentType: "time-entry",
      timeEntry: {
        status,
        context: { employeePassportId }
      }
    }
  };
}

test("active TIME statuses resolve one employee lock key", () => {
  assert.equal(activeTimeEmployeeKey(record("running")), "pass_employee_1");
  assert.equal(activeTimeEmployeeKey(record("paused")), "pass_employee_1");
  assert.equal(activeTimeEmployeeKey(record("stopped")), "pass_employee_1");
  assert.equal(activeTimeEmployeeKey(record("recorded")), "");
  assert.equal(activeTimeEmployeeKey({ financialDocument: { documentType: "expense" } }), "");
});

test("TIME start lock is an atomic create-only condition", () => {
  const item = createActiveTimeLockPut({ employeeKey: "pass_employee_1", financialDocumentId: "ifd_time_1", updatedAt: "2026-09-03T00:00:00.000Z" });
  assert.equal(item.Put.Item.PK, "TIME-ACTIVE#pass_employee_1");
  assert.equal(item.Put.Item.financialDocumentId, "ifd_time_1");
  assert.equal(item.Put.ConditionExpression, "attribute_not_exists(PK)");
});

test("TIME transition can retain its own lock and completion can release only its lock", () => {
  const retained = createActiveTimeLockPut({ employeeKey: "pass_employee_1", financialDocumentId: "ifd_time_1", allowSameDocument: true });
  assert.match(retained.Put.ConditionExpression, /financialDocumentId = :financialDocumentId/u);
  assert.equal(retained.Put.ExpressionAttributeValues[":financialDocumentId"], "ifd_time_1");

  const released = createActiveTimeLockDelete({ employeeKey: "pass_employee_1", financialDocumentId: "ifd_time_1" });
  assert.match(released.Delete.ConditionExpression, /financialDocumentId = :financialDocumentId/u);
  assert.equal(released.Delete.ExpressionAttributeValues[":financialDocumentId"], "ifd_time_1");
});
