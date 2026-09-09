"use strict";

const {
  listObjects
} = require("../objects/objectService");

const {
  listRelationships,
  createObjectRelationship
} = require("../relationships/relationshipService");

const {
  EDGE_BEHAVIOR_IDS
} = require("../relationships/edgeBehaviorRegistry");

const {
  resolveCanonicalObjectIdentity
} = require("../identity/canonicalObjectAdmissionService");

const {
  buildRailProjectionMap
} = require("../accounts/aosEnvironmentService");

const {
  cleanText
} = require("../util/normalize");

const {
  MosError
} = require("../errors/MosError");

const EQUIPMENT_ADAPTER_ID = "ixi-owned-equipment";
const MIGRATION_ID = "aos-equipment-membership-v1";

function equipmentIndexForEntity(objects, entityId) {
  const matches = objects.filter(object =>
    object?.status === "active" &&
    cleanText(object?.entityId) === entityId &&
    cleanText(object?.objectType) === "system-index" &&
    cleanText(object?.metadata?.adapterId) === EQUIPMENT_ADAPTER_ID &&
    object?.metadata?.systemIndex === true &&
    object?.metadata?.systemAdapter === true &&
    object?.metadata?.systemIndexPresentation === true
  );

  if (matches.length !== 1) {
    throw new MosError(
      "AOS_EQUIPMENT_INDEX_CARDINALITY_INVALID",
      "Exactly one active governed Equipment System Index is required.",
      {
        entityId,
        adapterId: EQUIPMENT_ADAPTER_ID,
        objectIds: matches.map(object => object.objectId)
      },
      409
    );
  }

  return matches[0];
}

function machineObjectsForEntity(objects, entityId) {
  return objects
    .filter(object =>
      object?.status === "active" &&
      cleanText(object?.entityId) === entityId &&
      cleanText(object?.objectType) === "machine"
    )
    .sort((left, right) =>
      cleanText(left?.createdAt).localeCompare(cleanText(right?.createdAt)) ||
      cleanText(left?.objectId).localeCompare(cleanText(right?.objectId))
    );
}

function assertExpectedMachineCount(machines, expectedMachineCount, entityId) {
  if (!Number.isInteger(expectedMachineCount) || expectedMachineCount < 0) {
    throw new MosError(
      "AOS_EQUIPMENT_EXPECTED_COUNT_REQUIRED",
      "A non-negative expected machine count is required before repair.",
      { entityId, expectedMachineCount },
      400
    );
  }

  if (machines.length !== expectedMachineCount) {
    throw new MosError(
      "AOS_EQUIPMENT_MACHINE_COUNT_MISMATCH",
      "The active machine census does not match the approved repair count.",
      {
        entityId,
        expectedMachineCount,
        actualMachineCount: machines.length,
        objectIds: machines.map(machine => machine.objectId)
      },
      409
    );
  }
}

function verifyCanonicalIdentities(objects, entityId) {
  return objects.map(object => resolveCanonicalObjectIdentity({
    entityId,
    objectId: object.objectId
  }));
}

function activeGovernedMemberships(relationships, equipmentObjectId) {
  return relationships.filter(relationship =>
    relationship?.status === "active" &&
    relationship?.behaviorId === EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP &&
    cleanText(relationship?.targetObjectId) === equipmentObjectId
  );
}

function buildRepairPlan({ entityId, expectedMachineCount }) {
  const normalizedEntityId = cleanText(entityId);
  if (!normalizedEntityId) {
    throw new MosError(
      "AOS_EQUIPMENT_ENTITY_REQUIRED",
      "Entity ID is required for Equipment membership repair.",
      null,
      400
    );
  }

  const objects = listObjects({ entityId: normalizedEntityId, status: "active" });
  const equipment = equipmentIndexForEntity(objects, normalizedEntityId);
  const machines = machineObjectsForEntity(objects, normalizedEntityId);
  assertExpectedMachineCount(machines, expectedMachineCount, normalizedEntityId);

  /* Fail closed before the first write if any Object or Passport is ambiguous. */
  const identities = verifyCanonicalIdentities(
    [equipment, ...machines],
    normalizedEntityId
  );
  const identityByObjectId = new Map(
    identities.map(identity => [identity.objectId, identity])
  );

  const relationships = listRelationships({
    entityId: normalizedEntityId,
    status: "active"
  });
  const machineIds = new Set(machines.map(machine => machine.objectId));
  const governed = activeGovernedMemberships(relationships, equipment.objectId)
    .filter(relationship => machineIds.has(relationship.sourceObjectId));
  const governedMachineIds = new Set(governed.map(item => item.sourceObjectId));
  const missingMachines = machines.filter(machine =>
    !governedMachineIds.has(machine.objectId)
  );
  const currentProjection = buildRailProjectionMap(relationships, objects);
  const projectedIds = new Set(
    (currentProjection[equipment.objectId]?.members || [])
      .map(member => member.objectId)
  );
  const foreignProjectedObjectIds = [...projectedIds]
    .filter(objectId => !machineIds.has(objectId));

  if (foreignProjectedObjectIds.length) {
    throw new MosError(
      "AOS_EQUIPMENT_PROJECTION_CONTAMINATED",
      "Equipment projects active non-machine Objects and cannot be repaired automatically.",
      {
        entityId: normalizedEntityId,
        equipmentObjectId: equipment.objectId,
        foreignProjectedObjectIds
      },
      409
    );
  }

  return {
    entityId: normalizedEntityId,
    equipment,
    machines,
    relationships,
    identityByObjectId,
    governed,
    missingMachines,
    projectedMachineCountBefore: projectedIds.size
  };
}

