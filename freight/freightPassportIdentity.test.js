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

const {
  provisionAosObject
} = require("../mos/provisioning/aosObjectProvisioningService");

const { createObject } = require("../mos/objects/objectService");

test.after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test("Freight resolves an explicitly provisioned canonical Object without creating identity", () => {
  const passport = ensurePassportForSource({
    sourceType: "sharetribe-listing",
    sourceId: "listing-123",
    visibility: "private"
  }).passport;

  const provisioned = provisionAosObject({
    contractVersion: "ixi-aos-object-provision-v1",
    commandId: "explicit-upload:listing-123",
    entityId: "entity-1",
    actorId: "actor-1",
    objectType: "machine",
    displayName: "2019 CAT 336",
    source: "authorized-upload",
    trustedPassportId: passport.passportId,
    fields: {
      year: "2019",
      make: "CAT",
      model: "336",
      serialNumber: "ABC123"
    },
    identities: [{
      identityType: "external-record",
      sourceType: "sharetribe-listing",
      sourceId: "listing-123"
    }]
  });

  const input = {
    passportId: passport.passportId,
    objectId: provisioned.object.objectId,
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
    provisionIfMissing: false
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

test("an unresolvable client Object ID cannot masquerade as a canonical Object", () => {
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
      provisionIfMissing: false
    }),
    error => error?.code === "CANONICAL_OBJECT_NOT_FOUND" && error?.statusCode === 404
  );
});

test("Freight resolution fails closed when the typed alias is not recognized", () => {
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
      provisionIfMissing: false
    }),
    error => error?.code === "CANONICAL_ALIAS_NOT_FOUND" && error?.statusCode === 404
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
    error => error?.code === "CANONICAL_IDENTITY_REPAIR_REQUIRED" && error?.statusCode === 409
  );
});

test("Freight cannot turn a verified source flag into Object creation authority", () => {
  const passport = ensurePassportForSource({
    sourceType: "sharetribe-listing",
    sourceId: "listing-no-birth",
    visibility: "private"
  }).passport;

  assert.throws(
    () => resolveOrProvisionAosObjectForPassport({
      passportId: passport.passportId,
      entityId: "entity-1",
      source: {
        sourceType: "sharetribe-listing",
        sourceId: "listing-no-birth",
        verified: true
      },
      provisionIfMissing: true
    }),
    error => error?.code === "CANONICAL_CREATION_BOUNDARY_REQUIRED" &&
      error?.statusCode === 409
  );
});
