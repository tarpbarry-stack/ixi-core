"use strict";

const {
  readPassportRecords,
  passportSources
} = require("../../passport/passportRegistry");
const { listObjects } = require("../objects/objectService");
const {
  listRelationships,
  createObjectRelationship,
  endObjectRelationship
} = require("../relationships/relationshipService");
const { EDGE_BEHAVIOR_IDS } = require("../relationships/edgeBehaviorRegistry");
const {
  provisionSharetribeMachine
} = require("../onboarding/sharetribeMachineProvisioningService");
const {
  resolveCanonicalObjectIdentity
} = require("../identity/canonicalObjectAdmissionService");
const { cleanText } = require("../util/normalize");
const { MosError } = require("../errors/MosError");

const EQUIPMENT_ADAPTER_ID = "ixi-owned-equipment";
const MIGRATION_ID = "aos-equipment-current-inventory-v2";

function fail(code, message, details = null, status = 409) {
  throw new MosError(code, message, details, status);
}

function equipmentIndex(objects, entityId) {
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
    fail(
      "AOS_EQUIPMENT_INDEX_CARDINALITY_INVALID",
      "Exactly one active governed Equipment System Index is required.",
      { entityId, objectIds: matches.map(object => object.objectId) }
    );
  }
  return matches[0];
}

function normalizedInventory(inventory, expectedListingCount) {
  if (!Array.isArray(inventory) || inventory.length !== expectedListingCount) {
    fail(
      "AOS_EQUIPMENT_LISTING_COUNT_MISMATCH",
      "The current owned-listing census does not match the approved count.",
      { expectedListingCount, actualListingCount: Array.isArray(inventory) ? inventory.length : null },
      400
    );
  }
  const records = inventory.map((listing, index) => ({
    listingId: cleanText(listing?.listingId),
    displayName: cleanText(listing?.displayName),
    value: listing?.value ?? null,
    currency: cleanText(listing?.currency) || "USD",
    channel: cleanText(listing?.channel) || "private",
    state: cleanText(listing?.state) || null,
    fields: listing?.fields && typeof listing.fields === "object" && !Array.isArray(listing.fields)
      ? { ...listing.fields }
      : {},
    ordinal: index
  }));
  const listingIds = records.map(record => record.listingId);
  if (records.some(record => !record.listingId || !record.displayName) ||
      new Set(listingIds).size !== records.length) {
    fail(
      "AOS_EQUIPMENT_LISTING_MANIFEST_INVALID",
      "Every approved Equipment listing requires one unique listing ID and display name.",
      { listingIds },
      400
    );
  }
  return records;
}

function passportForListing(passports, listing, entityId) {
  const matches = passports.filter(passport =>
    passportSources(passport).some(source =>
      source.sourceType === "sharetribe-listing" &&
      source.sourceId === listing.listingId
    )
  );
  if (matches.length !== 1) {
    fail(
      "AOS_EQUIPMENT_LISTING_PASSPORT_CARDINALITY_INVALID",
      "Every approved Equipment listing must resolve to exactly one permanent Passport.",
      { listingId: listing.listingId, passportIds: matches.map(item => item.passportId) }
    );
  }
  const passport = matches[0];
  if (cleanText(passport.entityId) && cleanText(passport.entityId) !== entityId) {
    fail(
      "AOS_EQUIPMENT_LISTING_ENTITY_MISMATCH",
      "An approved Equipment listing Passport belongs to a different Entity.",
      { listingId: listing.listingId, passportId: passport.passportId, entityId }
    );
  }
  return passport;
}

function activeMachineForPassport({ passport, allObjects, entityId }) {
  const sourceIds = new Set(
    passportSources(passport)
      .filter(source => source.sourceType === "aos-object")
      .map(source => source.sourceId)
  );
  const matches = allObjects.filter(object =>
    sourceIds.has(object.objectId) &&
    object.status === "active" &&
    cleanText(object.entityId) === entityId
  );
  if (matches.some(object => cleanText(object.objectType) !== "machine") || matches.length > 1) {
    fail(
      "AOS_EQUIPMENT_PASSPORT_ACTIVE_OBJECT_INVALID",
      "An approved Equipment Passport does not resolve to zero or one active Machine Object.",
      { passportId: passport.passportId, objectIds: matches.map(object => object.objectId) }
    );
  }
  return matches[0] || null;
}

