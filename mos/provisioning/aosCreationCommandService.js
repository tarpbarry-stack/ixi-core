"use strict";

const crypto = require("node:crypto");
const { readJsonFile, updateJsonFile } = require("../storage/jsonStore");
const { MOS_PATHS } = require("../storage/mosPaths");
const { MosError } = require("../errors/MosError");
const { prepareObjectForCreation, getObject } = require("../objects/objectService");
const { validateProvisioningInput, createPayloadHash } = require("./aosObjectProvisioningValidator");
const identityService = require("./aosObjectProvisioningService");
const recoveryService = require("./aosObjectProvisioningRecoveryService");
const relationshipService = require("../relationships/relationshipService");
const { resolveCanonicalObjectIdentity } = require("../identity/canonicalObjectAdmissionService");
const { assertAosRailMembershipAllowed } = require("../relationships/aosSystemIndexMembershipPolicy");

const TYPE = "aos.create-and-attach.v1";
const LEASE_MS = 120000;
const clean = value => String(value ?? "").trim();
const records = () => readJsonFile(MOS_PATHS.idempotency, {});
const fail = (code, message, status = 409, details = null) => { throw new MosError(code, message, details, status); };

function ownedRecord(commandId, principal) {
  const record = records()[clean(commandId)];
  if (!record || record.commandType !== TYPE || record.entityId !== principal.entityId || record.actorId !== principal.principalId) {
    fail("AOS_CREATION_NOT_FOUND", "This creation request is not available to this user.", 404);
  }
  return record;
}

function membershipInput(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value) || !clean(value.parentObjectId) || !clean(value.parentPassportId)) {
    fail("AOS_CREATION_PARENT_REQUIRED", "The parent Object and Passport are required before saving.", 400);
  }
  return { parentObjectId: clean(value.parentObjectId), parentPassportId: clean(value.parentPassportId),
    orderKey: clean(value.orderKey) || "000100" };
}

function parentFor(record, sourceObject) {
  if (!record.membership) return null;
  const { parentObjectId, parentPassportId } = record.membership;
  const parent = resolveCanonicalObjectIdentity({ entityId: record.entityId,
    objectId: parentObjectId, passportId: parentPassportId }).object;
  assertAosRailMembershipAllowed({ sourceObject, targetObject: parent });
  return parent;
}

function existingObject(record) {
  return recoveryService.findProvisioningObject({ entityId: record.entityId, commandId: record.identityCommandId });
}

function summary(record) {
  const object = existingObject(record);
  return { commandId: record.commandId, draftId: record.draftId, displayName: record.input.displayName,
    state: record.status, objectId: object?.objectId || null,
    parentObjectId: record.membership?.parentObjectId || null, error: record.error || null,
    retryAfter: record.status === "processing" ? record.leaseUntil : null };
}

function assertLease(commandId, token) {
  const current = records()[commandId];
  if (current?.leaseToken !== token || current.status !== "processing" || current.leaseUntil <= Date.now()) {
    fail("AOS_CREATION_LEASE_EXPIRED", "This save attempt expired. Resume the saved request.");
  }
}

function changeOwnedLease(commandId, token, patch) {
  updateJsonFile(MOS_PATHS.idempotency, {}, store => {
    if (store[commandId]?.leaseToken !== token) fail("AOS_CREATION_LEASE_EXPIRED", "Another save attempt owns this request.");
    store[commandId] = { ...store[commandId], ...patch, updatedAt: new Date().toISOString() };
    return store;
  });
}

async function authorizeRecord(record, authorize, { checkMembership = true } = {}) {
  const object = existingObject(record);
  const parent = checkMembership
    ? parentFor(record, object || prepareObjectForCreation(record.input))
    : record.membership ? getObject(record.membership.parentObjectId) : null;
  if (parent) await authorize(parent, "aos.relationship.create");
  // An interrupted birth may have no Passport yet, so ordinary Object
  // authority cannot resolve. Only the original creator's persisted intent
  // can complete that identity. Full Object authority is checked immediately
  // afterwards, before any attachment or successful receipt is issued.
  if (object && records()[record.identityCommandId]?.status === "completed") {
    await authorize(object, record.membership ? "aos.relationship.create" : "aos.view");
  }
  return object;
}

