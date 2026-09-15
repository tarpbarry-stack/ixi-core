"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-owned-equipment-"));
process.env.IXI_MOS_DATA_ROOT = path.join(root, "mos");
process.env.IXI_PASSPORT_DATA_FILE = path.join(root, "passports.json");
const { ensureCommercialOnboarding } = require("../onboarding/aosCommercialOnboardingService");
const { provisionSharetribeMachine } = require("../onboarding/sharetribeMachineProvisioningService");
const { ensureOwnedMachineEquipmentMembership } = require("../onboarding/ownedMachineEquipmentMembershipService");
const { listObjects, updateObject, getObject, createObject } = require("../objects/objectService");
const { readPassportRecords } = require("../../passport/passportRegistry");
const { listRelationships, endObjectRelationship } = require("../relationships/relationshipService");
const { EDGE_BEHAVIOR_IDS } = require("../relationships/edgeBehaviorRegistry");
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function fixture(name) {
  const principalId = `owner-${name}`;
  const owner = ensureCommercialOnboarding({ ownerUserId: principalId, entityDisplayName: name });
  const entityId = owner.entity.entityId;
  const equipment = listObjects({ entityId }).find(object => object.metadata?.adapterId === "ixi-owned-equipment");
  const input = {
    entityId, principalId, commandId: `sharetribe-listing:${name}`,
    creationBoundary: "authenticated-listing-admission.v1",
    listing: {
      listingId: name, displayName: "2018 Komatsu WA500-8", channel: "private",
      ownership: { role: "owner", status: "owned" }, fields: { serialNumber: `SERIAL-${name}` }
    }
  };
  return { input, equipment };
}

function edges(entityId) {
  return listRelationships({ entityId, behaviorId: EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP, status: null });
}

test("owned private creation joins the existing customer-named Equipment index exactly once", () => {
  const { input, equipment } = fixture("private-owned");
  updateObject({ objectId: equipment.objectId, displayName: "MY IRON", actorId: input.principalId });
  const first = provisionSharetribeMachine(input);
  const objectsBefore = listObjects({ status: null });
  const passportsBefore = readPassportRecords();
  const edgesBefore = edges(input.entityId);
  const second = provisionSharetribeMachine(input);
  assert.equal(first.equipmentMembership.changed, true);
  assert.equal(first.equipmentMembership.equipmentObjectId, equipment.objectId);
  assert.equal(first.passport.visibility, "private");
  assert.equal(second.replayed, true);
  assert.equal(second.equipmentMembership.changed, false);
  assert.deepEqual(listObjects({ status: null }), objectsBefore);
  assert.deepEqual(readPassportRecords(), passportsBefore);
  assert.deepEqual(edges(input.entityId), edgesBefore);
  assert.equal(edgesBefore.length, 1);
  assert.equal(edgesBefore[0].sourceObjectId, first.object.objectId);
  assert.equal(getObject(equipment.objectId).displayName, "MY IRON");
});

test("visibility and listing authorship never imply ownership", () => {
  for (const [name, ownership, channel] of [
    ["url-reference", { role: "non-owner", status: "reference" }, "auction"],
    ["unknown-private", undefined, "private"],
    ["sold", { role: "owner", status: "sold" }, "private"],
    ["broker", { role: "broker", status: "owned" }, "marketplace"],
    ["missing-status", { role: "owner" }, "private"]
  ]) {
    const { input } = fixture(name);
    input.listing.ownership = ownership;
    input.listing.channel = channel;
    const result = provisionSharetribeMachine(input);
    assert.equal(result.equipmentMembership.status, "not-owned");
    assert.equal(edges(input.entityId).length, 0);
  }
});

