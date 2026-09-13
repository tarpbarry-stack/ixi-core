"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-financial-admission-"));
process.env.IXI_MOS_DATA_ROOT = path.join(root, "mos");
process.env.IXI_PASSPORT_DATA_FILE = path.join(root, "passports.json");
const { ensureCommercialOnboarding } = require("../mos/onboarding/aosCommercialOnboardingService");
const { provisionSharetribeMachine } = require("../mos/onboarding/sharetribeMachineProvisioningService");
const { provisionAosObject } = require("../mos/provisioning/aosObjectProvisioningService");
const { listObjects } = require("../mos/objects/objectService");
const { ensurePassportForSource, readPassportRecords } = require("../passport/passportRegistry");
const { resolveProductionObjectIdentity } = require("./IXIFinancialScopeDiscoveryService");

test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const owner = ensureCommercialOnboarding({
  ownerUserId: "financial-fixture-owner", entityDisplayName: "Financial fixture",
  person: { displayName: "Fixture owner" }
});
const original = ensurePassportForSource({
  sourceType: "sharetribe-listing", sourceId: "financial-fixture-listing",
  visibility: "private", status: "active"
}).passport;
const machine = provisionSharetribeMachine({
  entityId: owner.entity.entityId, principalId: "financial-fixture-owner",
  commandId: "financial-fixture-machine", creationBoundary: "post-free",
  listing: {
    listingId: "financial-fixture-listing", displayName: "Fixture machine",
    channel: "private", state: "published", value: 41500, currency: "USD",
    fields: { year: "2017", make: "Deere", model: "544K II", hours: 4500 }
  }
}).object;

test("Financial recognizes the permanent AOS binding of a reused listing Passport without mutation", () => {
  const before = { objects: listObjects({ status: null }), passports: readPassportRecords() };
  const identity = resolveProductionObjectIdentity(machine);
  assert.equal(identity.objectId, machine.objectId);
  assert.equal(identity.passportId, original.passportId);
  const passport = readPassportRecords().find(record => record.passportId === original.passportId);
  assert.equal(passport.sourceType, "sharetribe-listing");
  assert.ok(passport.sources.some(source => source.sourceType === "aos-object" && source.sourceId === machine.objectId));
  assert.deepEqual({ objects: listObjects({ status: null }), passports: readPassportRecords() }, before);
});

test("Financial still recognizes a Passport born at the AOS creation boundary", () => {
  const object = provisionAosObject({
    commandId: "financial-native-object", entityId: owner.entity.entityId,
    actorId: "financial-fixture-owner", objectType: "customer-defined", displayName: "Native object"
  }).object;
  assert.equal(resolveProductionObjectIdentity(object).objectId, object.objectId);
});

test("Financial rejects missing bindings, conflicting Passports and incomplete provisioning", () => {
  const clone = () => structuredClone(machine);
  const foreign = clone();
  foreign.objectId = "object_unbound";
  assert.equal(resolveProductionObjectIdentity(foreign), null);
  const conflicting = clone();
  conflicting.identities.find(identity => identity.identityType === "ixi-passport").passportId = "IXIOTHER23";
  assert.equal(resolveProductionObjectIdentity(conflicting), null);
  for (const patch of [{ state: "pending" }, { verified: false }, { passportProvisioned: false }, { passportId: "IXIOTHER23" }]) {
    const incomplete = clone();
    Object.assign(incomplete.metadata.provisioning, patch);
    assert.equal(resolveProductionObjectIdentity(incomplete), null);
  }
});
