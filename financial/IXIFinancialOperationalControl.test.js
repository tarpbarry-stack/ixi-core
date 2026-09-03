"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCollectionDocument, createSettlementDocument } = require("./IXIFinancialOperationalControlFactory");
const { validateFinancialDocument } = require("./IXIFinancialValidationBridge");
const { IXI_FINANCIAL_ACTIONS, IXI_FINANCIAL_ROLES, ROLE_PERMISSIONS } = require("./IXIFinancialPermissionEngine");
const providerService = require("./IXIFinancialProviderService");
const { assertCollectionControlSource, assertSettlementControlSource, assertReceivablesSettlementAvailable, assertOwnerSettlementPaymentAvailable } = require("./IXIFinancialCommandEngine");

const entityPassportId = "pass_entity";
const actorPassportId = "pass_actor";
const references = [{ role: "entity", passportId: entityPassportId }];

function collection() {
  return createCollectionDocument({
    sourceFinancialDocumentId: "ifd_invoice001",
    entityPassportId,
    actorPassportId,
    references,
    collectionCase: {
      receivable: { invoiceId: "ifd_invoice001", originalAmount: 100, openBalance: 80 },
      customer: { label: "Acme" },
      status: "open"
    }
  });
}

function settlement() {
  return createSettlementDocument({
    sourceFinancialDocumentId: "ifd_sale001",
    entityPassportId,
    actorPassportId,
    references,
    assetSettlement: {
      context: { assetPassportId: "pass_asset" },
      references: { saleId: "ifd_sale001" },
      waterfall: { shareTotal: 100, balanced: true, totalFinalDue: 100, owners: [{ ownerId: "owner_1", label: "Owner", finalDue: 100, balanceDue: 100 }] },
      controls: { approvalNote: "Reviewed and approved" },
      status: "ready",
      paymentStatus: "unpaid"
    }
  });
}

test("Collection and Settlement controls are canonical, deterministic, and non-economic", () => {
  const firstCollection = collection(), replayCollection = collection(), firstSettlement = settlement(), replaySettlement = settlement();
  assert.equal(validateFinancialDocument(firstCollection).ok, true);
  assert.equal(validateFinancialDocument(firstSettlement).ok, true);
  assert.equal(firstCollection.financialDocumentId, replayCollection.financialDocumentId);
  assert.equal(firstSettlement.financialDocumentId, replaySettlement.financialDocumentId);
  assert.equal(firstCollection.accountingTreatment.economicEvent, false);
  assert.equal(firstSettlement.accountingTreatment.economicEvent, false);
});

test("Collection and Settlement permissions preserve approval segregation", () => {
  assert.equal(ROLE_PERMISSIONS[IXI_FINANCIAL_ROLES.MANAGER].includes(IXI_FINANCIAL_ACTIONS.MANAGE_COLLECTIONS), true);
  assert.equal(ROLE_PERMISSIONS[IXI_FINANCIAL_ROLES.ACCOUNTING].includes(IXI_FINANCIAL_ACTIONS.PREPARE_SETTLEMENT), true);
  assert.equal(ROLE_PERMISSIONS[IXI_FINANCIAL_ROLES.ACCOUNTING].includes(IXI_FINANCIAL_ACTIONS.APPROVE_SETTLEMENT), false);
  assert.equal(ROLE_PERMISSIONS[IXI_FINANCIAL_ROLES.CONTROLLER].includes(IXI_FINANCIAL_ACTIONS.APPROVE_SETTLEMENT), true);
});

test("server controls enforce canonical source lineage and A/R open balance", async () => {
  const get = providerService.getDocument, list = providerService.listDocumentsByPassport;
  providerService.getDocument = async ({ financialDocumentId }) => ({ ok: true, data: { record: { financialDocument: financialDocumentId === "ifd_sale001" ? { financialDocumentId, documentType: "invoice", financialState: "receivable", metadata: { assetSale: true }, totals: { total: 200 }, references } : { financialDocumentId, documentType: "invoice", financialState: "receivable", totals: { total: 100 }, references } } } });
  providerService.listDocumentsByPassport = async () => ({ ok: true, data: { documents: [{ financialDocument: { documentType: "payment", financialState: "received", paymentDirection: "inflow", sourceFinancialDocumentId: "ifd_invoice001", totals: { total: 80 }, metadata: { arPayment: true } } }] } });
  try {
    await assertCollectionControlSource({ financialDocument: collection(), entityPassportId });
    await assertSettlementControlSource({ financialDocument: settlement(), entityPassportId });
    await assert.rejects(() => assertReceivablesSettlementAvailable({ entityPassportId, financialDocument: { documentType: "payment", financialState: "received", paymentDirection: "inflow", sourceFinancialDocumentId: "ifd_invoice001", totals: { total: 25 }, metadata: { arPayment: true } } }), /exceeds the canonical open Invoice balance/u);
  } finally { providerService.getDocument = get; providerService.listDocumentsByPassport = list; }
});

test("owner payouts require approval and cannot exceed canonical entitlement", async () => {
  const get = providerService.getDocument, list = providerService.listDocumentsByPassport;
  providerService.getDocument = async () => ({ ok: true, data: { record: { financialDocument: { ...settlement(), assetSettlement: { ...settlement().assetSettlement, status: "approved", controls: { approvedById: actorPassportId, approvedAt: new Date().toISOString(), approvalNote: "Approved distribution" } } } } } });
  providerService.listDocumentsByPassport = async () => ({ ok: true, data: { documents: [{ financialDocument: { documentType: "payment", financialState: "paid", paymentDirection: "outflow", sourceFinancialDocumentId: settlement().financialDocumentId, totals: { total: 90 }, metadata: { settlementOwnerPayment: true, ownerId: "owner_1" } } }] } });
  try {
    await assert.rejects(() => assertOwnerSettlementPaymentAvailable({ entityPassportId, financialDocument: { documentType: "payment", financialState: "paid", paymentDirection: "outflow", sourceFinancialDocumentId: settlement().financialDocumentId, totals: { total: 15 }, metadata: { settlementOwnerPayment: true, ownerId: "owner_1" } } }), /exceeds the canonical unpaid entitlement/u);
  } finally { providerService.getDocument = get; providerService.listDocumentsByPassport = list; }
});
