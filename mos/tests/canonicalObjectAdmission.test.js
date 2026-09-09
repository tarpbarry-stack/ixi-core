"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-canonical-admission-"));
process.env.IXI_MOS_DATA_ROOT = path.join(testRoot, "mos");
process.env.IXI_PASSPORT_DATA_FILE = path.join(testRoot, "passports.json");

const { createObject, softDeleteObject } = require("../objects/objectService");
const { createEntity } = require("../entities/entityService");
const {
  bindPassportSource,
  readPassportRecords,
  writePassportRecords
} = require("../../passport/passportRegistry");
const {
  resolveCanonicalObjectIdentity
} = require("../identity/canonicalObjectAdmissionService");
const {
  resolveEntityPassport,
  resolvePersonPassport
} = require("../../identity/IXIPassportIdentityBridge");

test.after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function canonicalFixture({
  entityId = "entity-1",
  passportId = "IXITEST001",
  listingId = "listing-001"
} = {}) {
  const object = createObject({
    entityId,
    objectType: "customer-object",
    displayName: "Customer named object",
    identities: [
      {
        identityType: "ixi-passport",
        passportId,
        entityId,
        sourceType: "aos-object",
        sourceId: "pending"
      },
      {
        identityType: "external-record",
        sourceType: "sharetribe-listing",
        sourceId: listingId
      }
    ]
  });
  object.identities[0].sourceId = object.objectId;

  const objectsPath = path.join(testRoot, "mos", "objects.json");
  const objects = JSON.parse(fs.readFileSync(objectsPath, "utf8"));
  objects[object.objectId] = object;
  fs.writeFileSync(objectsPath, JSON.stringify(objects, null, 2));

  writePassportRecords([{
    passportId,
    sourceType: "sharetribe-listing",
    sourceId: listingId,
    entityId,
    status: "active",
    sources: [
      { sourceType: "sharetribe-listing", sourceId: listingId },
      { sourceType: "aos-object", sourceId: object.objectId }
    ]
  }]);

  return object;
}

test("object ID, permanent Passport, and typed alias resolve to one canonical Object", () => {
  const object = canonicalFixture();
  const result = resolveCanonicalObjectIdentity({
    entityId: "entity-1",
    objectId: object.objectId,
    passportId: "IXITEST001",
    aliases: [{ sourceType: "sharetribe-listing", sourceId: "listing-001" }]
  });

  assert.equal(result.objectId, object.objectId);
  assert.equal(result.passportId, "IXITEST001");
  assert.equal(result.entityId, "entity-1");
});

test("released Object identity supplies a listing alias missing from the Passport record", () => {
  const object = canonicalFixture({
    passportId: "IXITEST007",
    listingId: "released-object-listing-007"
  });
  const passports = readPassportRecords();
  passports[0].sourceType = "aos-object";
  passports[0].sourceId = object.objectId;
  passports[0].sources = [{
    sourceType: "aos-object",
    sourceId: object.objectId
  }];
  writePassportRecords(passports);

  const result = resolveCanonicalObjectIdentity({
    entityId: "entity-1",
    objectId: object.objectId,
    passportId: "IXITEST007",
    aliases: [{
      sourceType: "sharetribe-listing",
      sourceId: "released-object-listing-007"
    }]
  });

  assert.equal(result.objectId, object.objectId);
  assert.equal(result.passportId, "IXITEST007");
  assert.equal(result.aliases.some(alias =>
    alias.sourceType === "sharetribe-listing" &&
    alias.sourceId === "released-object-listing-007"
  ), true);
});

test("released Object source bindings admit their existing listing alias without provisioning", () => {
  const object = canonicalFixture({
    passportId: "IXITEST006",
    listingId: "passport-source-does-not-match"
  });
  const objectsPath = path.join(testRoot, "mos", "objects.json");
  const objects = JSON.parse(fs.readFileSync(objectsPath, "utf8"));
  objects[object.objectId].identities = [objects[object.objectId].identities[0]];
  objects[object.objectId].metadata = {
    sourceBindings: [{
      sourceType: "sharetribe-listing",
      sourceId: "released-listing-006"
    }]
  };
  fs.writeFileSync(objectsPath, JSON.stringify(objects, null, 2));
  const beforeObjects = Object.keys(objects).length;
  const beforePassports = readPassportRecords().length;

  const result = resolveCanonicalObjectIdentity({
    entityId: "entity-1",
    objectId: object.objectId,
    passportId: "IXITEST006",
    aliases: [{
      sourceType: "sharetribe-listing",
      sourceId: "released-listing-006"
    }]
  });

  assert.equal(result.objectId, object.objectId);
  assert.equal(result.passportId, "IXITEST006");
  assert.deepEqual(result.aliases, [{
    sourceType: "sharetribe-listing",
    sourceId: "passport-source-does-not-match"
  }, {
    sourceType: "aos-object",
    sourceId: object.objectId
  }, {
    sourceType: "sharetribe-listing",
    sourceId: "released-listing-006"
  }]);
  assert.equal(
    Object.keys(JSON.parse(fs.readFileSync(objectsPath, "utf8"))).length,
    beforeObjects
  );
  assert.equal(readPassportRecords().length, beforePassports);
});

