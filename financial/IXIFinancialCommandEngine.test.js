"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  hasEconomicValue,
  isNonEconomicOperationalWorkOrder,
  executeCreateFinancialDocumentCommand
} = require("./IXIFinancialCommandEngine");


test("zero-value Work Orders remain operational during accounting close", () => {
  const workOrder = {
    documentType: "work-order",
    financialState: "incurred",
    lines: [],
    totals: {
      subtotal: 0,
      total: 0
    }
  };

  assert.equal(
    hasEconomicValue(workOrder),
    false
  );

  assert.equal(
    isNonEconomicOperationalWorkOrder(workOrder),
    true
  );
});


test("valued Work Orders remain subject to accounting-period control", () => {
  const workOrder = {
    documentType: "work-order",
    lines: [
      {
        amount: 125
      }
    ],
    totals: {
      total: 125
    }
  };

  assert.equal(
    hasEconomicValue(workOrder),
    true
  );

  assert.equal(
    isNonEconomicOperationalWorkOrder(workOrder),
    false
  );
});


test("zero-value accounting documents do not bypass period control", () => {
  const expense = {
    documentType: "expense",
    lines: [],
    totals: {
      total: 0
    }
  };

  assert.equal(
    isNonEconomicOperationalWorkOrder(expense),
    false
  );
});

test("generic create cannot bypass dedicated accounting-control commands", async () => {
  for (const documentType of ["period-close", "period-reopen", "posting-rule"]) {
    const result = await executeCreateFinancialDocumentCommand({ documentType });
    assert.equal(result.ok, false);
    assert.equal(result.stage, "period-control");
    assert.equal(result.errors[0].name, "IXIFinancialAccountingControlCommandRequiredError");
  }
});