function verifyCompleteProjection(plan) {
  const currentRelationships = listRelationships({
    entityId: plan.entityId,
    status: "active"
  });
  const currentObjects = listObjects({
    entityId: plan.entityId,
    status: "active"
  });
  const projection = buildRailProjectionMap(currentRelationships, currentObjects);
  const projectedIds = new Set(
    (projection[plan.equipment.objectId]?.members || [])
      .map(member => member.objectId)
  );
  const missingProjectedObjectIds = plan.machines
    .map(machine => machine.objectId)
    .filter(objectId => !projectedIds.has(objectId));
  const machineIds = new Set(plan.machines.map(machine => machine.objectId));
  const foreignProjectedObjectIds = [...projectedIds]
    .filter(objectId => !machineIds.has(objectId));

  if (missingProjectedObjectIds.length || foreignProjectedObjectIds.length) {
    throw new MosError(
      "AOS_EQUIPMENT_PROJECTION_INCOMPLETE",
      "Equipment membership repair did not project every active machine.",
      {
        entityId: plan.entityId,
        equipmentObjectId: plan.equipment.objectId,
        missingProjectedObjectIds,
        foreignProjectedObjectIds
      },
      500
    );
  }

  return {
    projectedMachineCount: plan.machines.length,
    projectionMemberCount: projectedIds.size
  };
}

function repairEquipmentMembership({
  entityId,
  actorId,
  expectedMachineCount,
  apply = false
} = {}) {
  const plan = buildRepairPlan({ entityId, expectedMachineCount });
  const normalizedActorId = cleanText(actorId);

  if (apply && !normalizedActorId) {
    throw new MosError(
      "AOS_EQUIPMENT_REPAIR_ACTOR_REQUIRED",
      "An explicit repair actor is required before applying Equipment memberships.",
      { entityId: plan.entityId },
      401
    );
  }

  const results = [];
  if (apply) {
    const missingMachineIds = new Set(
      plan.missingMachines.map(machine => machine.objectId)
    );
    plan.machines.forEach((machine, index) => {
      if (!missingMachineIds.has(machine.objectId)) {
        return;
      }

      const identity = plan.identityByObjectId.get(machine.objectId);
      results.push(createObjectRelationship({
        behaviorId: EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP,
        sourceObjectId: machine.objectId,
        targetObjectId: plan.equipment.objectId,
        actorId: normalizedActorId,
        commandId: `${MIGRATION_ID}:${plan.entityId}:${machine.objectId}`,
        orderKey: `equipment:${String(index + 1).padStart(6, "0")}:${machine.objectId}`,
        metadata: {
          migrationId: MIGRATION_ID,
          reason: "complete-governed-equipment-system-index-membership",
          sourceIdentity: {
            objectId: identity.objectId,
            passportId: identity.passportId,
            entityId: identity.entityId
          }
        }
      }));
    });
  }

  const verification = apply
    ? verifyCompleteProjection(plan)
    : {
        projectedMachineCount: plan.projectedMachineCountBefore,
        projectionMemberCount: null
      };

  return {
    ok: true,
    mode: apply ? "apply" : "dry-run",
    migrationId: MIGRATION_ID,
    entityId: plan.entityId,
    equipmentObjectId: plan.equipment.objectId,
    expectedMachineCount,
    projectedMachineCountBefore: plan.projectedMachineCountBefore,
    governedMembershipCountBefore: plan.governed.length,
    missingMembershipCountBefore: plan.missingMachines.length,
    createdMembershipCount: results.filter(result => result.changed).length,
    replayedMembershipCount: results.filter(result => result.replayed).length,
    ...verification
  };
}

module.exports = {
  EQUIPMENT_ADAPTER_ID,
  MIGRATION_ID,
  buildRepairPlan,
  repairEquipmentMembership
};
