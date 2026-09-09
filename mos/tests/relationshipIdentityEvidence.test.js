"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-relationship-evidence-"));
process.env.IXI_MOS_DATA_ROOT = path.join(testRoot, "mos");
process.env.IXI_PASSPORT_DATA_FILE = path.join(testRoot, "passports.json");

const { ensureAosAccount } = require("../accounts/aosAccountService");
const { provisionAosObject } = require("../provisioning/aosObjectProvisioningService");
const { readPassportRecords } = require("../../passport/passportRegistry");
const { MOS_PATHS } = require("../storage/mosPaths");
const { readJsonFile } = require("../storage/jsonStore");
const {
  createObjectRelationship,
  updateObjectRelationshipOrder
} = require("../relationships/relationshipService");
const { EDGE_BEHAVIOR_IDS } = require("../relationships/edgeBehaviorRegistry");
const {
  buildRelationshipIdentityEvidence,
  decorateRelationshipWithIdentityEvidence
} = require("../relationships/relationshipIdentityEvidenceService");

test.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

const bootstrap = ensureAosAccount({ ownerUserId: "owner-evidence", displayName: "Evidence Entity" });
const source = provisionAosObject({
  commandId: "evidence-source",
  entityId: bootstrap.entity.entityId,
  objectType: "customer-defined",
  displayName: "Source",
  actorId: "owner-evidence"
}).object;
const target = provisionAosObject({
  commandId: "evidence-target",
  entityId: bootstrap.entity.entityId,
  objectType: "customer-defined",
  displayName: "Target",
  actorId: "owner-evidence"
}).object;

test("relationship evidence proves both canonical Objects and permanent Passports", () => {
  const beforeObjects = Object.keys(readJsonFile(MOS_PATHS.objects, {})).length;
  const beforePassports = readPassportRecords().length;
  const created = createObjectRelationship({
    behaviorId: EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP,
    definitionId: "definition-rail-evidence",
    orderKey: "000100",
    sourceObjectId: source.objectId,
    targetObjectId: target.objectId,
    actorId: "owner-evidence",
    commandId: "create-evidence-edge"
  });
  const evidence = buildRelationshipIdentityEvidence(created.relationship);
  assert.deepEqual(evidence.source, {
    objectId: source.objectId,
    passportId: source.identities[0].passportId,
    entityId: bootstrap.entity.entityId
  });
  assert.equal(evidence.target.objectId, target.objectId);
  assert.equal(evidence.target.passportId, target.identities[0].passportId);
  assert.equal(evidence.relationshipId, created.relationship.relationshipId);
  assert.equal(evidence.behaviorId, EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP);
  assert.equal(evidence.definitionId, "definition-rail-evidence");
  assert.equal(evidence.orderKey, "000100");
  assert.equal(evidence.revision, 1);
  assert.equal(evidence.status, "active");
  const decorated = decorateRelationshipWithIdentityEvidence(created.relationship);
  assert.equal(decorated.sourcePassportId, source.identities[0].passportId);
  assert.equal(decorated.targetPassportId, target.identities[0].passportId);
  assert.deepEqual(decorated.identityEvidence, evidence);
  assert.equal(Object.keys(readJsonFile(MOS_PATHS.objects, {})).length, beforeObjects);
  assert.equal(readPassportRecords().length, beforePassports);

  const reordered = updateObjectRelationshipOrder({
    relationshipId: created.relationship.relationshipId,
    expectedRevision: created.relationship.revision,
    orderKey: "000200",
    actorId: "owner-evidence",
    commandId: "reorder-evidence-edge"
  });
  const reorderedEvidence = buildRelationshipIdentityEvidence(reordered.relationship);
  assert.equal(reorderedEvidence.relationshipId, evidence.relationshipId);
  assert.equal(reorderedEvidence.orderKey, "000200");
  assert.equal(reorderedEvidence.revision, 2);
});

test("supplied Passport and canonical Object mismatch is rejected", () => {
  const relationship = createObjectRelationship({
    behaviorId: EDGE_BEHAVIOR_IDS.NEUTRAL_CONNECTION,
    sourceObjectId: target.objectId,
    targetObjectId: source.objectId,
    actorId: "owner-evidence",
    commandId: "create-mismatch-edge"
  }).relationship;
  assert.throws(
    () => buildRelationshipIdentityEvidence(relationship, {
      sourcePassportId: source.identities[0].passportId,
      targetPassportId: target.identities[0].passportId
    }),
    error => ["CANONICAL_IDENTITY_CONFLICT", "CANONICAL_IDENTITY_REPAIR_REQUIRED"].includes(error.code)
  );
});
