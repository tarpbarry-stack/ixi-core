"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createServiceQuoteDocument } = require("./IXIFinancialServiceQuoteFactory");
const { createFinancialDocumentByType, listFinancialDocumentFactoryTypes } = require("./IXIFinancialDocumentFactoryRegistry");
const { createInvoiceDocument } = require("./IXIFinancialInvoiceFactory");
const { validateFinancialDocument } = require("./IXIFinancialValidationBridge");
const { createFinancialLifecycleSnapshot } = require("./IXIFinancialLifecycleEngine");
const { isNonEconomicOperationalCapture } = require("./IXIFinancialCommandEngine");

function quote({ accepted = false } = {}) {
  return {
    financialDocumentId: "ifd_servicequote001",
    documentNumber: "SQ-00001",
    financialState: accepted ? "committed" : "draft",
    references: [
      { passportId: "pass_asset_001", role: "asset" },
      { passportId: "pass_entity_001", role: "entity" },
      { passportId: "pass_employee_001", role: "employee" }
    ],
    serviceQuote: {
      schema: "ixi-service-quote-v2",
      identity: { revision: 2, clientRequestId: "quote-request-001" },
      context: { primaryPassportId: "pass_asset_001", entityPassportId: "pass_entity_001", actorPassportId: "pass_employee_001" },
      customer: { name: "Granite Construction" },
      asset: { passportId: "pass_asset_001", label: "CAT 336 Excavator" },
      request: { problem: "Hydraulic leak", customerScope: "Diagnose and repair boom circuit" },
      commercial: { pricingType: "fixed-price", quoteDate: "2026-09-01", validThrough: "2026-09-15", taxAmount: 825 },
      economics: { quotedServiceRevenue: 10000, customerQuoteTotal: 10825, authorizedServiceRevenue: accepted ? 10000 : 0, authorizedTax: accepted ? 825 : 0, authorizedCustomerTotal: accepted ? 10825 : 0 },
      acceptance: accepted ? { status: "accepted", acceptedRevision: 2, acceptedBy: "Pat Customer", method: "digital", acceptedAt: "2026-09-02T12:00:00.000Z" } : { status: "pending" },
      status: accepted ? "accepted" : "sent"
    }
  };
}

test("draft Service Quote is durable operational truth but not revenue", () => {
  assert.ok(listFinancialDocumentFactoryTypes().includes("service-quote"));
  const document = createFinancialDocumentByType({ documentType: "service-quote", input: quote() });
  assert.equal(document.documentType, "service-quote");
  assert.equal(document.totals.total, 10000);
  assert.equal(document.totals.tax, 825);
  assert.equal(document.totals.customerTotal, 10825);
  assert.equal(document.accountingTreatment.economicEvent, false);
  assert.equal(document.accountingTreatment.createsRevenueCommitment, false);
  assert.equal(validateFinancialDocument(document).ok, true);
  assert.equal(isNonEconomicOperationalCapture(document), true);
  const snapshot = createFinancialLifecycleSnapshot({ documents: [document] });
  assert.equal(snapshot.contractedRevenue, 0);
});

test("accepted Service Quote commits subtotal while tax, A/R, and cash remain separate", () => {
  const document = createServiceQuoteDocument(quote({ accepted: true }));
  assert.equal(validateFinancialDocument(document).ok, true);
  assert.equal(document.accountingTreatment.createsRevenueCommitment, true);
  assert.equal(document.accountingTreatment.createsBilledRevenue, false);
  assert.equal(document.accountingTreatment.createsReceivable, false);
  assert.equal(document.accountingTreatment.createsCashEvent, false);
  assert.equal(isNonEconomicOperationalCapture(document), false);
  const invoice = createInvoiceDocument({ financialDocumentId: "ifd_invoice_quote001", financialState: "billed", amount: 4000, sourceFinancialDocumentId: document.financialDocumentId });
  const snapshot = createFinancialLifecycleSnapshot({ documents: [document, invoice] });
  assert.equal(snapshot.contractedRevenue, 10000);
  assert.equal(snapshot.remainingContractedRevenue, 6000);
  assert.equal(snapshot.revenue, 4000);
  assert.equal(snapshot.projectedInflow, 10000);
});

test("Service Quote rejects fake local attachment evidence", () => {
  const document = createServiceQuoteDocument({ ...quote(), attachments: [{ fileName: "quote.pdf", status: "local-pending-upload" }] });
  const result = validateFinancialDocument(document);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /durable uploaded evidence/i);
});
