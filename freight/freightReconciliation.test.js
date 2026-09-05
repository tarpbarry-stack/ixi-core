"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const { createFreightOrder } = require("./contracts/freightOrderContract");
const {
  invoiceFingerprint,
  actualFromInvoices,
  canAttachInvoiceAtStatus,
  statusAfterInvoice,
  buildAmendedFreightOrder,
  freightAmendmentDiff,
  amendmentFingerprint
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

test("Freight amendments preserve canonical identity and create a new revision", () => {
  const order = createFreightOrder({
    entityId: "ENTITY-1",
    actorId: "ACTOR-1",
    asset: { objectId: "MACHINE-1", passportId: "PASS-1", weight: 20000 },
    route: { origin: { label: "San Antonio, TX" }, destination: { label: "Wichita Falls, TX" }, routeMiles: 315 },
    execution: { carrierName: "Original Carrier", requestedPickupAt: "2026-09-08T08:00" },
    purpose: "acquisition-inbound",
    economics: { agreedAmount: 1500 }
  });
  const amended = buildAmendedFreightOrder({
    current: order,
    expectedRevision: 1,
    actorId: "ACTOR-2",
    amendment: {
      route: { destination: { label: "Dallas, TX" }, routeMiles: 275 },
      execution: { carrierName: "Replacement Carrier" },
      economics: { agreedAmount: 1650 },
      metadata: { notes: "Call before loading" }
    }
  });

  assert.equal(amended.identity.freightOrderId, order.identity.freightOrderId);
  assert.equal(amended.identity.revision, 2);
  assert.equal(amended.asset.passportId, "PASS-1");
  assert.equal(amended.route.origin.label, "San Antonio, TX");
  assert.equal(amended.route.destination.label, "Dallas, TX");
  assert.equal(amended.execution.carrierName, "Replacement Carrier");
  assert.equal(amended.economics.expectedTotal, 1650);
  assert.equal(amended.metadata.notes, "Call before loading");
  assert.equal(amended.audit.updatedBy, "ACTOR-2");
});

test("requested Freight amendments require a reason and reject stale revisions", () => {
  const draft = createFreightOrder({
    entityId: "ENTITY-1",
    actorId: "ACTOR-1",
    asset: { objectId: "MACHINE-1", passportId: "PASS-1" },
    route: { destination: { label: "Dallas, TX" } }
  });
  const requested = { ...draft, status: "requested" };

  assert.throws(
    () => buildAmendedFreightOrder({ current: requested, expectedRevision: 1 }),
    error => error?.code === "FREIGHT_AMENDMENT_REASON_REQUIRED"
  );
  assert.throws(
    () => buildAmendedFreightOrder({ current: requested, expectedRevision: 0, changeReason: "Carrier changed" }),
    error => error?.code === "FREIGHT_REVISION_CONFLICT"
  );
  assert.throws(
    () => buildAmendedFreightOrder({ current: { ...requested, status: "closed" }, expectedRevision: 1, changeReason: "Correction" }),
    error => error?.code === "FREIGHT_AMENDMENT_STATE_INVALID"
  );
});

test("Freight amendments whitelist commercial terms and expose an exact audit diff", () => {
  const order = createFreightOrder({
    entityId: "ENTITY-1",
    actorId: "ACTOR-1",
    asset: { objectId: "MACHINE-1", passportId: "PASS-1", weight: 20000 },
    route: { destination: { label: "Dallas, TX" }, routeMiles: 100 },
    economics: { agreedAmount: 1500 }
  });
  const amended = buildAmendedFreightOrder({
    current: order,
    expectedRevision: 1,
    actorId: "ACTOR-2",
    amendment: {
      asset: { passportId: "ATTACKER-PASSPORT", weight: 21000 },
      route: { routeMiles: 125, actualMiles: 9999 },
      economics: { agreedAmount: 1650, actualTotal: 1 },
      metadata: { notes: "Approved change", injectedFlag: true }
    }
  });

  assert.equal(amended.asset.passportId, "PASS-1");
  assert.equal(amended.route.actualMiles, null);
  assert.equal(amended.economics.actualTotal, order.economics.actualTotal);
  assert.equal(amended.metadata.injectedFlag, undefined);
  assert.deepEqual(
    freightAmendmentDiff(order, amended).map(change => change.field),
    ["asset.weight", "route.routeMiles", "economics.agreedAmount", "metadata.notes"]
  );
});

test("Freight amendment fingerprints are stable and no-op patches are rejected", () => {
  const left = amendmentFingerprint({ amendment: { route: { routeMiles: 125 }, asset: { weight: 21000 } } });
  const right = amendmentFingerprint({ amendment: { asset: { weight: 21000 }, route: { routeMiles: 125 } } });
  assert.equal(left, right);

  const order = createFreightOrder({
    entityId: "ENTITY-1",
    actorId: "ACTOR-1",
    asset: { objectId: "MACHINE-1", passportId: "PASS-1" },
    route: { destination: { label: "Dallas, TX" } }
  });
  assert.throws(
    () => buildAmendedFreightOrder({
      current: order,
      expectedRevision: 1,
      amendment: { route: { actualMiles: 9999 }, metadata: { injectedFlag: true } }
    }),
    error => error?.code === "FREIGHT_AMENDMENT_NO_CHANGES"
  );
});

test("Freight amendment persistence commits order, event, and idempotency evidence atomically", () => {
  const store = fs.readFileSync("freight/storage/freightDynamoStore.js", "utf8");
  const service = fs.readFileSync("freight/services/freightService.js", "utf8");

  assert.match(store, /new TransactWriteCommand\(\{\s*TransactItems:/u);
  assert.match(store, /recordType: "freight-command"/u);
  assert.match(store, /ConditionExpression: "attribute_not_exists\(pk\) AND attribute_not_exists\(sk\)"/u);
  assert.match(store, /ConsistentRead: true/u);
  assert.match(service, /eventType: "freight\.amended"[\s\S]*?changes/u);
  assert.match(service, /getAmendmentCommand\(\{/u);
});
