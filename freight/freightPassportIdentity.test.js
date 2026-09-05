"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-freight-passport-"));
process.env.IXI_MOS_DATA_ROOT = path.join(testRoot, "mos");
process.env.IXI_PASSPORT_DATA_FILE = path.join(testRoot, "passports.json");

const {
  ensurePassportForSource,
  findPassportById,
  findPassportBySource
} = require("../passport/passportRegistry");

const {
  resolveOrProvisionAosObjectForPassport
} = require("../mos/provisioning/aosObjectIdentityResolver");

const { createObject } = require("../mos/objects/objectService");

test.after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test("Passport-first Freight provisioning creates one canonical MOS Object and preserves source aliases", () => {
  const passport = ensurePassportForSource({
    sourceType: "sharetribe-listing",
    sourceId: "listing-123",
    visibility: "private"
  }).passport;

  const input = {
    passportId: passport.passportId,
    entityId: "entity-1",
    actorId: "actor-1",
    source: {
      sourceType: "sharetribe-listing",
      sourceId: "listing-123"
    },
    asset: {
      label: "2019 CAT 336",
      objectType: "machine",
      year: "2019",
      make: "CAT",
      model: "336",
      serialNumber: "ABC123"
    },
    provisionIfMissing: true
  };

  const first = resolveOrProvisionAosObjectForPassport(input);
  const replay = resolveOrProvisionAosObjectForPassport(input);
  const storedPassport = findPassportById(passport.passportId);

  assert.match(first.objectId, /^object_/u);
  assert.equal(replay.objectId, first.objectId);
  assert.equal(first.entityId, "entity-1");
  assert.equal(first.fields.serialNumber, "ABC123");
  assert.equal(storedPassport.entityId, "entity-1");
  assert.equal(
    findPassportBySource("sharetribe-listing", "listing-123").passportId,
    passport.passportId
  );
  assert.equal(
    findPassportBySource("aos-object", first.objectId).passportId,
    passport.passportId
  );
});

test("an unresolvable client Object ID cannot masquerade as a MOS Object", () => {
  const passport = ensurePassportForSource({
    sourceType: "sharetribe-listing",
    sourceId: "listing-456",
    visibility: "private"
  }).passport;

  assert.throws(
    () => resolveOrProvisionAosObjectForPassport({
      passportId: passport.passportId,
      objectId: "6a9b2cc3-e7ab-4267-aed0-138cba998dfa",
      entityId: "entity-1",
      actorId: "actor-1",
      source: {
        sourceType: "sharetribe-listing",
        sourceId: "listing-456"
      },
      asset: { label: "Machine" },
      provisionIfMissing: true
    }),
    error => error?.code === "PASSPORT_OBJECT_MISMATCH" && error?.status === 409
  );
});

test("Passport-first provisioning fails closed when source ownership is not verified", () => {
  const passport = ensurePassportForSource({
    sourceType: "sharetribe-listing",
    sourceId: "listing-789",
    visibility: "private"
  }).passport;

  assert.throws(
    () => resolveOrProvisionAosObjectForPassport({
      passportId: passport.passportId,
      entityId: "entity-1",
      actorId: "actor-1",
      source: {
        sourceType: "sharetribe-listing",
        sourceId: "different-listing"
      },
      asset: { label: "Machine" },
      provisionIfMissing: true
    }),
    error => error?.code === "PASSPORT_NOT_PROVISIONED" && error?.status === 409
  );
});

test("an unbound MOS Object cannot claim a legacy unowned Passport", () => {
  const passport = ensurePassportForSource({
    sourceType: "sharetribe-listing",
    sourceId: "listing-unbound",
    visibility: "private"
  }).passport;
  const object = createObject({
    entityId: "entity-1",
    objectType: "machine",
    displayName: "Unbound machine"
  });

  assert.throws(
    () => resolveOrProvisionAosObjectForPassport({
      passportId: passport.passportId,
      objectId: object.objectId,
      entityId: "entity-1",
      actorId: "actor-1"
    }),
    error => error?.code === "PASSPORT_OBJECT_MISMATCH" && error?.status === 409
  );
});
