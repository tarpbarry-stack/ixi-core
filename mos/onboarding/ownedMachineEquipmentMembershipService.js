"use strict";

const { listObjects } = require("../objects/objectService");
const { resolveCanonicalObjectIdentity } = require("../identity/canonicalObjectAdmissionService");
const { listRelationships, createObjectRelationship } = require("../relationships/relationshipService");
const { EDGE_BEHAVIOR_IDS } = require("../relationships/edgeBehaviorRegistry");
const { cleanText } = require("../util/normalize");
const { MosError } = require("../errors/MosError");

function isExplicitlyOwned(listing) {
  return cleanText(listing?.ownership?.role).toLowerCase() === "owner" &&
    cleanText(listing?.ownership?.status).toLowerCase() === "owned";
}

function ownedEquipmentIndexForListing({ entityId, listing }) {
  if (!isExplicitlyOwned(listing)) return null;
  const matches = listObjects({ entityId, status: "active" }).filter(object =>
    object.objectType === "system-index" &&
    object.metadata?.adapterId === "ixi-owned-equipment" &&
    object.metadata?.systemIndex === true &&
    object.metadata?.systemAdapter === true &&
    object.metadata?.systemIndexPresentation === true
  );
  if (matches.length !== 1) {
    throw new MosError("IXI_MACHINE_EQUIPMENT_INDEX_INVALID",
      "The owned machine requires exactly one active Equipment System Index. Retry after its configuration is repaired.",
      { entityId, objectIds: matches.map(object => object.objectId) }, 409);
  }
  return resolveCanonicalObjectIdentity({ entityId, objectId: matches[0].objectId }).object;
}

// Called only at an explicit authenticated write boundary. Resolving a card,
// listing, Passport, or rail must never call this admission operation.
function ensureOwnedMachineEquipmentMembership({
  entityId, principalId, listing, objectId, passportId, apply = true
}) {
  if (!isExplicitlyOwned(listing)) return { status: "not-owned", changed: false };
  if (!cleanText(entityId) || !cleanText(principalId) || !cleanText(listing?.listingId) ||
      !cleanText(objectId) || !cleanText(passportId)) {
    throw new MosError("IXI_MACHINE_EQUIPMENT_CONTEXT_REQUIRED",
      "Equipment admission requires an authenticated Entity, principal, listing, Object, and Passport.", null, 400);
  }
  const equipment = ownedEquipmentIndexForListing({ entityId, listing });
  const identity = resolveCanonicalObjectIdentity({
    entityId, objectId, passportId,
    aliases: [{ sourceType: "sharetribe-listing", sourceId: listing.listingId }]
  });
  if (identity.object.objectType !== "machine") {
    throw new MosError("IXI_MACHINE_EQUIPMENT_TYPE_INVALID",
      "Only a canonical Machine can be admitted through machine onboarding.", { objectId }, 409);
  }
  const history = listRelationships({
    entityId, sourceObjectId: objectId, targetObjectId: equipment.objectId,
    behaviorId: EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP, status: null
  });
  const active = history.filter(item => item.status === "active");
  if (active.length > 1) {
    throw new MosError("IXI_MACHINE_EQUIPMENT_MEMBERSHIP_CONFLICT",
      "This machine has conflicting Equipment memberships requiring explicit repair.",
      { objectId, relationshipIds: active.map(item => item.relationshipId) }, 409);
  }
  const result = { objectId, passportId, equipmentObjectId: equipment.objectId };
  if (active.length) return { ...result, status: "member", changed: false, relationship: active[0] };
  // An onboarding retry must not undo an operator's later removal.
  if (history.length) return { ...result, status: "previously-removed", changed: false };
  if (!apply) return { ...result, status: "missing", changed: false };
  const created = createObjectRelationship({
    behaviorId: EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP,
    sourceObjectId: objectId,
    targetObjectId: equipment.objectId,
    actorId: principalId,
    commandId: `owned-machine-equipment:v1:${entityId}:${listing.listingId}`,
    orderKey: `equipment:owned:${objectId}`,
    metadata: {
      source: "authenticated-owned-machine-onboarding.v1",
      sourceListingId: listing.listingId,
      passportId,
      ownership: { role: "owner", status: "owned" }
    }
  });
  return { ...result, status: "member", changed: created.changed, relationship: created.relationship };
}

module.exports = { ownedEquipmentIndexForListing, ensureOwnedMachineEquipmentMembership };
