const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const TEST_ROOT = path.join(
  "/tmp",
  `ixi-aos-environment-relationships-${process.pid}`
);

process.env.IXI_MOS_DATA_ROOT = TEST_ROOT;
fs.rmSync(TEST_ROOT, { recursive: true, force: true });

const { loadAosEnvironment } = require("../accounts/aosEnvironmentService");
const { createObject } = require("../objects/objectService");
const { createObjectRelationship } = require("./relationshipService");
const { EDGE_BEHAVIOR_IDS } = require("./edgeBehaviorRegistry");

test("AOS environment returns active canonical relationships for recall", async () => {
  const initial = await loadAosEnvironment({
    ownerUserId: "relationship-environment-owner",
    displayName: "Relationship Environment"
  });
  const person = createObject({
    entityId: initial.entity.entityId,
    objectType: "person",
    displayName: "Joe",
    actorId: "relationship-environment-owner"
  });
  const userNamedContainer = createObject({
    entityId: initial.entity.entityId,
    objectType: "container",
    displayName: "Crew 007",
    actorId: "relationship-environment-owner"
  });
  const created = createObjectRelationship({
    sourceObjectId: person.objectId,
    targetObjectId: userNamedContainer.objectId,
    relationshipType: "member of",
    actorId: "relationship-environment-owner"
  });

  const environment = await loadAosEnvironment({
    ownerUserId: "relationship-environment-owner",
    displayName: "Relationship Environment"
  });

  assert.equal(environment.relationships.length, 1);
  assert.equal(
    environment.relationships[0].relationshipId,
    created.relationship.relationshipId
  );
  assert.equal(environment.relationships[0].relationshipType, "member of");
});

test("AOS environment projects technical rail edges without requiring a customer word", async () => {
  const environment = await loadAosEnvironment({
    ownerUserId: "relationship-environment-owner",
    displayName: "Relationship Environment"
  });
  const objects = environment.objects.filter(object =>
    ["Joe", "Crew 007"].includes(object.displayName)
  );
  const person = objects.find(object => object.displayName === "Joe");
  const railOwner = objects.find(object => object.displayName === "Crew 007");

  const created = createObjectRelationship({
    sourceObjectId: person.objectId,
    targetObjectId: railOwner.objectId,
    behaviorId: EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP,
    definitionId: "definition_customer_rail",
    orderKey: "000100",
    actorId: "relationship-environment-owner",
    commandId: "environment-rail-projection"
  });

  const refreshed = await loadAosEnvironment({
    ownerUserId: "relationship-environment-owner",
    displayName: "Relationship Environment"
  });
  const rail = refreshed.railProjections[railOwner.objectId];

  assert.equal(created.relationship.relationshipLabel, null);
  assert.equal(rail.behaviorId, EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP);
  assert.deepEqual(rail.members.map(member => member.objectId), [person.objectId]);
  assert.equal(rail.members[0].definitionId, "definition_customer_rail");
});
