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
