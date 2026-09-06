"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  rebuildCanonicalSettlement,
  commissions,
} = require("./IXIFinancialSettlementEngine");
const entity = "pass_entity",
  asset = "pass_asset",
  refs = [
    { role: "entity", passportId: entity },
    { role: "asset", passportId: asset },
  ];
function fixture() {
  const sale = {
    financialDocumentId: "invoice",
    documentType: "invoice",
    totals: { total: 100000 },
    references: refs,
    metadata: { assetSale: true },
  };
  const financialDocument = {
    financialDocumentId: "settlement",
    documentType: "settlement",
    sourceFinancialDocumentId: "invoice",
    assetSettlement: {
      schema: "ixi-asset-settlement-v2",
      identity: {
        settlementId: "settlement",
        financialDocumentId: "settlement",
        dealId: "deal",
      },
      context: { entityPassportId: entity, assetPassportId: asset },
      references: { saleId: "invoice" },
      projection: { sellingCosts: 1000 },
      liabilities: [],
      disbursements: [],
      expenseAdjustments: [],
      reimbursements: [],
      priorDistributions: [],
      retainedProceeds: 0,
      returnCapitalFirst: true,
      controls: {},
    },
  };
  const docs = [
    sale,
    {
      financialDocumentId: "acq",
      documentType: "asset-acquisition",
      references: refs,
      assetAcquisition: {
        context: { entityPassportId: entity },
        acquisition: { currentAcquisitionBasis: 70000 },
        makeReady: { actualTotal: 5000 },
        ownership: {
          owners: [
            {
              ownerId: "owner",
              partyLabel: "Owner",
              settlementSharePercent: 100,
              profitSharePercent: 100,
              lossSharePercent: 100,
              initialContribution: 75000,
            },
          ],
        },
      },
    },
    {
      financialDocumentId: "paid",
      documentType: "payment",
      financialState: "paid",
      paymentDirection: "inflow",
      sourceFinancialDocumentId: "invoice",
      totals: { total: 100000 },
      references: refs,
    },
    {
      financialDocumentId: "draft",
      documentType: "expense",
      financialState: "draft",
      totals: { total: 9999 },
      references: refs,
    },
    {
      financialDocumentId: "expense",
      documentType: "expense",
      financialState: "incurred",
      totals: { total: 4000 },
      references: refs,
    },
  ];
  return { sale, financialDocument, docs };
}
test("IX Core rebuilds Settlement economics and waterfall from canonical documents", () => {
  const f = fixture(),
    result = rebuildCanonicalSettlement({
      financialDocument: f.financialDocument,
      saleInvoice: f.sale,
      documents: f.docs,
    }),
    record = result.assetSettlement;
  assert.equal(record.controls.canonicalCalculation, true);
  assert.equal(record.projection.collected, 100000);
  assert.equal(record.projection.postAcquisitionCosts, 4000);
  assert.equal(
    record.projection.expenseLedger.find(
      (x) => x.financialDocumentId === "draft",
    ).included,
    false,
  );
  assert.equal(record.waterfall.balanced, true);
});
test("IX Core commission math supports percentage fixed and bounties", () => {
  const rows = commissions(
    [
      { calculationMethod: "sale-price", ratePercent: 2 },
      { calculationMethod: "fixed", fixedAmount: 500 },
      {
        calculationMethod: "above-target",
        targetAmount: 90000,
        ratePercent: 10,
      },
    ],
    { salePrice: 100000, grossProfit: 1, netProfit: 1 },
  );
  assert.deepEqual(
    rows.map((x) => x.finalAmount),
    [2000, 500, 1000],
  );
});
