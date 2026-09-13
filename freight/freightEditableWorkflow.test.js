"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createFreightOrder } = require("./contracts/freightOrderContract");
const { buildAmendedFreightOrder } = require("./services/freightService");
const { projectFreightFinancials } = require("./services/freightFinancialProjection");
const create = () => createFreightOrder({ entityId: "entity-1", actorId: "person-1", asset: { objectId: "machine-1", passportId: "pass-1" } });
const record = (id, type, total, extra = {}) => ({ financialDocument: { financialDocumentId: id, documentType: type, totals: { total }, financialState: "billed", metadata: { freightOrderId: "FO-1" }, ...extra }, server: { entityPassportId: "entity-pass", revision: 1 } });

test("save a machine Freight draft without carrier, price or route", () => {
  const draft = create();
  assert.equal(draft.status, "draft"); assert.equal(draft.economics.expectedProvided, false);
  assert.equal(draft.execution.carrierName, ""); assert.equal(draft.asset.objectId, "machine-1");
});

test("historical delivery and destination correction preserve the current AOS movement binding", () => {
  const original = { ...create(), status: "closed", movement: { movementId: "move-now", state: "completed" } };
  const next = buildAmendedFreightOrder({ current: original, actorId: "person-1", expectedRevision: 1,
    amendment: { route: { destination: { label: "California yard" } }, execution: { actualPickupAt: "2026-02-10T12:00", actualDeliveryAt: "2026-02-11T18:00" } } });
  assert.deepEqual(next.movement, original.movement); assert.equal(next.asset.objectId, "machine-1");
  assert.equal(next.execution.actualDeliveryAt, "2026-02-11T18:00"); assert.equal(next.status, "closed");
  assert.equal(next.identity.revision, 2); assert.equal(next.economics.expectedProvided, false);
  assert.throws(() => buildAmendedFreightOrder({ current: next, expectedRevision: 2, amendment: { execution: { actualDeliveryAt: "2026-02-09T12:00" } } }), /delivery must be on or after/);
});

test("Freight reads one canonical Bill revision, credit and payment with no duplicate totals", () => {
  const order = { ...create(), identity: { freightOrderId: "FO-1" }, invoices: [{ billDocumentId: "bill-1", amount: 9999 }] };
  const bill = record("bill-1", "bill", 2500);
  const credit = record("credit-1", "credit", 500, { sourceFinancialDocumentId: "bill-1" });
  const payment = record("pay-1", "payment", 2500, { sourceFinancialDocumentId: "bill-1", paymentDirection: "outflow" });
  const unrelated = record("other", "bill", 99999); unrelated.server.entityPassportId = "other-entity";
  const projection = projectFreightFinancials(order, [bill, bill, credit, payment, unrelated], "entity-pass");
  assert.equal(projection.economics.actualTotal, 2000);
  assert.equal(projection.financial.paidTotal, 2500);
  assert.equal(projection.financial.openPayableTotal, 0);
  assert.equal(projection.financial.carrierCreditTotal, 500);
  assert.equal(projection.invoices.length, 2);
  assert.equal(projectFreightFinancials(order, [{ ...bill, financialDocument: { ...bill.financialDocument, totals: { total: 2300 } } }, credit, payment], "entity-pass").economics.actualTotal, 1800);
});
