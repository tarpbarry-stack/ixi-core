"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFinancialDocumentByType, listFinancialDocumentFactoryTypes } = require("./IXIFinancialDocumentFactoryRegistry");
const { validateFinancialDocument } = require("./IXIFinancialValidationBridge");

const TYPES = ["asset-acquisition", "rental", "quote", "settlement", "material-usage", "service-order", "purchase-requisition", "collection", "receipt", "reconciliation", "posting-rule", "technology-work-order", "freight-order"];

test("every TRAN$ACT operational document type has a valid durable factory", () => {
  const supported = new Set(listFinancialDocumentFactoryTypes());
  for (const documentType of TYPES) {
    assert.equal(supported.has(documentType), true, documentType);
    const document = createFinancialDocumentByType({ documentType, input: { financialState: "draft", currency: "USD", amount: 125.5, description: `${documentType} proof`, references: [{ passportId: "IXP_MACHINE_001", role: "asset" }], domainPayload: { preserved: true } } });
    const validation = validateFinancialDocument(document);
    assert.equal(validation.ok, true, `${documentType}: ${validation.errors.join(", ")}`);
    assert.equal(document.totals.total, 125.5);
    assert.equal(document.domainPayload.preserved, true);
  }
});

test("work-order factory preserves the reopenable operational record", () => {
  const document = createFinancialDocumentByType({ documentType: "work-order", input: { references: [{ passportId: "IXP_MACHINE_001", role: "asset" }], workOrder: { identity: { clientRequestId: "request-work-1" }, work: { status: "in-progress", priority: "high" } } } });
  assert.equal(document.workOrder.identity.workOrderId, document.financialDocumentId);
  assert.equal(document.workOrder.identity.number, document.financialDocumentId);
  assert.equal(document.priority, "high");
});
