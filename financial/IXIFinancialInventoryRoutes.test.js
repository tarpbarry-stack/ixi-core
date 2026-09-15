"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const provider = require("./IXIFinancialProviderService");
require("./IXIFinancialGLService").getFinancialGLProjection = async () => ({ projection: { period: { closed: false } } });
const inventoryRoutes = require("./IXIFinancialInventoryRoutes");
const { assertGenericSaleMutation } = require("./IXIFinancialSaleWriteControl");
const entity = "IXI_TEST_ENTITY", machine = "IXI_TEST_MACHINE";
const refs = [{ role: "entity", passportId: entity }, { role: "asset", passportId: machine }];
function fixtures() {
  return [{ financialDocument: { financialDocumentId: "ifd_sale_test", documentType: "invoice", financialState: "collected", status: "closed", currency: "USD", occurredAt: "2026-02-01",
    totals: { total: 10000 }, references: refs, lines: [{ amount: 10000, currency: "USD", direction: "inflow" }],
    metadata: { assetSale: true, assetSaleRecord: { status: "sold", identity: { saleId: "ifd_sale_test" }, context: { assetPassportId: machine, entityPassportId: entity }, sale: { saleDate: "2026-02-01", machineSalePrice: 10000, buyerLabel: "Test buyer" } } } }, server: { entityPassportId: entity, revision: 1 } },
  { financialDocument: { financialDocumentId: "ifd_receipt_test", documentType: "payment", financialState: "paid", paymentDirection: "inflow", currency: "USD", occurredAt: "2026-02-01", sourceFinancialDocumentId: "ifd_sale_test", totals: { total: 10000 }, references: refs }, server: { entityPassportId: entity, revision: 1 } }];
}
test("SOLD HTTP workflow preserves the original invoice through credit, cash refund, return and retries", async t => {
  const originals = Object.fromEntries(["getDocument", "listDocumentsByPassport", "createDocument", "patchDocument"].map(key => [key, provider[key]]));
  const records = fixtures();
  provider.getDocument = async ({ financialDocumentId }) => ({ ok: true, data: { record: records.find(item => item.financialDocument.financialDocumentId === financialDocumentId) } });
  provider.listDocumentsByPassport = async () => ({ ok: true, data: { documents: records } });
  provider.createDocument = async ({ financialDocument }) => {
    const record = { financialDocument, server: { entityPassportId: entity, revision: 1 } };
    records.push(record); return { ok: true, data: { record } };
  };
  provider.patchDocument = async ({ financialDocumentId, patch, expectedRevision }) => {
    const record = records.find(item => item.financialDocument.financialDocumentId === financialDocumentId);
    assert.equal(expectedRevision, record.server.revision);
    record.financialDocument = { ...record.financialDocument, ...patch }; record.server.revision++;
    return { ok: true, data: { record } };
  };
  t.after(() => Object.assign(provider, originals));
  const app = express(); app.use(express.json());
  app.use((req, res, next) => {
    if (req.headers["x-test-identity"]) {
      const scope = req.headers["x-test-identity"] === "other" ? "IXI_OTHER_ENTITY" : entity;
      req.ixiIdentity = { authenticatedUserId: "test-user", actorPassportId: "IXI_TEST_ACTOR", entityPassportId: scope, trustedInternal: true };
      req.trustedFinancialAccess = { actorPassportId: "IXI_TEST_ACTOR", entityPassportId: scope, roles: ["financial-admin"], managedPassportIds: [scope, machine] };
      req.ixiInternalAuth = { requestId: "test-internal" };
    }
    next();
  }); app.use("/financial/inventory", inventoryRoutes);
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const call = async (action = "", body, identity = "owner") => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/financial/inventory${action ? `/sales/ifd_sale_test/${action}` : "?all=1"}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(identity ? { "x-test-identity": identity } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await call("", null, "")).status, 401);
  assert.equal((await call()).body.data.current[machine].state, "sold");
  const request = { commandId: "test-credit-command", kind: "return", amount: 10000, effectiveDate: "2026-02-02", reason: "Machine return confirmed with buyer" };
  assert.equal((await call("adjustment", request, "other")).status, 403);
  const credit = await call("adjustment", request);
  assert.equal(credit.body.ok, true, JSON.stringify(credit));
  const creditId = credit.body.data.record.financialDocument.financialDocumentId;
  assert.equal((await call("adjustment", request)).body.data.replayed, true);
  assert.equal((await call("adjustment", { ...request, amount: 9000 })).status, 409);
  const refund = await call("refund", { commandId: "test-refund-command", creditId, amount: 10000, effectiveDate: "2026-02-03", paymentMethod: "wire", reference: "TEST-ONLY-WIRE" });
  assert.equal(refund.body.ok, true, JSON.stringify(refund));
  assert.equal((await call()).body.data.current[machine].state, "sold");
  const returned = { commandId: "test-return-command", creditId, expectedRevision: 1, machineReturned: true, effectiveDate: "2026-02-03", reason: "Machine physically received" };
  assert.equal((await call("return", { ...returned, machineReturned: false })).status, 409);
  assert.equal((await call("return", returned)).body.ok, true);
  assert.equal((await call("return", returned)).body.data.replayed, true);
  const after = (await call()).body.data;
  assert.equal(after.current[machine].state, "owned");
  assert.equal(after.current[machine].forcePrivate, true);
  assert.equal(after.sales[0].refundDue, 0);
  assert.equal(records.length, 4);
  assert.equal(records[0].financialDocument.financialState, "collected");
  assert.equal(records[1].financialDocument.totals.total, 10000);
});

test("ordinary voids, edits and replacements cannot silently restore sold inventory", () => {
  const existing = fixtures()[0].financialDocument;
  for (const patch of [{ status: "void" }, { financialState: "voided" }, { occurredAt: "2026-01-01" }, { totals: { total: 1 } }, { metadata: {} }, { metadata: { ...existing.metadata, assetSale: false } }]) {
    assert.throws(() => assertGenericSaleMutation({ existing, next: { ...existing, ...patch } }), /preserved|movement/);
  }
  assert.throws(() => assertGenericSaleMutation({ existing, next: existing, mode: "replace" }), /cannot be replaced/);
});
