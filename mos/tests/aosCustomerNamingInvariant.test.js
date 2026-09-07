"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "ixi-aos-customer-naming-")
);

process.env.IXI_MOS_DATA_ROOT = path.join(testRoot, "mos");
process.env.IXI_PASSPORT_DATA_FILE = path.join(testRoot, "passports.json");

const {
  createObject,
  getObject,
  listObjects,
  updateObject
} = require("../objects/objectService");
const {
  createObjectRelationship
} = require("../relationships/relationshipService");
const {
  rebuildEntityProjections
} = require("../projections/projectionService");
const {
  enforceEntityPassportIntegrity
} = require("../provisioning/aosIdentityIntegrityService");

test.after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test("customer names survive creation, containment, projection, Passport repair, and refresh", () => {
  const entityId = "entity-customer-language";
  const actorId = "customer-owner";
  const container = createObject({
    entityId,
    objectType: "container",
    displayName: "Whatever We Call Our Workforce",
    customerCategory: "Our People",
    actorId
  });
  const person = createObject({
    entityId,
    objectType: "person",
    displayName: "Joe",
    customerCategory: "Crew 007",
    actorId
  });

  createObjectRelationship({
    sourceObjectId: person.objectId,
    targetObjectId: container.objectId,
    relationshipType: "works with",
    actorId
  });

  rebuildEntityProjections({ entityId });

  enforceEntityPassportIntegrity({ entityId, actorId });

  assert.equal(getObject(container.objectId).displayName, "Whatever We Call Our Workforce");
  assert.equal(getObject(container.objectId).customerCategory, "Our People");
  assert.equal(getObject(person.objectId).displayName, "Joe");
  assert.equal(getObject(person.objectId).customerCategory, "Crew 007");
});

test("IX Core never classifies a System Index from customer wording and never reverses a rename", () => {
  const entityId = "entity-index-language";
  const actorId = "index-owner";
  const customerIndex = createObject({
    entityId,
    objectType: "system-index",
    displayName: "EQUIPMENT",
    actorId
  });

  const first = enforceEntityPassportIntegrity({ entityId, actorId });
  const canonicalEquipment = listObjects({ entityId, status: "active" }).find(
    object => object.metadata?.adapterId === "ixi-owned-equipment"
  );

  assert.ok(canonicalEquipment);
  assert.notEqual(canonicalEquipment.objectId, customerIndex.objectId);

  const renamed = updateObject({
    objectId: canonicalEquipment.objectId,
    displayName: "MY IRON",
    actorId
  });
  assert.equal(renamed.displayName, "MY IRON");

  enforceEntityPassportIntegrity({ entityId, actorId });
  assert.equal(getObject(canonicalEquipment.objectId).displayName, "MY IRON");
  assert.equal(first.ok, true);
});