async function runCreation(record, principal, authorize) {
  if (record.status === "completed") {
    await authorizeRecord(record, authorize, { checkMembership: false });
    // A replay never restores an attachment that was deliberately ended later.
    return { ...record.result, object: getObject(record.result.object.objectId), replayed: true };
  }
  await authorizeRecord(record, authorize);
  const token = crypto.randomUUID();
  updateJsonFile(MOS_PATHS.idempotency, {}, store => {
    const current = store[record.commandId];
    if (!current || current.payloadHash !== record.payloadHash) fail("AOS_CREATION_CONFLICT", "Creation request changed.");
    if (current.status === "completed") fail("AOS_CREATION_RETRY", "Save completed in another request. Resume to read the result.");
    if (current.status === "processing" && current.leaseUntil > Date.now()) {
      fail("AOS_CREATION_PROCESSING", "This save is still processing. Resume it shortly.", 409,
        { creation: summary(current) });
    }
    store[record.commandId] = { ...current, status: "processing", leaseToken: token,
      leaseUntil: Date.now() + LEASE_MS, updatedAt: new Date().toISOString() };
    return store;
  });

  try {
    assertLease(record.commandId, token);
    const before = existingObject(record);
    parentFor(record, before || prepareObjectForCreation(record.input));
    const identity = before
      ? recoveryService.recoverAosObjectProvisioning({ commandId: record.identityCommandId,
          entityId: principal.entityId, actorId: principal.principalId })
      : identityService.provisionAosObject({ ...record.input, commandId: record.identityCommandId },
          { resumeInterrupted: true, reservedObjectId: record.reservedObjectId });
    const object = resolveCanonicalObjectIdentity({ entityId: record.entityId,
      objectId: identity.object.objectId, passportId: identity.identity.passportId }).object;
    await authorize(object, record.membership ? "aos.relationship.create" : "aos.view");
    // Recheck the current parent after the async authorization boundary.
    const parent = parentFor(record, object);
    if (parent) await authorize(parent, "aos.relationship.create");
    assertLease(record.commandId, token);
    let relationship = null;
    if (parent) {
      parentFor(record, getObject(object.objectId));
      relationship = relationshipService.createObjectRelationship({
        behaviorId: "aos.rail-membership.v1", sourceObjectId: object.objectId,
        targetObjectId: parent.objectId, actorId: principal.principalId,
        commandId: `${record.commandId}:membership`, orderKey: record.membership.orderKey
      }).relationship;
      const persisted = relationshipService.getRelationship(relationship.relationshipId);
      if (persisted.status !== "active" || persisted.sourceObjectId !== object.objectId || persisted.targetObjectId !== parent.objectId) {
        fail("AOS_CREATION_ATTACHMENT_UNCONFIRMED", "The saved attachment could not be confirmed.");
      }
      relationship = persisted;
    }
    const result = { ...identity, object: getObject(object.objectId), commandId: record.commandId,
      replayed: false, creation: { schema: TYPE, state: "complete", commandId: record.commandId,
        draftId: record.draftId, membership: record.membership, relationship } };
    changeOwnedLease(record.commandId, token, { status: "completed", result, error: null,
      completedAt: new Date().toISOString(), leaseUntil: 0 });
    return result;
  } catch (error) {
    changeOwnedLease(record.commandId, token, { status: "failed", leaseUntil: 0,
      error: { code: error.code || "AOS_CREATION_INTERRUPTED", message: error.message } });
    error.details = { ...(error.details || {}), creation: summary(ownedRecord(record.commandId, principal)) };
    throw error;
  }
}

async function createAndAttachAosObject(input, { principal, authorize }) {
  const commandId = clean(input.commandId);
  const identityCommandId = `${commandId}:identity`;
  const { normalized } = validateProvisioningInput({ ...input, commandId: identityCommandId,
    entityId: principal.entityId, actorId: principal.principalId, trustedPassportId: null });
  const membership = membershipInput(input.membership);
  const draftId = clean(input.draftId);
  const payloadHash = createPayloadHash({ input: normalized, membership, draftId });
  let record = records()[commandId];
  if (record) {
    record = ownedRecord(commandId, principal);
    if (record.payloadHash !== payloadHash) fail("AOS_CREATION_PAYLOAD_CONFLICT",
      "This save already has recorded details. Resume it before making further edits.", 409, { creation: summary(record) });
  } else {
    if (!commandId) fail("AOS_CREATION_COMMAND_REQUIRED", "A stable save request is required.", 400);
    const candidate = prepareObjectForCreation(normalized);
    record = { commandId, identityCommandId, reservedObjectId: candidate.objectId, commandType: TYPE, entityId: principal.entityId,
      actorId: principal.principalId, input: normalized, membership, draftId, payloadHash,
      status: "pending", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const parent = parentFor(record, candidate);
    if (parent) await authorize(parent, "aos.relationship.create");
    // Persist intent before any identity write. CAS prevents concurrent writers
    // from replacing the command or claiming the same lease in SQLite.
    updateJsonFile(MOS_PATHS.idempotency, {}, store => {
      if (store[commandId]) fail("AOS_CREATION_RETRY", "This save was recorded concurrently. Retry the same request.");
      store[commandId] = record;
      return store;
    });
  }
  try { return await runCreation(record, principal, authorize); }
  catch (error) {
    error.details = { ...(error.details || {}), creation: summary(ownedRecord(commandId, principal)) };
    throw error;
  }
}

async function resumeAosCreation({ commandId, principal, authorize }) {
  return runCreation(ownedRecord(commandId, principal), principal, authorize);
}

async function listAosCreationCommands({ principal, authorize }) {
  const pending = [];
  for (const record of Object.values(records()).filter(record => record.commandType === TYPE &&
    record.entityId === principal.entityId && record.actorId === principal.principalId && !record.acknowledgedAt)) {
    try {
      await authorizeRecord(record, authorize, { checkMembership: false });
      pending.push(summary(record));
    } catch (error) {
      if (![403, 404].includes(error.statusCode || error.status)) throw error;
    }
  }
  return pending;
}

async function acknowledgeAosCreation({ commandId, principal, authorize }) {
  const record = ownedRecord(commandId, principal);
  if (record.status !== "completed") fail("AOS_CREATION_INCOMPLETE", "Finish this save before acknowledging it.");
  await authorizeRecord(record, authorize, { checkMembership: false });
  updateJsonFile(MOS_PATHS.idempotency, {}, store => {
    store[commandId] = { ...store[commandId], acknowledgedAt: new Date().toISOString() };
    return store;
  });
  return { ok: true, commandId };
}

module.exports = { createAndAttachAosObject, resumeAosCreation, listAosCreationCommands, acknowledgeAosCreation };
