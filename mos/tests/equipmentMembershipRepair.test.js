"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-equipment-repair-"));
process.env.IXI_MOS_DATA_ROOT = path.join(testRoot, "mos");
process.env.IXI_PASSPORT_DATA_FILE = path.join(testRoot, "passports.json");

const { createObject, getObject, updateObject } = require("../objects/objectService");
const { writePassportRecords } = require("../../passport/passportRegistry");
const { createObjectRelationship, listRelationships } = require("../relationships/relationshipService");
const { EDGE_BEHAVIOR_IDS } = require("../relationships/edgeBehaviorRegistry");
const { repairEquipmentMembership } = require("../migrations/equipmentMembershipRepairService");

test.after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function createCanonicalObject({ objectType, displayName, metadata = {}, directContainerId = null }) {
  const created = createObject({
    entityId: "entity-equipment-repair",
    objectType,
    displayName,
    metadata,
    directContainerId,
    identities: []
  });
  const passportId = `IXIREPAIR${String(createCanonicalObject.sequence++).padStart(3, "0")}`;
  const updated = updateObject({
    objectId: created.objectId,
    actorId: "repair-test",
    identities: [{
      identityType: "ixi-passport",
      passportId,
      entityId: created.entityId,
      sourceType: "aos-object",
      sourceId: created.objectId
    }]
  });
  createCanonicalObject.passports.push({
    passportId,
    entityId: created.entityId,
    status: "active",
    sources: [{ sourceType: "aos-object", sourceId: created.objectId }]
  });
  writePassportRecords(createCanonicalObject.passports);
  return updated;
}
createCanonicalObject.sequence = 1;
createCanonicalObject.passports = [];

test("repair creates only missing governed memberships and is idempotent", () => {
  const equipment = createCanonicalObject({
    objectType: "system-index",
    displayName: "Customer equipment label",
    metadata: {
      systemIndex: true,
      systemAdapter: true,
      systemIndexPresentation: true,
      adapterId: "ixi-owned-equipment"
    }
  });
  const first = createCanonicalObject({ objectType: "machine", displayName: "First" });
  const second = createCanonicalObject({
    objectType: "machine",
    displayName: "Second",
    directContainerId: "object-legacy-place"
  });

  createObjectRelationship({
    behaviorId: EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP,
    sourceObjectId: first.objectId,
    targetObjectId: equipment.objectId,
    actorId: "repair-test",
    commandId: "existing-membership",
    orderKey: "equipment:000001"
  });

  const passportHashBefore = crypto.createHash("sha256")
    .update(fs.readFileSync(process.env.IXI_PASSPORT_DATA_FILE))
    .digest("hex");
  const relationshipsBefore = listRelationships({ entityId: equipment.entityId });
  const secondObjectBefore = getObject(second.objectId);

  const dryRun = repairEquipmentMembership({
    entityId: equipment.entityId,
    expectedMachineCount: 2
  });
  assert.equal(dryRun.mode, "dry-run");
  assert.equal(dryRun.governedMembershipCountBefore, 1);
  assert.equal(dryRun.missingMembershipCountBefore, 1);
  assert.equal(dryRun.projectedMachineCountBefore, 1);
  assert.deepEqual(listRelationships({ entityId: equipment.entityId }), relationshipsBefore);

  const applied = repairEquipmentMembership({
    entityId: equipment.entityId,
    actorId: "migration-operator",
    expectedMachineCount: 2,
    apply: true
  });
  assert.equal(applied.createdMembershipCount, 1);
  assert.equal(applied.projectedMachineCount, 2);
  assert.equal(applied.projectionMemberCount, 2);

  const replay = repairEquipmentMembership({
    entityId: equipment.entityId,
    actorId: "migration-operator",
    expectedMachineCount: 2,
    apply: true
  });
  assert.equal(replay.createdMembershipCount, 0);
  assert.equal(replay.missingMembershipCountBefore, 0);
  assert.equal(replay.projectedMachineCount, 2);

  const active = listRelationships({
    entityId: equipment.entityId,
    targetObjectId: equipment.objectId,
    behaviorId: EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP
  });
  assert.equal(active.length, 2);
  assert.deepEqual(getObject(second.objectId), secondObjectBefore);
  assert.equal(
    crypto.createHash("sha256")
      .update(fs.readFileSync(process.env.IXI_PASSPORT_DATA_FILE))
      .digest("hex"),
    passportHashBefore
  );
});

test("repair fails closed before writes when the approved census differs", () => {
  const before = listRelationships({ entityId: "entity-equipment-repair" });
  assert.throws(
    () => repairEquipmentMembership({
      entityId: "entity-equipment-repair",
      actorId: "migration-operator",
      expectedMachineCount: 23,
      apply: true
    }),
    error => error?.code === "AOS_EQUIPMENT_MACHINE_COUNT_MISMATCH"
  );
  assert.deepEqual(listRelationships({ entityId: "entity-equipment-repair" }), before);
});
