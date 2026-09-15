"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  createFinancialLifecycleSnapshot,
} = require("./IXIFinancialLifecycleEngine");
test("trades settle noncash sale consideration without phantom cash or receivables", () => {
  const trades = [{ allowance: 20619 }, { allowance: 20619 }];
  const documents = [
    {
      financialDocumentId: "order",
      documentType: "sales-order",
      financialState: "committed",
      currency: "USD",
      totals: { total: 126238 },
    },
    {
      financialDocumentId: "invoice",
      documentType: "invoice",
      financialState: "collected",
      currency: "USD",
      sourceFinancialDocumentId: "order",
      totals: { total: 85000 },
      metadata: { trades },
    },
    {
      financialDocumentId: "receipt",
      documentType: "payment",
      financialState: "paid",
      currency: "USD",
      paymentDirection: "inflow",
      sourceFinancialDocumentId: "invoice",
      totals: { total: 85000 },
    },
  ];
  const position = createFinancialLifecycleSnapshot({ documents });
  assert.equal(position.revenue, 126238);
  assert.equal(position.collected, 85000);
  assert.equal(position.receivable, 0);
  assert.equal(position.remainingContractedRevenue, 0);
  const unpaid = createFinancialLifecycleSnapshot({
    documents: documents.slice(0, 2),
  });
  assert.equal(unpaid.receivable, 85000);
  const fullTrade = createFinancialLifecycleSnapshot({
    documents: [
      {
        ...documents[1],
        totals: { total: 0 },
        metadata: { trades: [{ allowance: 126238 }] },
      },
    ],
  });
  assert.equal(fullTrade.revenue, 126238);
  assert.equal(fullTrade.receivable, 0);
  assert.equal(fullTrade.collected, 0);
});

test("signed package compatibility is preserved and trades are included when present", () => {
  const { packageSnapshot } = require("../sales/IXISalesSigningService");
  const legacy = {
    schema: "ixi-equipment-sales-order-v1",
    identity: { salesOrderId: "existing" },
    totals: { total: 100 },
  };
  assert.equal(Object.hasOwn(packageSnapshot(legacy), "trades"), false);
  assert.deepEqual(
    packageSnapshot({ ...legacy, trades: [] }),
    packageSnapshot(legacy),
  );
  assert.notDeepEqual(
    packageSnapshot({
      ...legacy,
      trades: [{ allowance: 50, serialNumber: "SERIAL1" }],
    }),
    packageSnapshot({
      ...legacy,
      trades: [{ allowance: 50, serialNumber: "SERIAL2" }],
    }),
  );
});

test("a cash-only full return cannot silently reverse a deal with traded machines", () => {
  const { planAdjustment } = require("./IXIFinancialSaleReturnService");
  assert.throws(() => planAdjustment({ invoice: { metadata: { trades: [{ allowance: 20619 }] } }, documents: [], body: { commandId: "return-trade-example", kind: "return" }, accessContext: {} }), /trade-in machines/);
});