function assertNoSerialCollision({ listing, passport, allObjects, entityId }) {
  const serialNumber = cleanText(listing.fields?.serialNumber).toUpperCase();
  if (!serialNumber) return;
  const passportObjectIds = new Set(
    passportSources(passport)
      .filter(source => source.sourceType === "aos-object")
      .map(source => source.sourceId)
  );
  const conflicts = allObjects.filter(object =>
    cleanText(object.entityId) === entityId &&
    cleanText(object.fields?.serialNumber || object.serialNumber).toUpperCase() === serialNumber &&
    !passportObjectIds.has(object.objectId)
  );
  if (conflicts.length) {
    fail(
      "AOS_EQUIPMENT_SERIAL_IDENTITY_CONFLICT",
      "An approved Equipment listing serial is already bound to a different Object lineage.",
      {
        listingId: listing.listingId,
        passportId: passport.passportId,
        serialNumber,
        objectIds: conflicts.map(object => object.objectId)
      }
    );
  }
}

function buildPlan({ entityId, inventory, expectedListingCount }) {
  const normalizedEntityId = cleanText(entityId);
  if (!normalizedEntityId || !Number.isInteger(expectedListingCount) || expectedListingCount < 1) {
    fail(
      "AOS_EQUIPMENT_RECONCILIATION_CONTEXT_REQUIRED",
      "Entity and a positive approved listing count are required.",
      { entityId, expectedListingCount },
      400
    );
  }
  const listings = normalizedInventory(inventory, expectedListingCount);
  const allObjects = listObjects({ entityId: normalizedEntityId, status: null });
  const equipment = equipmentIndex(allObjects, normalizedEntityId);
  const passports = readPassportRecords();
  const listingPlans = listings.map(listing => {
    const passport = passportForListing(passports, listing, normalizedEntityId);
    assertNoSerialCollision({ listing, passport, allObjects, entityId: normalizedEntityId });
    return {
      listing,
      passport,
      object: activeMachineForPassport({ passport, allObjects, entityId: normalizedEntityId })
    };
  });
  const existingObjectIds = new Set(
    listingPlans.filter(item => item.object).map(item => item.object.objectId)
  );
  if (existingObjectIds.size !== listingPlans.filter(item => item.object).length) {
    fail(
      "AOS_EQUIPMENT_CURRENT_OBJECT_COLLISION",
      "Two approved listings resolve to the same active Machine Object.",
      { objectIds: [...existingObjectIds] }
    );
  }
  const relationships = listRelationships({ entityId: normalizedEntityId, status: "active" });
  const governed = relationships.filter(relationship =>
    relationship.behaviorId === EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP &&
    relationship.targetObjectId === equipment.objectId
  );
  return {
    entityId: normalizedEntityId,
    equipment,
    passportsBefore: passports.length,
    listingPlans,
    governed,
    missingObjects: listingPlans.filter(item => !item.object),
    staleMemberships: governed.filter(item => !existingObjectIds.has(item.sourceObjectId))
  };
}

