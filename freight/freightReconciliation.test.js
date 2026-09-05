"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFreightOrder } = require("./contracts/freightOrderContract");
const {
  invoiceFingerprint,
  actualFromInvoices,
  canAttachInvoiceAtStatus,
  statusAfterInvoice
} = require("./services/freightService");
const {
  actualEconomics,
  expectedEconomics
} = require("./services/freightEconomics");

test("Freight Order supports an external destination before an AOS dispatch target is assigned", () => {
  const order = createFreightOrder({
    entityId: "ENTITY-1",
    actorId: "ACTOR-1",
    asset: { objectId: "MACHINE-1", passportId: "PASS-1", label: "2017 Deere 544K II" },
    route: { origin: { label: "Wichita Falls, TX" }, destination: { address: "Dallas, TX" }, routeMiles: 142 },
    execution: { carrierName: "Carrier One" },
    purpose: "acquisition-inbound",
    economics: { agreedAmount: 2500, fuelSurchargeEstimate: 150 }
  });

  assert.equal(order.schema, "ixi-freight-order-v2");
  assert.equal(order.route.destination.address, "Dallas, TX");
  assert.equal(order.economics.expectedTotal, 2650);
  assert.deepEqual(order.invoices, []);
  assert.equal(order.reconciliation.status, "not-started");
});

test("carrier invoice fingerprint is stable and carrier-scoped", () => {
  assert.equal(
    invoiceFingerprint({ carrierName: "ABC Transport, LLC", invoiceNumber: " INV 1001 " }),
    "abc-transport-llc|inv-1001"
  );
});

test("invoice reconciliation sums invoices, credits, and accessorials without double counting", () => {
  const actual = actualFromInvoices([
    { documentType: "carrier-invoice", status: "matched", charges: { freight: 2500, permits: 200, fuelSurcharge: 150 } },
    { documentType: "carrier-invoice", status: "matched", charges: { detention: 300 } },
    { documentType: "carrier-credit", status: "matched", charges: { detention: 100 } },
    { documentType: "carrier-invoice", status: "void", charges: { other: 9999 } }
  ]);
  const economics = actualEconomics({ expectedTotal: 3000 }, actual, 500);

  assert.equal(economics.actualFreight, 2500);
  assert.equal(economics.actualPermits, 200);
  assert.equal(economics.actualFuelSurcharge, 150);
  assert.equal(economics.actualDetention, 200);
  assert.equal(economics.actualTotal, 3050);
  assert.equal(economics.variance, 50);
});

test("actual carrier cost does not manufacture a variance when no estimate was provided", () => {
  const expected = expectedEconomics({}, 500);
  const actual = actualEconomics(expected, { actualFreight: 2750 }, 500);

  assert.equal(expected.expectedProvided, false);
  assert.equal(expected.expectedTotal, 0);
  assert.equal(actual.actualTotal, 2750);
  assert.equal(actual.variance, 0);
  assert.equal(actual.varianceBasis, "none");
});

test("carrier invoices can be recorded before delivery without skipping the movement lifecycle", () => {
  for (const status of ["draft", "requested", "awarded", "dispatched", "picked-up", "in-transit"]) {
    assert.equal(canAttachInvoiceAtStatus(status), true);
    assert.equal(statusAfterInvoice(status), status);
  }

  assert.equal(statusAfterInvoice("delivered"), "billed");
  assert.equal(canAttachInvoiceAtStatus("reconciled"), false);
  assert.equal(canAttachInvoiceAtStatus("cancelled"), false);
});
