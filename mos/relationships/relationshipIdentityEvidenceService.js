"use strict";

const {
  resolveCanonicalObjectIdentity
} = require("../identity/canonicalObjectAdmissionService");

function publicCanonicalIdentity(admission) {
  return {
    objectId: admission.objectId,
    passportId: admission.passportId,
    entityId: admission.entityId
  };
}

function buildRelationshipIdentityEvidence(relationship, supplied = {}) {
  const source = resolveCanonicalObjectIdentity({
    entityId: relationship.entityId,
    objectId: relationship.sourceObjectId,
    passportId: supplied.sourcePassportId || ""
  });
  const target = resolveCanonicalObjectIdentity({
    entityId: relationship.entityId,
    objectId: relationship.targetObjectId,
    passportId: supplied.targetPassportId || ""
  });
  return {
    relationshipId: relationship.relationshipId,
    revision: Number(relationship.revision || 0),
    status: relationship.status,
    behaviorId: relationship.behaviorId || null,
    definitionId: relationship.definitionId || null,
    orderKey: relationship.orderKey || null,
    source: publicCanonicalIdentity(source),
    target: publicCanonicalIdentity(target)
  };
}

function decorateRelationshipWithIdentityEvidence(relationship, supplied = {}) {
  const identityEvidence = buildRelationshipIdentityEvidence(relationship, supplied);
  return {
    ...relationship,
    sourcePassportId: identityEvidence.source.passportId,
    targetPassportId: identityEvidence.target.passportId,
    sourceIdentity: identityEvidence.source,
    targetIdentity: identityEvidence.target,
    identityEvidence
  };
}

module.exports = {
  publicCanonicalIdentity,
  buildRelationshipIdentityEvidence,
  decorateRelationshipWithIdentityEvidence
};
