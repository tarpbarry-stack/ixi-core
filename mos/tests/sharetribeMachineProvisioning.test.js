"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "ixi-sharetribe-machine-")
);

process.env.IXI_MOS_DATA_ROOT = path.join(testRoot, "mos");
process.env.IXI_PASSPORT_DATA_FILE = path.join(testRoot, "passports.json");

const {
  ensureCommercialOnboarding
} = require("../onboarding/aosCommercialOnboardingService");

const {
  provisionSharetribeMachine
} = require("../onboarding/sharetribeMachineProvisioningService");

const {
  ensurePassportForSource,
  bindPassportSource,
  readPassportRecords
} = require("../../passport/passportRegistry");

const {
  createObject,
  updateObject
} = require("../objects/objectService");

test.after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test("Post Free adopts an existing listing Passport into the canonical Machine instead of duplicating identity", () => {
  const owner = ensureCommercialOnboarding({
    ownerUserId: "sharetribe-owner-machine",
    entityDisplayName: "Machine Company",
    person: { displayName: "Machine Owner" }
  });

  const legacy = ensurePassportForSource({
    sourceType: "sharetribe-listing",
    sourceId: "listing-001",
    visibility: "private",
    status: "active"
  }).passport;

  const machine = provisionSharetribeMachine({
    entityId: owner.entity.entityId,
    principalId: "sharetribe-owner-machine",
    commandId: "post-free-listing-001",
    creationBoundary: "post-free",
    listing: {
      listingId: "listing-001",
      displayName: "2017 Deere 544K II",
      value: 41500,
      currency: "USD",
      channel: "private",
      state: "published",
      fields: {
        year: "2017",
        make: "Deere",
        model: "544K II",
        hours: 4500,
        city: "Wichita Falls",
        state: "TX"
      }
    }
  });

  assert.equal(machine.object.objectType, "machine");
  assert.equal(machine.passport.passportId, legacy.passportId);
  assert.equal(machine.relationship.role, "uploaded-by");
  assert.equal(machine.relationship.ownershipInferred, false);

  const sources = machine.passport.sources || [];
  assert.equal(
    sources.some(source =>
      source.sourceType === "sharetribe-listing" &&
      source.sourceId === "listing-001"
    ),
    true
  );
  assert.equal(
    sources.some(source =>
      source.sourceType === "aos-object" &&
      source.sourceId === machine.object.objectId
    ),
    true
  );

  /* Entity + owner Person + Equipment + For Sale + reused Machine Passport. */
  assert.equal(readPassportRecords().length, 5);
});

test("replaying the same listing returns the same Machine and Passport", () => {
  const owner = ensureCommercialOnboarding({
    ownerUserId: "sharetribe-owner-replay",
    entityDisplayName: "Replay Company",
    person: { displayName: "Replay Owner" }
  });

  const input = {
    entityId: owner.entity.entityId,
    principalId: "sharetribe-owner-replay",
    commandId: "upload-listing-002",
    creationBoundary: "upload",
    listing: {
      listingId: "listing-002",
      displayName: "2020 Deere 844K III",
      fields: { year: "2020", make: "Deere", model: "844K III" }
    }
  };

  const first = provisionSharetribeMachine(input);
  const second = provisionSharetribeMachine(input);

  assert.equal(second.replayed, true);
  assert.equal(second.object.objectId, first.object.objectId);
  assert.equal(second.passport.passportId, first.passport.passportId);
});

test("listing admission requires an explicit governed birth boundary and command", () => {
  assert.throws(
    () => provisionSharetribeMachine({
      entityId: "entity-any",
      principalId: "principal-any",
      listing: { listingId: "listing-any", displayName: "Any" }
    }),
    error => error?.code === "IXI_MACHINE_PROVISIONING_CONTEXT_REQUIRED"
  );
});

test("provisioning adopts an active AOS Object already bound to the listing Passport", () => {
  const owner = ensureCommercialOnboarding({
    ownerUserId: "sharetribe-owner-adoption",
    entityDisplayName: "Adoption Company",
    person: { displayName: "Adoption Owner" }
  });

  const legacyPassport = ensurePassportForSource({
    sourceType: "sharetribe-listing",
    sourceId: "listing-adoption-001",
    entityId: owner.entity.entityId,
    visibility: "private",
    status: "active"
  }).passport;

  let existing = createObject({
    entityId: owner.entity.entityId,
    objectType: "machine",
    displayName: "2017 Deere 544K II",
    fields: { serialNumber: "1DW544KZCHF681737", weight: 0 },
    source: "sharetribe-listing",
    actorId: "sharetribe-owner-adoption"
  });

  bindPassportSource({
    passportId: legacyPassport.passportId,
    sourceType: "aos-object",
    sourceId: existing.objectId,
    entityId: owner.entity.entityId
  });

  existing = updateObject({
    objectId: existing.objectId,
    identities: [{
      identityType: "ixi-passport",
      passportId: legacyPassport.passportId,
      entityId: owner.entity.entityId,
      sourceType: "aos-object",
      sourceId: existing.objectId
    }],
    actorId: "sharetribe-owner-adoption"
  });

  const result = provisionSharetribeMachine({
    entityId: owner.entity.entityId,
    principalId: "sharetribe-owner-adoption",
    commandId: "url-import-listing-adoption-001",
    creationBoundary: "url-import",
    listing: {
      listingId: "listing-adoption-001",
      displayName: "2017 DEERE 544K II - 4,500 Hrs",
      value: 41500,
      fields: {
        year: "2017",
        make: "DEERE",
        model: "544K II",
        hours: 4500,
        serialNumber: "1DW544KZCHF681737"
      }
    }
  });

  assert.equal(result.object.objectId, existing.objectId);
  assert.equal(result.object.value, 41500);
  assert.equal(result.object.fields.weight, 0);
  assert.equal(result.object.fields.hours, 4500);
  assert.equal(result.provisioning.objectCreated, false);
  assert.equal(result.provisioning.objectAdopted, true);
  assert.equal(result.passport.passportId, legacyPassport.passportId);
  assert.equal(
    (result.passport.sources || []).filter(source =>
      source.sourceType === "aos-object"
    ).length,
    1
  );
});
