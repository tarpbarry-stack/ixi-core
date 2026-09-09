"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-equipment-current-"));
process.env.IXI_MOS_DATA_ROOT = path.join(testRoot, "mos");
process.env.IXI_PASSPORT_DATA_FILE = path.join(testRoot, "passports.json");

const { createObject, updateObject, listObjects } = require("../objects/objectService");
const {
  writePassportRecords,
  readPassportRecords
} = require("../../passport/passportRegistry");
const {
  createObjectRelationship,
  listRelationships
} = require("../relationships/relationshipService");
const { EDGE_BEHAVIOR_IDS } = require("../relationships/edgeBehaviorRegistry");
const {
  resolveCanonicalObjectIdentity
} = require("../identity/canonicalObjectAdmissionService");
const {
  reconcileEquipmentInventory
} = require("../migrations/equipmentInventoryReconciliationService");

const ENTITY = "entity-current-equipment";
const ACTOR = "migration-current-equipment";
let passportSequence = 1;
let passports = [];

test.after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function passportId() {
  return `IXICURRENT${String(passportSequence++).padStart(2, "0")}`;
}

function persistPassports() {
  writePassportRecords(passports);
}

function createCanonicalObject({
  objectType,
  displayName,
  listingId = "",
  serialNumber = "",
  metadata = {}
}) {
  const object = createObject({
    entityId: ENTITY,
    objectType,
    displayName,
    fields: serialNumber ? { serialNumber } : {},
    metadata,
    identities: listingId ? [{
      identityType: "external-record",
      sourceType: "sharetribe-listing",
      sourceId: listingId
    }] : []
  });
  const assignedPassportId = passportId();
  const updated = updateObject({
    objectId: object.objectId,
    actorId: ACTOR,
    identities: [{
      identityType: "ixi-passport",
      passportId: assignedPassportId,
      entityId: ENTITY,
      sourceType: "aos-object",
      sourceId: object.objectId
    }, ...(listingId ? [{
      identityType: "external-record",
      sourceType: "sharetribe-listing",
      sourceId: listingId
    }] : [])]
  });
  passports.push({
    passportId: assignedPassportId,
    entityId: ENTITY,
    status: "active",
    sources: [
      { sourceType: "aos-object", sourceId: object.objectId },
      ...(listingId ? [{ sourceType: "sharetribe-listing", sourceId: listingId }] : [])
    ]
  });
  persistPassports();
  return updated;
}

function createPassportOnlyListing(listingId) {
  const assignedPassportId = passportId();
  passports.push({
    passportId: assignedPassportId,
    entityId: ENTITY,
    status: "active",
    sources: [{ sourceType: "sharetribe-listing", sourceId: listingId }]
  });
  persistPassports();
  return assignedPassportId;
}

function membership(sourceObjectId, targetObjectId, commandId) {
  return createObjectRelationship({
    behaviorId: EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP,
    sourceObjectId,
    targetObjectId,
    actorId: ACTOR,
    commandId,
    orderKey: commandId
  }).relationship;
}

test("reconciliation reuses Passport-only listings and replaces stale Equipment edges without deleting history", () => {
  const equipment = createCanonicalObject({
    objectType: "system-index",
    displayName: "Customer Equipment",
    metadata: {
      systemIndex: true,
      systemAdapter: true,
      systemIndexPresentation: true,
      adapterId: "ixi-owned-equipment"
    }
  });
  const current = createCanonicalObject({
    objectType: "machine",
    displayName: "Current machine",
    listingId: "listing-current",
    serialNumber: "CURRENT-001"
  });
  const stale = createCanonicalObject({
    objectType: "machine",
    displayName: "Historical active machine",
    listingId: "listing-historical",
    serialNumber: "HISTORY-001"
  });
  const missingPassportId = createPassportOnlyListing("listing-passport-only");
  membership(current.objectId, equipment.objectId, "member-current");
  const staleEdge = membership(stale.objectId, equipment.objectId, "member-stale");

  const inventory = [{
    listingId: "listing-current",
    displayName: "Current machine",
    fields: { serialNumber: "CURRENT-001" }
  }, {
    listingId: "listing-passport-only",
    displayName: "Passport-only machine",
    fields: { serialNumber: "CURRENT-002" }
  }];
  const passportCount = readPassportRecords().length;

  const dryRun = reconcileEquipmentInventory({
    entityId: ENTITY,
    inventory,
    expectedListingCount: 2
  });
  assert.equal(dryRun.existingCanonicalListingCount, 1);
  assert.equal(dryRun.missingCanonicalObjectCount, 1);
  assert.equal(dryRun.staleMembershipCount, 1);

  const applied = reconcileEquipmentInventory({
    entityId: ENTITY,
    actorId: ACTOR,
    inventory,
    expectedListingCount: 2,
    apply: true
  });
  assert.equal(applied.provisionedObjectCount, 1);
  assert.equal(applied.endedMembershipCount, 1);
  assert.equal(applied.createdMembershipCount, 1);
  assert.equal(applied.projectionMemberCount, 2);
  assert.equal(readPassportRecords().length, passportCount);

  const admitted = resolveCanonicalObjectIdentity({
    entityId: ENTITY,
    aliases: [{ sourceType: "sharetribe-listing", sourceId: "listing-passport-only" }]
  });
  assert.equal(admitted.passportId, missingPassportId);
  assert.equal(admitted.object.objectType, "machine");
  assert.equal(admitted.object.fields.serialNumber, "CURRENT-002");
  assert.equal(listObjects({ entityId: ENTITY, status: "active" }).filter(item => item.objectType === "machine").length, 3);

  const active = listRelationships({
    entityId: ENTITY,
    targetObjectId: equipment.objectId,
    behaviorId: EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP,
    status: "active"
  });
  assert.deepEqual(
    new Set(active.map(item => item.sourceObjectId)),
    new Set([current.objectId, admitted.objectId])
  );
  assert.equal(
    listRelationships({ entityId: ENTITY, status: null })
      .find(item => item.relationshipId === staleEdge.relationshipId)?.status,
    "ended"
  );
  assert.equal(listObjects({ entityId: ENTITY, status: "active" }).some(item => item.objectId === stale.objectId), true);

  const replay = reconcileEquipmentInventory({
    entityId: ENTITY,
    actorId: ACTOR,
    inventory,
    expectedListingCount: 2,
    apply: true
  });
  assert.equal(replay.missingCanonicalObjectCount, 0);
  assert.equal(replay.staleMembershipCount, 0);
  assert.equal(replay.provisionedObjectCount, 0);
  assert.equal(replay.endedMembershipCount, 0);
  assert.equal(replay.createdMembershipCount, 0);
});

test("reconciliation fails closed before writes on a cross-Passport serial collision", () => {
  const beforeObjects = listObjects({ entityId: ENTITY, status: null });
  const beforeRelationships = listRelationships({ entityId: ENTITY, status: null });
  createPassportOnlyListing("listing-collision");

  assert.throws(
    () => reconcileEquipmentInventory({
      entityId: ENTITY,
      actorId: ACTOR,
      inventory: [{
        listingId: "listing-collision",
        displayName: "Collision",
        fields: { serialNumber: "HISTORY-001" }
      }],
      expectedListingCount: 1,
      apply: true
    }),
    error => error?.code === "AOS_EQUIPMENT_SERIAL_IDENTITY_CONFLICT"
  );
  assert.deepEqual(listObjects({ entityId: ENTITY, status: null }), beforeObjects);
  assert.deepEqual(listRelationships({ entityId: ENTITY, status: null }), beforeRelationships);
});
