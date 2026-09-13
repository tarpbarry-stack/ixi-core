"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { payableBalanceTransactionItems } = require("./IXIFinancialPayableBalanceControl");
const provider = require("./IXIFinancialProviderService");
const { assertPayablesSettlementAvailable } = require("./IXIFinancialCommandEngine");
const make = (id, type, amount, extra = {}) => ({ financialDocument: { financialDocumentId: id, documentType: type, currency: "USD", financialState: type === "bill" ? "billed" : type === "credit" ? "credited" : "paid", totals: { total: amount }, ...(type !== "bill" ? { sourceFinancialDocumentId: "bill-1" } : { billRecord: { context: { entityPassportId: "entity-1" }, approval: { status: "approved" } } }), ...extra }, server: { entityPassportId: "entity-1", revision: 1 } });
const bill = make("bill-1", "bill", 2500);
function options(record, guard, existing = [], previousRecord) { return { record, previousRecord, tableName: "test", getRecord: async () => bill, getGuard: async () => guard, listRecords: async () => existing }; }

test("paid Bill accepts a later credit and retains the original cash payment", async () => {
  const payment = make("pay-1", "payment", 2500, { paymentDirection: "outflow" });
  const credit = make("credit-1", "credit", 500);
  const items = await payableBalanceTransactionItems(options(credit, null, [payment]));
  assert.equal(items[0].Put.Item.paidCents, 250000);
  assert.equal(items[0].Put.Item.creditCents, 50000);
  assert.equal(items[1].ConditionCheck.ExpressionAttributeValues[":expectedRevision"], 1);
  assert.equal(items[0].Put.ConditionExpression, "attribute_not_exists(PK)");
});

test("concurrent payment candidates compete on one version, so only one can commit", async () => {
  const guard = { version: 8, paidCents: 200000, creditCents: 0 };
  const a = await payableBalanceTransactionItems(options(make("pay-a", "payment", 400, { paymentDirection: "outflow" }), guard));
  const b = await payableBalanceTransactionItems(options(make("pay-b", "payment", 400, { paymentDirection: "outflow" }), guard));
  assert.deepEqual(a[0].Put.ExpressionAttributeValues, { ":expectedVersion": 8 });
  assert.deepEqual(b[0].Put.ExpressionAttributeValues, { ":expectedVersion": 8 });
  const committedGuard = a[0].Put.Item;
  assert.equal(committedGuard.version, 9);
  assert.notEqual(committedGuard.version, b[0].Put.ExpressionAttributeValues[":expectedVersion"]);
  await assert.rejects(() => payableBalanceTransactionItems(options(make("pay-b", "payment", 400, { paymentDirection: "outflow" }), committedGuard)), /remaining Bill balance/);
});

test("Bill correction preserves cash and credit correction replaces only its own contribution", async () => {
  const guard = { version: 2, paidCents: 250000, creditCents: 50000 };
  const amendedBill = make("bill-1", "bill", 2000);
  const correction = await payableBalanceTransactionItems(options(amendedBill, guard, [], bill));
  assert.equal(correction[0].Put.Item.paidCents, 250000);
  assert.equal(correction[0].Put.Item.billCents, 200000);
  const amendedCredit = await payableBalanceTransactionItems(options(make("credit-1", "credit", 300), guard, [], make("credit-1", "credit", 500)));
  assert.equal(amendedCredit[0].Put.Item.creditCents, 30000);
});

test("credits cannot exceed the Bill, including when paid; currencies and Entity stay bound", async () => {
  await assert.rejects(() => payableBalanceTransactionItems(options(make("credit-2", "credit", 2200), { version: 2, paidCents: 250000, creditCents: 50000 })), /Credits exceed/);
  await assert.rejects(() => payableBalanceTransactionItems(options(make("credit-2", "credit", 100, { currency: "EUR" }), null)), /currencies/);
  const otherEntity = make("credit-2", "credit", 100); otherEntity.server.entityPassportId = "entity-2";
  await assert.rejects(() => payableBalanceTransactionItems(options(otherEntity, null)), /same Entity/);
});

test("HTTP preflight accepts credit after full payment and excludes the prior credit revision", async () => {
  const get = provider.getDocument, list = provider.listDocumentsByPassport;
  provider.getDocument = async () => ({ ok: true, data: { record: bill } });
  provider.listDocumentsByPassport = async () => ({ ok: true, data: { documents: [make("pay-1", "payment", 2500, { paymentDirection: "outflow" }), make("credit-1", "credit", 500)] } });
  try {
    const result = await assertPayablesSettlementAvailable({ entityPassportId: "entity-1", financialDocument: make("credit-2", "credit", 500).financialDocument });
    assert.equal(result.settled, 500);
    const corrected = await assertPayablesSettlementAvailable({ entityPassportId: "entity-1", financialDocument: make("credit-1", "credit", 2500).financialDocument, excludeFinancialDocumentId: "credit-1" });
    assert.equal(corrected.settled, 0);
  } finally { provider.getDocument = get; provider.listDocumentsByPassport = list; }
});
