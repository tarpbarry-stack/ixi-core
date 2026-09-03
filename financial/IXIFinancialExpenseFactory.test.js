"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createExpenseDocument
} = require("./IXIFinancialExpenseFactory");

const {
  validateFinancialDocument
} = require("./IXIFinancialValidationBridge");

function createCommercialExpense(overrides = {}) {
  return createExpenseDocument({
    financialDocumentId: "ifd_expensecommercial001",
    amount: 486.72,
    description: "Hydraulic fittings",
    vendor: "Hydraulic Supply Co.",
    category: "parts-fittings",
    expenseDate: "2026-09-03",
    paymentMethod: "company-card",
    referenceNumber: "RCPT-7741",
    notes: "Emergency field repair",
    references: [
      { passportId: "IXIMJHQ8BV", role: "asset", label: "John Deere 310L" },
      { passportId: "IXIENTITY001", role: "entity", label: "Machine King" }
    ],
    relationships: {
      workOrderId: "ifd_workorder001",
      workOrderNumber: "WO-C7D785ED"
    },
    metadata: {
      clientRequestId: "EXP-client-request-001"
    },
    ...overrides
  });
}

test("Expense factory preserves field capture as one canonical financial fact", () => {
  const document = createCommercialExpense();

  assert.equal(document.documentType, "expense");
  assert.equal(document.documentNumber, "EXP-RCIAL001");
  assert.equal(document.financialState, "incurred");
  assert.equal(document.occurredAt, "2026-09-03T00:00:00.000Z");
  assert.equal(document.totals.total, 486.72);
  assert.equal(document.lines[0].amount, 486.72);
  assert.equal(document.expense.vendor, "Hydraulic Supply Co.");
  assert.equal(document.expense.category, "parts-fittings");
  assert.equal(document.externalReference, "RCPT-7741");
  assert.equal(document.memo, "Emergency field repair");
  assert.equal(document.relationships.workOrderNumber, "WO-C7D785ED");
  assert.deepEqual(
    document.references.map(reference => reference.passportId),
    ["IXIMJHQ8BV", "IXIENTITY001"]
  );
  assert.equal(validateFinancialDocument(document).ok, true);
});

test("MY MONEY produces an explicit reimbursement obligation", () => {
  const document = createCommercialExpense({
    paymentMethod: "my-money",
    employeePassportId: "IXIEMPLOYEE001",
    reimbursement: {
      required: true,
      employeePassportId: "IXIEMPLOYEE001",
      status: "owed"
    }
  });

  assert.equal(document.reimbursement.required, true);
  assert.equal(document.reimbursement.employeePassportId, "IXIEMPLOYEE001");
  assert.equal(document.reimbursement.amount, 486.72);
  assert.equal(document.reimbursement.status, "owed");
  assert.equal(validateFinancialDocument(document).ok, true);
});

test("server validation rejects incomplete or non-economic Expenses", () => {
  const invalid = createCommercialExpense({
    amount: 0,
    vendor: "",
    category: "",
    paymentMethod: ""
  });
  const validation = validateFinancialDocument(invalid);

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(" "), /vendor is required/u);
  assert.match(validation.errors.join(" "), /category is required/u);
  assert.match(validation.errors.join(" "), /paymentMethod is invalid/u);
  assert.match(validation.errors.join(" "), /amount must be greater than zero/u);
});

test("receipt-required Expense needs a durable uploaded receipt", () => {
  const invalid = createCommercialExpense({
    receiptRequired: true,
    attachments: [{
      fileName: "receipt.jpg",
      mimeType: "image/jpeg",
      size: 1200,
      status: "local-pending-upload"
    }]
  });
  const valid = createCommercialExpense({
    receiptRequired: true,
    attachments: [{
      fileName: "receipt.jpg",
      mimeType: "image/jpeg",
      size: 1200,
      status: "uploaded",
      storageKey: "financial/receipts/receipt.jpg"
    }]
  });

  assert.equal(invalid.expense.receiptStatus, "pending-upload");
  assert.equal(validateFinancialDocument(invalid).ok, false);
  assert.equal(valid.expense.receiptStatus, "attached");
  assert.equal(validateFinancialDocument(valid).ok, true);
});
