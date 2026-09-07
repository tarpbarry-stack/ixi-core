"use strict";

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const TEST_ROOT = path.join(
  "/tmp",
  `ixi-mos-neutral-relationships-${process.pid}`
);

process.env.IXI_MOS_DATA_ROOT = TEST_ROOT;
fs.rmSync(TEST_ROOT, { recursive: true, force: true });

const { createEntity } = require("../entities/entityService");
const { createObject } = require("../objects/objectService");
const { listEvents } = require("../events/eventService");
const {
  createObjectRelationship,
  endObjectRelationship,
  listRelatedObjects,
  listRelationships,
  traverseRelationships
} = require("./relationshipService");
const { EDGE_BEHAVIOR_IDS } = require("./edgeBehaviorRegistry");

function objectWithPassport({ entityId, name, passportId }) {
  return createObject({
    entityId,
    objectType: "generic",
    displayName: name,
    actorId: "owner-1",
    identities: [{ identityType: "ixi-passport", passportId }]
  });
}

const entity = createEntity({
  displayName: "User Defined Business",
  actorId: "owner-1"
});

const joe = objectWithPassport({
  entityId: entity.entityId,
  name: "Joe",
  passportId: "IXI-JOE-001"
});
const employees = objectWithPassport({
  entityId: entity.entityId,
  name: "Employees",
  passportId: "IXI-GROUP-EMPLOYEES"
});
const crew007 = objectWithPassport({
  entityId: entity.entityId,
  name: "Crew 007",
  passportId: "IXI-GROUP-CREW-007"
});
const midland = objectWithPassport({
  entityId: entity.entityId,
  name: "Midland",
  passportId: "IXI-PLACE-MIDLAND"
});
const pickup4 = objectWithPassport({
  entityId: entity.entityId,
  name: "Pickup 4",
  passportId: "IXI-WORK-PICKUP-4"
});

test("one Passport-backed Object can hold multiple simultaneous user-defined relationships", () => {
  const connections = [
    [employees, "employee"],
    [crew007, "member of"],
    [midland, "currently at"],
    [pickup4, "responsible for"]
  ].map(([target, relationshipType], index) =>
    createObjectRelationship({
      relationshipType,
      sourceObjectId: joe.objectId,
      targetObjectId: target.objectId,
      actorId: "owner-1",
      commandId: `joe-relationship-${index + 1}`
    })
  );

  assert.equal(connections.every(result => result.changed), true);
  assert.equal(listRelatedObjects({ objectId: joe.objectId }).length, 4);
  assert.equal(joe.identities[0].passportId, "IXI-JOE-001");

  for (const target of [employees, crew007, midland, pickup4]) {
    const recalled = listRelatedObjects({ objectId: target.objectId });
    assert.equal(recalled.length, 1);
    assert.equal(recalled[0].relatedObject.objectId, joe.objectId);
    assert.equal(recalled[0].relatedObject.identities[0].passportId, "IXI-JOE-001");
  }
});

test("an exact active relationship is idempotent instead of duplicated", () => {
  const replay = createObjectRelationship({
    relationshipType: "MEMBER OF",
    sourceObjectId: joe.objectId,
    targetObjectId: crew007.objectId,
    actorId: "owner-1",
    commandId: "same-fact-again"
  });

  assert.equal(replay.changed, false);
  assert.equal(replay.replayed, true);
  assert.equal(listRelationships({
    sourceObjectId: joe.objectId,
    targetObjectId: crew007.objectId,
    relationshipType: "member of"
  }).length, 1);
});

test("ending one relationship preserves every other relationship and its audit history", () => {
  const membership = listRelationships({
    sourceObjectId: joe.objectId,
    targetObjectId: crew007.objectId,
    relationshipType: "member of"
  })[0];

  const ended = endObjectRelationship({
    relationshipId: membership.relationshipId,
    expectedRevision: membership.revision,
    actorId: "owner-1",
    commandId: "end-crew-007",
    reason: "User changed the relationship"
  });

  assert.equal(ended.relationship.status, "ended");
  assert.equal(ended.relationship.revision, 2);
  assert.equal(listRelatedObjects({ objectId: joe.objectId }).length, 3);
  assert.equal(listRelationships({ status: null }).length, 4);

  const events = listEvents({
    entityId: entity.entityId,
    objectId: joe.objectId
  }).filter(event => event.eventType.startsWith("relationship."));
  assert.equal(events.length, 5);
});