function reconcileEquipmentInventory({
  entityId,
  actorId,
  inventory,
  expectedListingCount,
  apply = false
} = {}) {
  const plan = buildPlan({ entityId, inventory, expectedListingCount });
  const normalizedActorId = cleanText(actorId);
  if (apply && !normalizedActorId) {
    fail(
      "AOS_EQUIPMENT_RECONCILIATION_ACTOR_REQUIRED",
      "An explicit migration actor is required before applying reconciliation.",
      { entityId: plan.entityId },
      401
    );
  }

  const provisioned = [];
  const ended = [];
  const created = [];
  if (apply) {
    plan.missingObjects.forEach(item => {
      provisioned.push(provisionSharetribeMachine({
        entityId: plan.entityId,
        principalId: normalizedActorId,
        commandId: `${MIGRATION_ID}:admit:${item.listing.listingId}`,
        creationBoundary: "authenticated-listing-admission.v1",
        listing: item.listing
      }));
    });

    const desired = plan.listingPlans.map(item => ({
      ...item,
      identity: resolveCanonicalObjectIdentity({
        entityId: plan.entityId,
        aliases: [{ sourceType: "sharetribe-listing", sourceId: item.listing.listingId }]
      })
    }));
    const desiredIds = new Set(desired.map(item => item.identity.objectId));
    if (desiredIds.size !== expectedListingCount) {
      fail(
        "AOS_EQUIPMENT_RECONCILIATION_IDENTITY_COLLISION",
        "Approved listings did not resolve to distinct canonical Machine Objects.",
        { objectIds: [...desiredIds] }
      );
    }

    const activeMemberships = listRelationships({ entityId: plan.entityId, status: "active" })
      .filter(relationship =>
        relationship.behaviorId === EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP &&
        relationship.targetObjectId === plan.equipment.objectId
      );
    const keptByObjectId = new Map();
    activeMemberships.forEach(relationship => {
      const keep = desiredIds.has(relationship.sourceObjectId) &&
        !keptByObjectId.has(relationship.sourceObjectId);
      if (keep) {
        keptByObjectId.set(relationship.sourceObjectId, relationship);
        return;
      }
      ended.push(endObjectRelationship({
        relationshipId: relationship.relationshipId,
        expectedRevision: relationship.revision,
        actorId: normalizedActorId,
        commandId: `${MIGRATION_ID}:end:${relationship.relationshipId}`,
        reason: "not-in-current-owned-equipment-manifest",
        metadata: { migrationId: MIGRATION_ID }
      }));
    });

    desired.forEach(item => {
      if (keptByObjectId.has(item.identity.objectId)) return;
      created.push(createObjectRelationship({
        behaviorId: EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP,
        sourceObjectId: item.identity.objectId,
        targetObjectId: plan.equipment.objectId,
        actorId: normalizedActorId,
        commandId: `${MIGRATION_ID}:member:${item.listing.listingId}`,
        orderKey: `equipment:${String(item.listing.ordinal + 1).padStart(6, "0")}:${item.identity.objectId}`,
        metadata: {
          migrationId: MIGRATION_ID,
          sourceListingId: item.listing.listingId,
          passportId: item.identity.passportId,
          reason: "current-owned-equipment-manifest"
        }
      }));
    });

    const verifiedIds = new Set(plan.listingPlans.map(item =>
      resolveCanonicalObjectIdentity({
        entityId: plan.entityId,
        aliases: [{ sourceType: "sharetribe-listing", sourceId: item.listing.listingId }]
      }).objectId
    ));
    const finalMemberships = listRelationships({ entityId: plan.entityId, status: "active" })
      .filter(relationship =>
        relationship.behaviorId === EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP &&
        relationship.targetObjectId === plan.equipment.objectId
      );
    const finalIds = new Set(finalMemberships.map(item => item.sourceObjectId));
    if (finalMemberships.length !== expectedListingCount ||
        finalIds.size !== expectedListingCount ||
        [...verifiedIds].some(objectId => !finalIds.has(objectId))) {
      fail(
        "AOS_EQUIPMENT_RECONCILIATION_INCOMPLETE",
        "Equipment does not project exactly the approved current owned inventory.",
        { expectedObjectIds: [...verifiedIds], projectedObjectIds: [...finalIds] },
        500
      );
    }
    if (readPassportRecords().length !== plan.passportsBefore) {
      fail(
        "AOS_EQUIPMENT_RECONCILIATION_CREATED_PASSPORT",
        "Reconciliation must reuse every existing permanent Passport.",
        { passportsBefore: plan.passportsBefore, passportsAfter: readPassportRecords().length },
        500
      );
    }
  }

  return {
    ok: true,
    mode: apply ? "apply" : "dry-run",
    migrationId: MIGRATION_ID,
    entityId: plan.entityId,
    equipmentObjectId: plan.equipment.objectId,
    expectedListingCount,
    existingCanonicalListingCount: plan.listingPlans.length - plan.missingObjects.length,
    missingCanonicalObjectCount: plan.missingObjects.length,
    staleMembershipCount: plan.staleMemberships.length,
    provisionedObjectCount: provisioned.filter(result => result?.object?.objectId).length,
    endedMembershipCount: ended.filter(result => result?.changed).length,
    createdMembershipCount: created.filter(result => result?.changed).length,
    passportCountBefore: plan.passportsBefore,
    passportCountAfter: apply ? readPassportRecords().length : plan.passportsBefore,
    projectionMemberCount: apply ? expectedListingCount : plan.governed.length
  };
}

module.exports = {
  EQUIPMENT_ADAPTER_ID,
  MIGRATION_ID,
  buildPlan,
  reconcileEquipmentInventory
};
