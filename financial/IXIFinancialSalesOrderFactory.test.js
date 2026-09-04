"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createFinancialDocumentByType, listFinancialDocumentFactoryTypes } = require("./IXIFinancialDocumentFactoryRegistry");
const { validateFinancialDocument } = require("./IXIFinancialValidationBridge");

function input(overrides = {}) {
  return {
    financialDocumentId: "ifd_order001",
    documentNumber: "SO-1001",
    financialState: "committed",
    references: [
      { passportId: "pass_machine", role: "asset" },
      { passportId: "pass_entity", role: "entity" },
      { passportId: "pass_actor", role: "employee" }
    ],
    salesOrder: {
      schema: "ixi-equipment-sales-order-v1",
      identity: { revision: 1, clientRequestId: "order-request-001" },
      context: { primaryPassportId: "pass_machine", entityPassportId: "pass_entity", actorPassportId: "pass_actor" },
      customer: { name: "ABC Contractors", email: "buyer@example.com" },
      asset: { passportId: "pass_machine", label: "2022 CAT 336", serialNumber: "CAT00336" },
      commercial: { orderDate: "2026-09-04", paymentTerms: "Due before release" },
      totals: { subtotal: 185000, tax: 0, freight: 2750, fees: 250, tradeAllowance: 80000, deposit: 10000, total: 108000, balanceDue: 98000 },
      termsDocument: { documentId: "terms-texas-v4", version: "4", sha256: "a".repeat(64), url: "https://example.com/terms.pdf", pageCount: 2 },
      signing: { status: "not-sent", tokenVersion: 0, signedAt: "", signedPackageHash: "" },
      related: { quoteId: "ifd_quote001", invoiceId: "", soldSheetId: "", settlementId: "" },
      status: "draft",
      ...overrides
    }
  };
}

test("equipment Sales Order is registered, non-accounting, and retains customer totals", () => {
  assert.ok(listFinancialDocumentFactoryTypes().includes("sales-order"));
  const document = createFinancialDocumentByType({ documentType: "sales-order", input: input() });
  const validation = validateFinancialDocument(document);
  assert.equal(validation.ok, true, validation.errors.join("\n"));
  assert.equal(document.salesOrder.totals.total, 108000);
  assert.equal(document.salesOrder.totals.balanceDue, 98000);
  assert.equal(document.accountingTreatment.createsReceivable, false);
});

test("equipment Sales Order rejects forged totals", () => {
  const document = createFinancialDocumentByType({ documentType: "sales-order", input: input() });
  document.salesOrder.totals.total = 500;
  const validation = validateFinancialDocument(document);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes("sales order customer total is invalid."));
});
