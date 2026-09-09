"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-legacy-rail-"));
process.env.IXI_MOS_DATA_ROOT = path.join(testRoot, "mos");
process.env.IXI_PASSPORT_DATA_FILE = path.join(testRoot, "passports.json");

const { createObject } = require("../objects/objectService");
const { writePassportRecords, readPassportRecords } = require("../../passport/passportRegistry");
const { buildRailProjectionMap } = require("../accounts/aosEnvironmentService");
const { EDGE_BEHAVIOR_IDS } = require("../relationships/edgeBehaviorRegistry");

test.after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function objectWithPassport({ objectId, displayName, passportId, directContainerId = null }) {
  const object = createObject({
    entityId: "entity-rail",
    objectType: "customer-object",
    displayName,
    directContainerId,
    identities: [{
      identityType: "ixi-passport",
      passportId,
      entityId: "entity-rail",
      sourceType: "aos-object",
      sourceId: "pending"
    }]
  });
  const objectsPath = path.join(testRoot, "mos", "objects.json");
  const objects = JSON.parse(fs.readFileSync(objectsPath, "utf8"));
  objects[object.objectId].identities[0].sourceId = object.objectId;
  objects[object.objectId].directContainerId = directContainerId;
  fs.writeFileSync(objectsPath, JSON.stringify(objects, null, 2));
  return objects[object.objectId];
}

test("corroborated legacy placement is projected read-only without creating identity", () => {
  const owner = objectWithPassport({
    objectId: "object-locations",
    displayName: "Customer index",
    passportId: "IXIRAIL001"
  });
  const member = objectWithPassport({
    objectId: "object-yard",
    displayName: "Customer place",
    passportId: "IXIRAIL002",
    directContainerId: owner.objectId
  });
  const ignored = objectWithPassport({
    objectId: "object-uncorroborated",
    displayName: "Uncorroborated",
    passportId: "IXIRAIL003"
  });
  writePassportRecords([owner, member, ignored].map(object => ({
    passportId: object.identities[0].passportId,
    entityId: object.entityId,
    status: "active",
    sources: [{ sourceType: "aos-object", sourceId: object.objectId }]
  })));

  const relationships = [member, ignored].map((object, index) => ({
    relationshipId: `relationship-legacy-${index + 1}`,
    entityId: "entity-rail",
    sourceObjectId: object.objectId,
    targetObjectId: owner.objectId,
    behaviorId: null,
    definitionId: null,
    status: "active",
    revision: 1
  }));
  const beforePassports = readPassportRecords().length;
  const projection = buildRailProjectionMap(relationships, [owner, member, ignored]);

  assert.deepEqual(
    projection[owner.objectId].members.map(item => item.objectId),
    [member.objectId]
  );
  assert.deepEqual(
    projection[owner.objectId].members[0].migrationEvidence,
    {
      kind: "legacy-direct-container-corroborated.v1",
      readOnly: true,
      directContainerId: owner.objectId
    }
  );
  assert.equal(readPassportRecords().length, beforePassports);
});

test("governed edge wins when the same legacy member is also present", () => {
  const objectsPath = path.join(testRoot, "mos", "objects.json");
  const objects = Object.values(JSON.parse(fs.readFileSync(objectsPath, "utf8")));
  const owner = objects.find(object => object.displayName === "Customer index");
  const member = objects.find(object => object.displayName === "Customer place");
  const relationships = [
    {
      relationshipId: "relationship-legacy",
      entityId: "entity-rail",
      sourceObjectId: member.objectId,
      targetObjectId: owner.objectId,
      behaviorId: null,
      status: "active",
      revision: 1
    },
    {
      relationshipId: "relationship-governed",
      entityId: "entity-rail",
      sourceObjectId: member.objectId,
      targetObjectId: owner.objectId,
      behaviorId: EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP,
      definitionId: "definition-neutral",
      orderKey: "000100",
      status: "active",
      revision: 2
    }
  ];

  const projection = buildRailProjectionMap(relationships, objects);
  assert.equal(projection[owner.objectId].members.length, 1);
  assert.equal(
    projection[owner.objectId].members[0].relationshipId,
    "relationship-governed"
  );
  assert.equal(projection[owner.objectId].members[0].migrationEvidence, null);
});
