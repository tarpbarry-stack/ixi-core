"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const express = require("express");
const provider = require("./IXIFinancialProviderService");
const registry = require("../mos/onboarding/tradeMachineService");
const { planTradeCorrection, collectionPosition } = require("./IXIFinancialTradeCorrections");
const { createFinancialLifecycleSnapshot } = require("./IXIFinancialLifecycleEngine");
const { assertGenericSaleMutation } = require("./IXIFinancialSaleWriteControl");
const { createSaleBalanceTransactionItems } = require("./IXIFinancialDynamoStore");
const { validateFinancialDocument } = require("./IXIFinancialValidationBridge");
const entity = "IXI_TEST_ENTITY", machine = "IXI_TEST_MACHINE", incoming = "IXI_TEST_TRADE";
const refs = [{ role: "entity", passportId: entity }, { role: "asset", passportId: machine }];
const accessContext = { entityPassportId: entity, actorPassportId: "IXI_TEST_ACTOR" };
function fixture() {
  const order = { identity: { salesOrderId: "test-order", dealId: "test-deal" }, context: { entityPassportId: entity, primaryPassportId: machine },
    asset: { passportId: machine }, related: { invoiceId: "test-invoice" }, commercial: { currency: "USD" }, trades: [], totals: { subtotal: 75000, total: 75000, tradeAllowance: 0 },
    signing: { signedPackageHash: "original-signed-package" } };
  const invoice = { financialDocumentId: "test-invoice", documentNumber: "TEST-INVOICE", documentType: "invoice", financialState: "partially-collected", currency: "USD",
    occurredAt: "2026-02-01", sourceFinancialDocumentId: "test-order", references: refs, totals: { total: 75000 }, metadata: {} };
  const payment = { financialDocumentId: "test-wire", documentType: "payment", financialState: "paid", paymentDirection: "inflow", currency: "USD",
    sourceFinancialDocumentId: invoice.financialDocumentId, references: refs, totals: { total: 10000 } };
  const trade = { tradeId: "trade-test-001", passportId: incoming, objectId: "test-trade-object", listingId: "test-trade-listing", year: "2021", make: "TEST", model: "LOADER", serialNumber: "TEST-SERIAL-001", hours: "4400", allowance: 65000 };
  return { order, invoice, payment, trade, body: { trade, effectiveDate: "2026-02-02", reason: "Trade omitted from invoice" } };
}
function plan(state, body = state.body, documents = [state.invoice, state.payment]) {
  return planTradeCorrection({ ...state, body, documents, accessContext, verifyTrades: order => {
    assert.equal(order.context.entityPassportId, entity); assert.equal(order.trades.length, 1); return [order.trades[0]];
  } });
}
test("a missing trade settles noncash consideration without changing signed terms, revenue, costs or the wire", () => {
  const state = fixture(), before = JSON.stringify(state);
  const result = plan(state), credit = result.document;
  assert.equal(JSON.stringify(state), before);
  const validation = validateFinancialDocument(credit);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  assert.equal(validation.normalized.tradeCorrection.trade.passportId, incoming);
  const cost = { documentType: "expense", financialState: "incurred", currency: "USD", totals: { total: 65519.90 } };
  const documents = [state.invoice, state.payment, credit, cost];
  assert.equal(collectionPosition(state.invoice, documents).balance, 0);
  const totals = createFinancialLifecycleSnapshot({ documents });
  assert.equal(totals.revenue, 75000); assert.equal(totals.incurredCost, 65519.90);
  assert.equal(totals.collected, 10000); assert.equal(totals.receivable, 0);
  assert.equal(credit.creditType, "trade-credit"); assert.equal(credit.tradeCorrection.salesOrderId, "test-order");
  assert.throws(() => assertGenericSaleMutation({ next: credit, mode: "create" }), /dedicated/);
  assert.throws(() => assertGenericSaleMutation({ existing: credit, next: { ...credit, financialState: "void" } }), /immutable/);
  assert.equal(plan(state, state.body, documents).replay.financialDocumentId, credit.financialDocumentId);
  assert.throws(() => plan(state, { ...state.body, reason: "Changed request" }, documents), /different trade correction/);
  assert.throws(() => plan(state, { ...state.body, trade: { ...state.trade, tradeId: "another-trade" } }, documents), /different trade correction/);
  credit.metadata.tradeCorrectionControl = { invoiceId: "test-invoice", revision: 4 };
  const items = createSaleBalanceTransactionItems({ record: { financialDocument: credit, server: { entityPassportId: entity } } });
  assert.equal(items[0].Update.ExpressionAttributeValues[":remaining"], 0);
  assert.deepEqual(items[1].ConditionCheck.Key, { PK: "FIN#test-invoice", SK: "CURRENT" });
  assert.equal(items[1].ConditionCheck.ExpressionAttributeValues[":revision"], 4);
});
test("multiple trades use the remaining balance and already included machines cannot be credited twice", () => {
  const state = fixture();
  const first = plan(state, { ...state.body, trade: { ...state.trade, allowance: 30000 } }).document;
  const body = { ...state.body, trade: { ...state.trade, passportId: "SECOND-TRADE", tradeId: "second-trade-id", allowance: 35000 } };
  const docs = [state.invoice, state.payment, first];
  const second = plan(state, body, docs).document;
  assert.notEqual(second.financialDocumentId, first.financialDocumentId);
  assert.equal(collectionPosition(state.invoice, [...docs, second]).balance, 0);
  assert.throws(() => plan(state, { ...body, trade: { ...body.trade, allowance: 35001 } }, docs), /remaining balance/);
  assert.throws(() => plan({ ...state, order: { ...state.order, trades: [state.trade] } }), /already included/);
  assert.throws(() => plan({ ...state, invoice: { ...state.invoice, metadata: { assetSale: true } } }), /already closed/);
  assert.throws(() => plan(state, { ...state.body, effectiveDate: "2026-01-01" }), /credit date/);
});
test("authenticated correction route records one credit, then SOLD still requires the incoming acquisition", async t => {
  const state = fixture();
  const records = [ { financialDocument: { financialDocumentId: "test-order", documentType: "sales-order", references: refs, salesOrder: state.order }, server: { revision: 2, entityPassportId: entity } },
    { financialDocument: state.invoice, server: { revision: 4, entityPassportId: entity } }, { financialDocument: state.payment, server: { revision: 1, entityPassportId: entity } } ];
  const before = JSON.stringify(records);
  const original = { getDocument: provider.getDocument, listDocumentsByPassport: provider.listDocumentsByPassport, createDocument: provider.createDocument,
    verifiedOrderTrades: registry.verifiedOrderTrades, loadVerifiedAcquisition: registry.loadVerifiedAcquisition };
  const gl = require("./IXIFinancialGLService"), oldGL = gl.getFinancialGLProjection;
  gl.getFinancialGLProjection = async () => ({ projection: { period: { closed: false } } });
  provider.getDocument = async ({ financialDocumentId }) => ({ ok: true, data: { record: records.find(item => item.financialDocument.financialDocumentId === financialDocumentId) } });
  provider.listDocumentsByPassport = async () => ({ ok: true, data: { documents: records } });
  let acquired = false;
  registry.verifiedOrderTrades = order => { assert.equal(order.identity.dealId, "test-deal"); return [{ ...state.trade, status: acquired ? "acquired" : "pending-trade", acquisitionId: acquired ? "trade-acquisition" : "" }]; };
  registry.loadVerifiedAcquisition = async (row, id) => { assert.equal(id, "trade-acquisition"); return {}; };
  provider.createDocument = async ({ financialDocument }) => { const record = { financialDocument, server: { revision: 1, entityPassportId: entity } }; records.push(record); return { ok: true, data: { record } }; };
  t.after(() => { Object.assign(provider, { getDocument: original.getDocument, listDocumentsByPassport: original.listDocumentsByPassport, createDocument: original.createDocument });
    registry.verifiedOrderTrades = original.verifiedOrderTrades; registry.loadVerifiedAcquisition = original.loadVerifiedAcquisition; gl.getFinancialGLProjection = oldGL; });
  const app = express(); app.use(express.json()); app.use((req, res, next) => {
    if (req.headers["x-test-user"]) { const scope = req.headers["x-test-user"] === "other" ? "OTHER-ENTITY" : entity;
      req.ixiIdentity = { authenticatedUserId: "test-user", ...accessContext, entityPassportId: scope, trustedInternal: true };
      req.trustedFinancialAccess = { ...accessContext, entityPassportId: scope, roles: ["financial-admin"], managedPassportIds: [scope, machine, incoming] };
      req.ixiInternalAuth = { requestId: "test-internal" }; }
    next();
  }); app.use("/sales-orders/:financialDocumentId/trade-corrections", require("./IXIFinancialTradeCorrectionRoutes"));
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); }); t.after(() => new Promise(resolve => server.close(resolve)));
  const call = async (body, user = "owner") => { const response = await fetch(`http://127.0.0.1:${server.address().port}/sales-orders/test-order/trade-corrections`, {
    method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };
  assert.equal((await call(null, "")).status, 401); assert.equal((await call(state.body, "other")).status, 403);
  assert.equal((await call()).body.data.position.balance, 65000);
  const written = await call(state.body); assert.equal(written.status, 201, JSON.stringify(written));
  assert.equal(written.body.data.position.balance, 0); assert.equal(records.length, 4);
  assert.equal((await call(state.body)).body.data.replayed, true); assert.equal(records.length, 4);
  assert.equal(JSON.stringify(records.slice(0, 3)), before);
  const { assertInvoiceCollectionPatchAvailable } = require("./IXIFinancialSalesCloseoutControl");
  const merged = { ...state.invoice, financialState: "collected", metadata: { assetSale: true, assetSaleRecord: { status: "sold", identity: { saleId: "test-invoice" } } } };
  await assert.rejects(assertInvoiceCollectionPatchAvailable({ existing: state.invoice, merged, entityPassportId: entity }), /each trade acquisition/);
  acquired = true;
  const closeout = await assertInvoiceCollectionPatchAvailable({ existing: state.invoice, merged, entityPassportId: entity });
  assert.equal(closeout.balance, 0); assert.equal(closeout.received, 10000);
  // The incoming acquisition resolves the trade-credit supplement as its source,
  // while preserving the signed original order without inserting a new trade.
  const credit = records[3].financialDocument;
  const acquisition = { context: { entityPassportId: entity, primaryPassportId: incoming }, trade: { tradeId: state.trade.tradeId, dealId: "test-deal" }, acquisition: { purchasePrice: 65000 } };
  const { assertFinancialTradeLinks, tradeAcquisitionId } = require("./IXIFinancialTradeContract");
  registry.verifiedOrderTrades = order => { assert.equal(order.trades[0].passportId, incoming); return [{ ...state.trade, dealId: "test-deal", allowanceCents: 6500000 }]; };
  await assertFinancialTradeLinks({ financialDocumentId: tradeAcquisitionId(acquisition), documentType: "asset-acquisition", sourceFinancialDocumentId: credit.financialDocumentId, assetAcquisition: acquisition }, async id => records.find(item => item.financialDocument.financialDocumentId === id));
});
