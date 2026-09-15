"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "ixi-aos-index-policy-")
);

process.env.IXI_MOS_DATA_ROOT = path.join(testRoot, "mos");

const { createEntity } = require("../entities/entityService");
const { createObject, updateObject } = require("../objects/objectService");
const {
  createCustomerObjectType
} = require("../objects/customerObjectTypeService");
const {
  createObjectRelationship
} = require("./relationshipService");
const {
  AOS_SYSTEM_INDEX_MEMBERSHIP_POLICY_SCHEMA,
  evaluateAosRailMembership
} = require("./aosSystemIndexMembershipPolicy");
const { EDGE_BEHAVIOR_IDS } = require("./edgeBehaviorRegistry");

test.after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

const entity = createEntity({
  displayName: "Policy Test Entity",
  actorId: "policy-owner"
});

function createTypedObject(objectType, displayName, metadata = {}) {
  return createObject({
    entityId: entity.entityId,
    objectType,
    displayName,
    actorId: "policy-owner",
    metadata
  });
}

function membership(sourceObject, targetObject, commandId) {
  return createObjectRelationship({
    behaviorId: EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP,
    sourceObjectId: sourceObject.objectId,
    targetObjectId: targetObject.objectId,
    actorId: "policy-owner",
    commandId,
    orderKey: commandId
  });
}

function policy({ allowedObjectTypes = [], allowedDefinitionIds = [] } = {}) {
  return {
    schema: AOS_SYSTEM_INDEX_MEMBERSHIP_POLICY_SCHEMA,
    enabled: true,
    defaultWorkspaceHome: true,
    allowedObjectTypes,
    allowedDefinitionIds
  };
}

test("System Index membership is governed by technical type and definition identity", () => {
  const location = createTypedObject("location", "Customer Label A");
  const person = createTypedObject("person", "Customer Label B");
  const machine = createTypedObject("machine", "Customer Label C");
  const locationIndex = createTypedObject("system-index", "Customer Root A", {
    systemIndex: true,
    systemIndexMembershipPolicy: policy({ allowedObjectTypes: ["location"] })
  });
  const workforceIndex = createTypedObject("system-index", "Customer Root B", {
    systemIndex: true,
    systemIndexMembershipPolicy: policy({ allowedObjectTypes: ["person"] })
  });

  assert.equal(membership(location, locationIndex, "location-admission").changed, true);
  assert.equal(membership(person, workforceIndex, "person-admission").changed, true);
  assert.throws(
    () => membership(machine, locationIndex, "machine-location-rejected"),
    error => error?.code === "AOS_SYSTEM_INDEX_MEMBER_REJECTED"
  );
  assert.throws(
    () => membership(person, locationIndex, "person-location-rejected"),
    error => error?.code === "AOS_SYSTEM_INDEX_MEMBER_REJECTED"
  );
});

test("System Indexes are root projections and can never be nested", () => {
  const ordinaryContainer = createTypedObject("container", "Ordinary Container");
  const rootIndex = createTypedObject("system-index", "Root Projection", {
    systemIndex: true,
    systemIndexMembershipPolicy: policy({ allowedObjectTypes: ["location"] })
  });

  assert.throws(
    () => membership(rootIndex, ordinaryContainer, "index-ordinary-rejected"),
    error => error?.code === "AOS_SYSTEM_INDEX_ROOT_MEMBERSHIP_PROHIBITED"
  );
});

test("unconfigured System Indexes fail closed while ordinary containers stay composable", () => {
  const machine = createTypedObject("machine", "Machine");
  const unconfiguredIndex = createTypedObject("system-index", "Unconfigured", {
    systemIndex: true
  });
  const ordinaryContainer = createTypedObject("container", "Ordinary");

  assert.throws(
    () => membership(machine, unconfiguredIndex, "missing-policy-rejected"),
    error => error?.code === "AOS_SYSTEM_INDEX_MEMBERSHIP_POLICY_REQUIRED"
  );
  assert.equal(membership(machine, ordinaryContainer, "ordinary-allowed").changed, true);
});

test("customer definitions govern membership without customer labels in engine code", () => {
  const definition = createCustomerObjectType({
    entityId: entity.entityId,
    label: "Customer Controlled Type",
    definitionKey: "customer-controlled-type",
    actorId: "policy-owner"
  });
  const member = createObject({
    entityId: entity.entityId,
    definitionId: definition.definitionId,
    displayName: "Definition Member",
    actorId: "policy-owner"
  });
  const index = createTypedObject("system-index", "Customer Renamable Index", {
    systemIndex: true,
    systemIndexMembershipPolicy: policy({
      allowedDefinitionIds: [definition.definitionId]
    })
  });

  assert.equal(membership(member, index, "definition-admission").changed, true);
  assert.equal(
    evaluateAosRailMembership({ sourceObject: member, targetObject: index }).reason,
    "definition-allowed"
  );
});

test("System Index policy writes are schema-valid and cannot declare another root class", () => {
  assert.throws(
    () => createTypedObject("system-index", "Invalid Root", {
      systemIndex: true,
      systemIndexMembershipPolicy: {
        schema: AOS_SYSTEM_INDEX_MEMBERSHIP_POLICY_SCHEMA,
        enabled: true,
        defaultWorkspaceHome: true,
        allowedObjectTypes: [],
        allowedDefinitionIds: []
      }
    }),
    error => error?.code === "AOS_SYSTEM_INDEX_MEMBERSHIP_POLICY_INVALID"
  );

  const root = createTypedObject("system-index", "Valid Root", {
    systemIndex: true,
    systemIndexMembershipPolicy: policy({ allowedObjectTypes: ["location"] })
  });

  assert.throws(
    () => updateObject({
      objectId: root.objectId,
      actorId: "policy-owner",
      metadata: {
        systemIndexMembershipPolicy: policy({
          allowedObjectTypes: ["system-index"]
        })
      }
    }),
    error => error?.code === "AOS_SYSTEM_INDEX_ROOT_MEMBERSHIP_PROHIBITED"
  );
});

test("the platform-owned Equipment adapter cannot be widened by Object metadata", () => {
  const equipment = createTypedObject("system-index", "Technical Adapter", {
    systemIndex: true,
    systemAdapter: true,
    adapterId: "ixi-owned-equipment",
    systemIndexMembershipPolicy: policy({ allowedObjectTypes: ["person"] })
  });
  const machine = createTypedObject("machine", "Machine Member");
  const person = createTypedObject("person", "Person Member");

  assert.equal(
    evaluateAosRailMembership({
      sourceObject: machine,
      targetObject: equipment
    }).allowed,
    true
  );
  assert.equal(
    evaluateAosRailMembership({
      sourceObject: person,
      targetObject: equipment
    }).allowed,
    false
  );
});
