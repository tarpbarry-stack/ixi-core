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
  readPassportRecords
} = require("../../passport/passportRegistry");

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

  assert.equal(readPassportRecords().length, 3);
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
