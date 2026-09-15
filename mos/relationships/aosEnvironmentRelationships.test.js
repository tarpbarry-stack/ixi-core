const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const TEST_ROOT = path.join(
  "/tmp",
  `ixi-aos-environment-relationships-${process.pid}`
);

process.env.IXI_MOS_DATA_ROOT = TEST_ROOT;
process.env.IXI_PASSPORT_DATA_FILE = path.join(TEST_ROOT, "passports.json");
fs.rmSync(TEST_ROOT, { recursive: true, force: true });

const { loadAosEnvironment } = require("../accounts/aosEnvironmentService");
const { provisionAosObject } = require("../provisioning/aosObjectProvisioningService");
const { createObjectRelationship } = require("./relationshipService");
const { EDGE_BEHAVIOR_IDS } = require("./edgeBehaviorRegistry");
const { updateObject, getObject } = require("../objects/objectService");

test("AOS environment returns active canonical relationships for recall", async () => {
  const initial = await loadAosEnvironment({
    ownerUserId: "relationship-environment-owner",
    displayName: "Relationship Environment"
  });
  const person = provisionAosObject({
    commandId: "relationship-environment-person",
    entityId: initial.entity.entityId,
    objectType: "person",
    displayName: "Joe",
    actorId: "relationship-environment-owner"
  }).object;
  const userNamedContainer = provisionAosObject({
    commandId: "relationship-environment-card",
    entityId: initial.entity.entityId,
    objectType: "container",
    displayName: "Crew 007",
    actorId: "relationship-environment-owner"
  }).object;
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
  assert.equal(rail.members[0].passportId, person.identities[0].passportId);
  assert.equal(rail.railOwnerPassportId, railOwner.identities[0].passportId);
  assert.equal(rail.members[0].relationshipId, created.relationship.relationshipId);
  assert.equal(rail.members[0].relationshipRevision, 1);
  assert.equal(rail.members[0].relationshipStatus, "active");
  assert.equal(rail.members[0].definitionId, "definition_customer_rail");
});

test("legacy configuration repair restores only valid previews with the same Objects, Passports, and edges", async () => {
  const ownerUserId = "compatibility-owner";
  const initial = await loadAosEnvironment({ ownerUserId, displayName: "Compatibility Entity" });
  const make = (key, objectType) => provisionAosObject({ commandId: `compatibility-${key}`,
    entityId: initial.entity.entityId, objectType, displayName: key, actorId: ownerUserId }).object;
  const index = make("customer-root", "generic");
  const person = make("customer-member", "generic");
  const machine = make("invalid-direct-machine", "machine");
  for (const object of [person, machine]) createObjectRelationship({ sourceObjectId: object.objectId,
    targetObjectId: index.objectId, behaviorId: EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP,
    actorId: ownerUserId, commandId: `compatibility-edge-${object.objectId}` });
  // Reproduce a persisted legacy root which predates membership configuration.
  const legacyRoot = updateObject({ objectId: index.objectId, metadata: { rootContainer: true },
    expectedRevision: index.revision, commandId: "legacy-structural-declaration", actorId: ownerUserId });
  const load = () => loadAosEnvironment({ ownerUserId, displayName: "Compatibility Entity" });
  const missing = await load();
  const reviewOf = environment => environment.objects.find(object => object.objectId === index.objectId).membershipReview;
  const membersOf = environment => (environment.railProjections[index.objectId]?.members || []).map(member => member.objectId);
  assert.equal(reviewOf(missing).state, "unresolved");
  assert.equal(reviewOf(missing).issues.length, 2);
  assert.deepEqual(membersOf(missing), []);
  const passportBytes = fs.readFileSync(process.env.IXI_PASSPORT_DATA_FILE);
  const identities = missing.objects.map(object => [object.objectId, object.identities]);
  const relationships = structuredClone(missing.relationships);
  updateObject({ objectId: index.objectId, expectedRevision: legacyRoot.revision, commandId: "configure-existing-root",
    actorId: ownerUserId, metadata: { systemIndexMembershipPolicy: {
      schema: "aos.system-index-membership.v1", enabled: true, defaultWorkspaceHome: true,
      allowedObjectTypes: ["person"], allowedDefinitionIds: []
    } } });
  const configured = await load();
  assert.deepEqual(reviewOf(configured).issues.map(issue => issue.reason).sort(),
    ["member-classification-required", "member-class-rejected"].sort());
  assert.deepEqual(membersOf(configured), []);
  updateObject({ objectId: person.objectId, objectType: "person", expectedRevision: getObject(person.objectId).revision,
    commandId: "classify-existing-member", actorId: ownerUserId });
  const corrected = await load();
  assert.deepEqual(membersOf(corrected), [person.objectId]);
  assert.deepEqual(reviewOf(corrected).issues.map(issue => [issue.objectId, issue.state]), [[machine.objectId, "invalid"]]);
  assert.deepEqual(corrected.relationships, relationships);
  assert.deepEqual(corrected.objects.map(object => [object.objectId, object.identities]), identities);
  assert.deepEqual(fs.readFileSync(process.env.IXI_PASSPORT_DATA_FILE), passportBytes);
});