test("replaying a previously provisioned owned machine repairs only its missing membership", () => {
  const { input } = fixture("existing-wa500");
  const oldInput = { ...input, listing: { ...input.listing, ownership: undefined } };
  const first = provisionSharetribeMachine(oldInput);
  const objectsBefore = listObjects({ status: null });
  const passportsBefore = readPassportRecords();
  const allEdgesBefore = listRelationships({ status: null });
  const repair = { ...input, objectId: first.object.objectId, passportId: first.passport.passportId };
  assert.equal(ensureOwnedMachineEquipmentMembership({ ...repair, apply: false }).status, "missing");
  assert.deepEqual(listRelationships({ status: null }), allEdgesBefore);
  const repaired = provisionSharetribeMachine(input);
  assert.equal(repaired.replayed, true);
  assert.equal(repaired.object.objectId, first.object.objectId);
  assert.equal(repaired.passport.passportId, first.passport.passportId);
  assert.equal(repaired.equipmentMembership.changed, true);
  assert.deepEqual(listObjects({ status: null }), objectsBefore);
  assert.deepEqual(readPassportRecords(), passportsBefore);
  const allEdgesAfter = listRelationships({ status: null });
  assert.deepEqual(allEdgesAfter.filter(edge => edge.relationshipId !== repaired.equipmentMembership.relationship.relationshipId), allEdgesBefore);
  assert.equal(ensureOwnedMachineEquipmentMembership(repair).changed, false);
});

test("a retry cannot undo an operator's subsequent Equipment removal", () => {
  const { input } = fixture("removed");
  const first = provisionSharetribeMachine(input);
  endObjectRelationship({ relationshipId: first.equipmentMembership.relationship.relationshipId,
    expectedRevision: first.equipmentMembership.relationship.revision,
    actorId: input.principalId, commandId: "remove-from-equipment", reason: "operator-removal" });
  const before = edges(input.entityId);
  const second = provisionSharetribeMachine(input);
  assert.equal(second.equipmentMembership.status, "previously-removed");
  assert.deepEqual(edges(input.entityId), before);
});

test("invalid or ambiguous Equipment configuration fails before creating a machine", () => {
  const { input, equipment } = fixture("invalid-index");
  updateObject({ objectId: equipment.objectId, actorId: input.principalId,
    metadata: { ...equipment.metadata, systemAdapter: false } });
  const before = listObjects({ status: null });
  const passports = readPassportRecords();
  assert.throws(() => provisionSharetribeMachine(input), { code: "IXI_MACHINE_EQUIPMENT_INDEX_INVALID" });
  assert.deepEqual(listObjects({ status: null }), before);
  assert.deepEqual(readPassportRecords(), passports);
  updateObject({ objectId: equipment.objectId, actorId: input.principalId, metadata: equipment.metadata });
  createObject({ entityId: input.entityId, objectType: "system-index", displayName: "Duplicate index", metadata: equipment.metadata });
  const duplicatedBefore = listObjects({ status: null });
  assert.throws(() => provisionSharetribeMachine(input), { code: "IXI_MACHINE_EQUIPMENT_INDEX_INVALID" });
  assert.deepEqual(listObjects({ status: null }), duplicatedBefore);
  assert.deepEqual(readPassportRecords(), passports);
});

test("Equipment onboarding remains valid when its presentation flag is off", () => {
  const { input, equipment } = fixture("presentation-independent-index");
  updateObject({ objectId: equipment.objectId, actorId: input.principalId,
    metadata: { ...equipment.metadata, systemIndexPresentation: false },
    cardTemplateSlug: "aos-card-007" });
  const result = provisionSharetribeMachine(input);
  assert.equal(result.equipmentMembership.equipmentObjectId, equipment.objectId);
  assert.equal(result.equipmentMembership.status, "member");
  assert.equal(edges(input.entityId).filter(edge => edge.sourceObjectId === result.object.objectId).length, 1);
});

test("repair rejects foreign or mismatched identity without changing any membership", () => {
  const a = fixture("tenant-a");
  const b = fixture("tenant-b");
  const first = provisionSharetribeMachine({ ...a.input, listing: { ...a.input.listing, ownership: undefined } });
  const second = provisionSharetribeMachine({ ...b.input, listing: { ...b.input.listing, ownership: undefined } });
  const before = listRelationships({ status: null });
  const repair = { ...a.input, objectId: first.object.objectId, passportId: first.passport.passportId };
  assert.throws(() => ensureOwnedMachineEquipmentMembership({ ...repair, entityId: b.input.entityId }), { code: "CANONICAL_ENTITY_MISMATCH" });
  assert.throws(() => ensureOwnedMachineEquipmentMembership({ ...repair, passportId: second.passport.passportId }));
  assert.deepEqual(listRelationships({ status: null }), before);
});