test("historical Passport IDs resolve to the current permanent Passport", () => {
  const object = canonicalFixture({ passportId: "IXITEST002" });
  const passports = JSON.parse(fs.readFileSync(process.env.IXI_PASSPORT_DATA_FILE, "utf8"));
  passports[0].previousPassportIds = ["IXIOLD0001"];
  writePassportRecords(passports);

  const result = resolveCanonicalObjectIdentity({
    entityId: "entity-1",
    passportId: "IXIOLD0001"
  });
  assert.equal(result.objectId, object.objectId);
  assert.equal(result.passportId, "IXITEST002");
});

test("an unbound Passport requires repair and never provisions an Object", () => {
  writePassportRecords([{
    passportId: "IXITEST003",
    sourceType: "sharetribe-listing",
    sourceId: "listing-unbound",
    entityId: "entity-1",
    status: "active"
  }]);

  assert.throws(
    () => resolveCanonicalObjectIdentity({
      entityId: "entity-1",
      passportId: "IXITEST003"
    }),
    error => error?.code === "CANONICAL_IDENTITY_REPAIR_REQUIRED"
  );
});

test("multiple active Object matches fail closed", () => {
  const first = canonicalFixture({ passportId: "IXITEST004" });
  const second = createObject({
    entityId: "entity-1",
    objectType: "customer-object",
    displayName: "Duplicate",
    identities: [{ identityType: "ixi-passport", passportId: "IXITEST004" }]
  });

  assert.throws(
    () => resolveCanonicalObjectIdentity({
      entityId: "entity-1",
      objectId: first.objectId,
      passportId: "IXITEST004"
    }),
    error => error?.code === "CANONICAL_IDENTITY_CONFLICT" &&
      error?.details?.activeObjectIds?.includes(second.objectId)
  );
});

test("released Object lineage remains evidence while the sole active Object is canonical", () => {
  const released = canonicalFixture({
    passportId: "IXITEST008",
    listingId: "released-lineage-listing-008"
  });
  softDeleteObject({ objectId: released.objectId, actorId: "identity-repair" });

  const active = createObject({
    entityId: "entity-1",
    objectType: "machine",
    displayName: "2019 RIPPER OTHER",
    identities: [{
      identityType: "ixi-passport",
      passportId: "IXITEST008",
      entityId: "entity-1",
      sourceType: "aos-object",
      sourceId: "pending"
    }, {
      identityType: "external-record",
      sourceType: "sharetribe-listing",
      sourceId: "released-lineage-listing-008"
    }]
  });
  const objectsPath = path.join(testRoot, "mos", "objects.json");
  const objects = JSON.parse(fs.readFileSync(objectsPath, "utf8"));
  objects[active.objectId].identities[0].sourceId = active.objectId;
  fs.writeFileSync(objectsPath, JSON.stringify(objects, null, 2));
  bindPassportSource({
    passportId: "IXITEST008",
    sourceType: "aos-object",
    sourceId: active.objectId,
    entityId: "entity-1"
  });

  const result = resolveCanonicalObjectIdentity({
    entityId: "entity-1",
    passportId: "IXITEST008",
    aliases: [{
      sourceType: "sharetribe-listing",
      sourceId: "released-lineage-listing-008"
    }]
  });

  assert.equal(result.objectId, active.objectId);
  assert.equal(result.passportId, "IXITEST008");
  assert.equal(result.object.status, "active");
  assert.ok(result.evidence.length >= 2);

  assert.throws(
    () => resolveCanonicalObjectIdentity({
      entityId: "entity-1",
      objectId: released.objectId,
      passportId: "IXITEST008"
    }),
    error => error?.code === "CANONICAL_IDENTITY_CONFLICT" &&
      error?.details?.suppliedObjectId === released.objectId &&
      error?.details?.activeObjectId === active.objectId
  );
});

test("cross-Entity identity admission is forbidden", () => {
  const object = canonicalFixture({ entityId: "entity-owner", passportId: "IXITEST005" });

  assert.throws(
    () => resolveCanonicalObjectIdentity({
      entityId: "entity-attacker",
      objectId: object.objectId
    }),
    error => error?.code === "CANONICAL_ENTITY_MISMATCH" && error?.statusCode === 403
  );
});

test("transaction identity resolution never creates missing Passports", () => {
  writePassportRecords([]);
  const entity = createEntity({
    displayName: "No implicit identity",
    actorId: "owner-no-passport"
  });
  const person = createObject({
    entityId: entity.entityId,
    objectType: "person",
    displayName: "Owner without Passport",
    actorId: "owner-no-passport"
  });
  const before = readPassportRecords().length;

  assert.throws(
    () => resolveEntityPassport(entity.entityId),
    error => error?.code === "IXI_ENTITY_PASSPORT_REPAIR_REQUIRED"
  );
  assert.throws(
    () => resolvePersonPassport({
      objectId: person.objectId,
      expectedEntityId: entity.entityId
    }),
    error => error?.code === "CANONICAL_IDENTITY_REPAIR_REQUIRED"
  );
  assert.equal(readPassportRecords().length, before);
});
