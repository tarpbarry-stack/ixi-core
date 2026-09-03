"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createBillDocument } = require("./IXIFinancialBillFactory");
const { validateFinancialDocument } = require("./IXIFinancialValidationBridge");
const { createFinancialLifecycleSnapshot } = require("./IXIFinancialLifecycleEngine");

function billRecord(approval = { status: "pending" }) {
  return {
    schema: "ixi-bill-record-v2",
    identity: { invoiceNumber: "HS-78451", clientRequestId: "BILL-REQ-1" },
    context: { primaryPassportId: "PASS-CAT336", entityPassportId: "PASS-IXI", employeePassportId: "PASS-MIKE" },
    bill: { vendorLabel: "Hydraulic Supply Co.", description: "Hydraulic repair parts", category: "parts", amount: 482.17, currency: "USD", invoiceDate: "2026-09-03", dueDate: "2026-10-03", attachments: [] },
    purchaseMatch: { status: "n/a", purchaseOrderNumber: "", variance: 0 },
    approval,
    payment: { status: "unpaid", amountPaid: 0 },
    status: approval.status === "approved" ? "approved" : "submitted",
    documents: [], timeline: [], audit: { version: 1 }
  };
}

function input(overrides = {}) {
  const record = overrides.billRecord || billRecord();
  return {
    financialDocumentId: "ifd_billcommercial001",
    documentNumber: "HS-78451",
    invoiceNumber: "HS-78451",
    invoiceFingerprint: "pass-ixi|hydraulic-supply-co|hs-78451",
    sourceDocumentId: "pass-ixi|hydraulic-supply-co|hs-78451",
    vendorName: "Hydraulic Supply Co.",
    occurredAt: "2026-09-03T12:00:00.000Z",
    dueDate: "2026-10-03",
    amount: 482.17,
    description: "Hydraulic repair parts",
    category: "parts",
    financialState: "submitted",
    references: [
      { passportId: "PASS-CAT336", role: "asset" },
      { passportId: "PASS-IXI", role: "entity" },
      { passportId: "PASS-MIKE", role: "employee" }
    ],
    billRecord: record,
    attachments: [],
    ...overrides
  };
}

test("Bill capture is durable but does not create expense, payable, or cash before approval", () => {
  const document = createBillDocument(input());
  const validation = validateFinancialDocument(document);
  const snapshot = createFinancialLifecycleSnapshot({ documents: [document] });
  assert.equal(validation.ok, true, validation.errors.join(" "));
  assert.equal(document.billRecord.identity.billDocumentId, document.financialDocumentId);
  assert.equal(document.lines[0].amount, 482.17);
  assert.equal(document.accountingTreatment.economicEvent, false);
  assert.equal(snapshot.incurredCost, 0);
  assert.equal(snapshot.unpaid, 0);
  assert.equal(snapshot.paid, 0);
});

test("Approved Bill creates one incurred vendor obligation and never creates cash", () => {
  const approvedAt = "2026-09-03T15:00:00.000Z";
  const record = billRecord({ status: "approved", approvedById: "PASS-CONTROLLER", approvedByLabel: "Controller", approvedAt });
  const document = createBillDocument(input({ billRecord: record, financialState: "billed" }));
  const validation = validateFinancialDocument(document);
  const snapshot = createFinancialLifecycleSnapshot({ documents: [document] });
  assert.equal(validation.ok, true, validation.errors.join(" "));
  assert.equal(document.accountingTreatment.createsIncurredExpense, true);
  assert.equal(document.accountingTreatment.createsPayable, true);
  assert.equal(document.accountingTreatment.createsCashEvent, false);
  assert.equal(snapshot.incurredCost, 482.17);
  assert.equal(snapshot.unpaid, 482.17);
  assert.equal(snapshot.paid, 0);
});

test("Bill validation rejects premature recognition and browser-only invoice files", () => {
  const premature = createBillDocument(input({ financialState: "billed" }));
  const pendingFile = createBillDocument(input({ attachments: [{ fileName: "invoice.pdf", status: "local-pending-upload" }] }));
  assert.equal(validateFinancialDocument(premature).ok, false);
  assert.match(validateFinancialDocument(premature).errors.join(" "), /unapproved bill|approval state/i);
  assert.equal(validateFinancialDocument(pendingFile).ok, false);
  assert.match(validateFinancialDocument(pendingFile).errors.join(" "), /durable uploaded evidence/i);
});
