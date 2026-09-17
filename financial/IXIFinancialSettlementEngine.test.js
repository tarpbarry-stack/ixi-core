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


test("customer credits reserve refund cash without erasing prior owner distributions", () => {
  const { sale, financialDocument, docs } = fixture();
  financialDocument.assetSettlement.priorDistributions = [{ amount: 10000 }];
  docs.push({ financialDocumentId: "credit", documentType: "credit", creditType: "revenue-credit", financialState: "incurred", sourceFinancialDocumentId: "invoice", totals: { total: 5000 }, references: refs });
  const result = rebuildCanonicalSettlement({ financialDocument, saleInvoice: sale, documents: docs });
  const projection = result.assetSettlement.projection;
  assert.equal(projection.customerRefundLiability, 5000);
  assert.equal(projection.priorDistributions, 10000);
  assert.equal(projection.netSalePrice, 95000);
});

test("trade sale earns gross consideration while settlement only distributes actual cash", () => {
  const f = fixture();
  f.sale.totals.total = 85000;
  f.sale.metadata.trades = [{ allowance: 20619 }, { allowance: 20619 }];
  f.docs.find(doc => doc.financialDocumentId === "paid").totals.total = 85000;
  const result = rebuildCanonicalSettlement({ financialDocument: f.financialDocument, saleInvoice: f.sale, documents: f.docs }).assetSettlement;
  assert.equal(result.projection.salePrice, 126238);
  assert.equal(result.projection.collected, 85000);
  assert.equal(result.projection.buyerBalance, 0);
});

test("an omitted-trade correction preserves gross sale proceeds without creating a customer refund", () => {
  const f = fixture();
  f.sale.totals.total = 75000;
  f.docs.find(doc => doc.financialDocumentId === "paid").totals.total = 10000;
  f.docs.push({ financialDocumentId: "trade-credit", documentType: "credit", creditType: "trade-credit", financialState: "incurred", sourceFinancialDocumentId: "invoice", totals: { total: 65000 }, references: refs });
  const projection = rebuildCanonicalSettlement({ financialDocument: f.financialDocument, saleInvoice: f.sale, documents: f.docs }).assetSettlement.projection;
  assert.equal(projection.salePrice, 75000);
  assert.equal(projection.netSalePrice, 75000);
  assert.equal(projection.tradeValue, 65000);
  assert.equal(projection.collected, 10000);
  assert.equal(projection.buyerBalance, 0);
  assert.equal(projection.customerRefundLiability, 0);
  assert.ok(projection.cashAvailableBeforeOwners <= 10000);
});
