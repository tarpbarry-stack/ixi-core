"use strict";

const { isExplicitAosSystemIndexObject, getAosSystemIndexMembershipPolicy, evaluateAosRailMembership } = require("./aosSystemIndexMembershipPolicy");
const { EDGE_BEHAVIOR_IDS } = require("./edgeBehaviorRegistry");
const { cleanText } = require("../util/normalize");

// A read projection only. Call after filtering Objects and relationships for
// discovery authority. Issues describe existing evidence; they never authorize
// membership, change a relationship, or provision an identity.
function buildAosMembershipReview(relationships = [], objects = []) {
  const byId = new Map(objects.map(object => [cleanText(object.objectId), object]));
  const review = {};
  for (const object of objects) {
    if (!isExplicitAosSystemIndexObject(object)) continue;
    const policy = getAosSystemIndexMembershipPolicy(object);
    review[object.objectId] = {
      state: policy ? "resolved" : "unresolved",
      reason: policy ? null : "membership-policy-required",
      issues: []
    };
  }
  for (const relationship of relationships) {
    if (relationship?.status !== "active") continue;
    const source = byId.get(cleanText(relationship.sourceObjectId));
    const target = byId.get(cleanText(relationship.targetObjectId));
    if (!source || !target || source.entityId !== target.entityId || relationship.entityId !== target.entityId) continue;
    const governed = relationship.behaviorId === EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP;
    const corroboratedLegacy = !cleanText(relationship.behaviorId) && cleanText(source.directContainerId) === target.objectId;
    if (!governed && !corroboratedLegacy) continue;
    const decision = evaluateAosRailMembership({ sourceObject: source, targetObject: target });
    if (decision.allowed) continue;
    const owner = review[target.objectId] ||= { state: "resolved", reason: null, issues: [] };
    owner.issues.push({
      relationshipId: relationship.relationshipId,
      relationshipRevision: Number(relationship.revision || 0),
      objectId: source.objectId,
      state: ["missing-policy", "member-classification-required"].includes(decision.reason) ? "unresolved" : "invalid",
      reason: decision.reason,
      code: decision.code,
      evidence: governed ? "governed-membership" : "legacy-direct-container",
      membershipAllowed: false
    });
  }
  return review;
}

module.exports = { buildAosMembershipReview };