test("recursive recall is cycle-safe and bounded", () => {
  createObjectRelationship({
    relationshipType: "connected back to",
    sourceObjectId: pickup4.objectId,
    targetObjectId: joe.objectId,
    actorId: "owner-1",
    commandId: "safe-cycle-proof"
  });

  const graph = traverseRelationships({
    objectId: employees.objectId,
    maxDepth: 12,
    maxObjects: 100
  });

  assert.equal(graph.truncated, false);
  assert.equal(new Set(graph.objects.map(item => item.object.objectId)).size, graph.objects.length);
  assert.equal(graph.objects.some(item => item.object.objectId === joe.objectId), true);
  assert.equal(graph.objects.some(item => item.object.objectId === pickup4.objectId), true);
});

test("stale relationship changes cannot overwrite a newer revision", () => {
  const responsibility = listRelationships({
    sourceObjectId: joe.objectId,
    targetObjectId: pickup4.objectId,
    relationshipType: "responsible for"
  })[0];

  assert.throws(
    () => endObjectRelationship({
      relationshipId: responsibility.relationshipId,
      expectedRevision: responsibility.revision - 1,
      actorId: "owner-1",
      commandId: "stale-change"
    }),
    error => error.code === "RELATIONSHIP_REVISION_CONFLICT"
  );
});

test("a tenant boundary cannot be crossed by an ordinary relationship command", () => {
  const otherEntity = createEntity({
    displayName: "Unrelated Business",
    actorId: "other-owner"
  });
  const outsideObject = objectWithPassport({
    entityId: otherEntity.entityId,
    name: "Outside Object",
    passportId: "IXI-OUTSIDE-001"
  });

  assert.throws(
    () => createObjectRelationship({
      relationshipType: "user supplied connection",
      sourceObjectId: joe.objectId,
      targetObjectId: outsideObject.objectId,
      actorId: "owner-1",
      commandId: "cross-entity-attempt"
    }),
    error => error.code === "CROSS_ENTITY_RELATIONSHIP_FORBIDDEN"
  );
});

test("technical behavior—not the customer label—defines durable edge identity", () => {
  const first = createObjectRelationship({
    behaviorId: EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP,
    definitionId: "definition_customer_rail_1",
    relationshipLabel: "stored near",
    sourceObjectId: midland.objectId,
    targetObjectId: employees.objectId,
    actorId: "owner-1",
    commandId: "technical-edge-1"
  });
  const renamedReplay = createObjectRelationship({
    behaviorId: EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP,
    definitionId: "definition_customer_rail_1",
    relationshipLabel: "customer renamed this",
    sourceObjectId: midland.objectId,
    targetObjectId: employees.objectId,
    actorId: "owner-1",
    commandId: "technical-edge-2"
  });

  assert.equal(first.changed, true);
  assert.equal(first.relationship.behavior.projectsToRail, true);
  assert.equal(renamedReplay.changed, false);
  assert.equal(renamedReplay.relationship.relationshipLabel, "stored near");
});

test("structural rail cycles are rejected while neutral technical cycles remain valid", () => {
  createObjectRelationship({
    behaviorId: EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP,
    sourceObjectId: employees.objectId,
    targetObjectId: crew007.objectId,
    actorId: "owner-1",
    commandId: "rail-cycle-1"
  });
  createObjectRelationship({
    behaviorId: EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP,
    sourceObjectId: crew007.objectId,
    targetObjectId: pickup4.objectId,
    actorId: "owner-1",
    commandId: "rail-cycle-2"
  });

  assert.throws(
    () => createObjectRelationship({
      behaviorId: EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP,
      sourceObjectId: pickup4.objectId,
      targetObjectId: employees.objectId,
      actorId: "owner-1",
      commandId: "rail-cycle-blocked"
    }),
    error => error?.code === "STRUCTURAL_EDGE_CYCLE"
  );

  const forward = createObjectRelationship({
    behaviorId: EDGE_BEHAVIOR_IDS.NEUTRAL_CONNECTION,
    sourceObjectId: joe.objectId,
    targetObjectId: employees.objectId,
    actorId: "owner-1",
    commandId: "neutral-cycle-1"
  });
  const reverse = createObjectRelationship({
    behaviorId: EDGE_BEHAVIOR_IDS.NEUTRAL_CONNECTION,
    sourceObjectId: employees.objectId,
    targetObjectId: joe.objectId,
    actorId: "owner-1",
    commandId: "neutral-cycle-2"
  });

  assert.equal(forward.changed, true);
  assert.equal(reverse.changed, true);
});
