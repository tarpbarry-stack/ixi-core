"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { createPurchaseOrderDocument } = require("./IXIFinancialPurchaseOrderFactory");

test("Purchase Order factory preserves its canonical operational lifecycle record", () => {
  const document = createPurchaseOrderDocument({
    financialDocumentId: "ifd_purchaseorder123",
    documentNumber: "PO-4102",
    references: [{ passportId: "passport:machine:1", role: "asset" }],
    purchaseOrderRecord: {
      schema: "ixi-purchase-order-record-v1",
      identity: { purchaseOrderRecordId: "POREC-1", poNumber: "PO-4102" },
      status: "sent",
      receiving: { orderedQuantity: 2, receivedQuantity: 1, remainingQuantity: 1 },
      timeline: [{ type: "po-sent" }]
    },
    amount: 1200,
    description: "Hydraulic hose kit"
  });

  assert.equal(document.documentType, "purchase-order");
  assert.equal(document.purchaseOrderRecord.schema, "ixi-purchase-order-record-v1");
  assert.equal(document.purchaseOrderRecord.status, "sent");
  assert.equal(document.purchaseOrderRecord.receiving.remainingQuantity, 1);
  assert.equal(document.purchaseOrderRecord.timeline[0].type, "po-sent");
});

test("Purchase Order HTTP controls bind trusted identity and segregate approval decisions", () => {
  const commands = fs.readFileSync(require.resolve("./IXIFinancialCommandRoutes"), "utf8");
  const routes = fs.readFileSync(require.resolve("./IXIFinancialRoutes"), "utf8");

  assert.match(commands, /type==="purchase-order"/u);
  assert.match(commands, /employeePassportId:clean\(accessContext\.actorPassportId\)/u);
  assert.match(routes, /type === "purchase-order"/u);
  assert.match(routes, /return IXI_FINANCIAL_ACTIONS\.APPROVE_DOCUMENT/u);
  assert.match(routes, /return IXI_FINANCIAL_ACTIONS\.REJECT_DOCUMENT/u);
  assert.match(routes, /return IXI_FINANCIAL_ACTIONS\.VOID_DOCUMENT/u);
  assert.match(routes, /approval\.approvedById = actorPassportId/u);
  assert.match(routes, /receiving\.lastReceivedById = actorPassportId/u);
});
