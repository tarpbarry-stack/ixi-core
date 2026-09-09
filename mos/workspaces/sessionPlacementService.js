"use strict";

const crypto = require("node:crypto");

const { MOS_PATHS } = require("../storage/mosPaths");
const { readJsonFile, writeJsonFileAtomic } = require("../storage/jsonStore");
const { getObject } = require("../objects/objectService");
const { appendEvent } = require("../events/eventService");
const { MosError } = require("../errors/MosError");
const { cleanText, nowIso } = require("../util/normalize");

const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SCOPE_TYPES = new Set(["personal", "shared"]);
const OPERATING_STATES = new Set(["preview", "operating", "tucked"]);
const COMMAND_TYPES = new Set([
  "object.admit",
  "objects.admit",
  "objects.move",
  "objects.recall",
  "objects.undo",
  "objects.summon.set",
  "object.move",
  "object.recall",
  "object.snapshot.capture",
  "object.undo",
  "surface.reorder",
  "summon.set"
]);

function readSessions() {
  return readJsonFile(MOS_PATHS.workspaceSessions, {});
}

function writeSessions(sessions) {
  writeJsonFileAtomic(MOS_PATHS.workspaceSessions, sessions);
}

function sessionError(code, message, details = null, status = 400) {
  throw new MosError(code, message, details, status);
}

function stableId(value, field) {
  const id = cleanText(value);
  if (!id || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(id)) {
    sessionError("WORKSPACE_SESSION_ID_INVALID", `${field} is invalid.`, { field }, 400);
  }
  return id;
}

function canonicalObject(entityId, objectId) {
  const id = cleanText(objectId);
  if (!id.startsWith("object_")) {
    sessionError(
      "WORKSPACE_CANONICAL_OBJECT_REQUIRED",
      "Workspace placement accepts canonical objectId values only.",
      { objectId: id || null },
      409
    );
  }
  const object = getObject(id);
  if (cleanText(object.entityId) !== cleanText(entityId) || object.status !== "active") {
    sessionError(
      "WORKSPACE_OBJECT_ENTITY_MISMATCH",
      "Workspace Object is not active inside the authenticated Entity.",
      { objectId: id },
      403
    );
  }
  return object;
}

function scopeKeyOf({ tenantId, entityId, workspaceId, placementScope, scopeOwnerId }) {
  return [tenantId, entityId, workspaceId, placementScope, scopeOwnerId].map(stableId).join("|");
}

function assertSessionAccess(session, context) {
  if (
    cleanText(session.tenantId) !== cleanText(context.tenantId) ||
    cleanText(session.entityId) !== cleanText(context.entityId)
  ) {
    sessionError("WORKSPACE_SESSION_TENANT_MISMATCH", "Workspace session crosses tenant identity.", null, 403);
  }
  if (session.placementScope === "personal" && session.scopeOwnerId !== context.principalId) {
    sessionError("WORKSPACE_PERSONAL_SCOPE_DENIED", "Personal workspace scope belongs to another principal.", null, 403);
  }
  if (session.placementScope === "shared" && context.sharedAuthorized !== true) {
    sessionError("WORKSPACE_SHARED_SCOPE_DENIED", "Shared workspace scope requires server authorization.", null, 403);
  }
}

function expireWorkspaceSessionRecord(sessions, session) {
  if (session.status !== "active" || Date.parse(session.expiresAt) > Date.now()) {
    return session;
  }
  const timestamp = nowIso();
  const commandId = `session-expiration:${session.sessionId}:${session.expiresAt}`;
  const expired = {
    ...session,
    status: "expired",
    revision: session.revision + 1,
    objects: Object.fromEntries(Object.entries(session.objects || {}).map(([id, entry]) => [id, {
      ...entry,
      returnSnapshot: null
    }])),
    lastCommandId: commandId,
    updatedBy: "ixi-session-expiration",
    updatedAt: timestamp,
    expiredAt: timestamp
  };
  sessions[session.sessionId] = expired;
  writeSessions(sessions);
  try {
    appendEvent({
      entityId: session.entityId,
      eventType: "workspace.session.expired",
      actorId: "ixi-session-expiration",
      commandId,
      payload: {
        sessionId: session.sessionId,
        workspaceId: session.workspaceId,
        revision: expired.revision,
        expiresAt: session.expiresAt
      }
    });
  } catch (error) {
    sessions[session.sessionId] = session;
    writeSessions(sessions);
    throw error;
  }
  return expired;
}

function getWorkspaceSession({ sessionId, context, allowEnded = false }) {
  const sessions = readSessions();
  let session = sessions[stableId(sessionId, "sessionId")];
  if (!session) sessionError("WORKSPACE_SESSION_NOT_FOUND", "Workspace session was not found.", null, 404);
  assertSessionAccess(session, context);
  session = expireWorkspaceSessionRecord(sessions, session);
  if (!allowEnded && session.status === "expired") {
    sessionError("WORKSPACE_SESSION_EXPIRED", "Workspace session has expired.", { expiresAt: session.expiresAt }, 409);
  }
  if (!allowEnded && session.status !== "active") {
    sessionError("WORKSPACE_SESSION_NOT_ACTIVE", "Workspace session is not active.", { status: session.status }, 409);
  }
  return session;
}

function openWorkspaceSession({
  context,
  workspaceId,
  placementScope = "personal",
  sharedScopeId = null,
  ttlMs = DEFAULT_SESSION_TTL_MS,
  commandId
}) {
  const scope = cleanText(placementScope).toLowerCase();
  if (!SCOPE_TYPES.has(scope)) {
    sessionError("WORKSPACE_PLACEMENT_SCOPE_INVALID", "placementScope must be personal or shared.");
  }
  const owner = scope === "personal"
    ? stableId(context.principalId, "principalId")
    : stableId(sharedScopeId, "sharedScopeId");
  if (scope === "shared" && context.sharedAuthorized !== true) {
    sessionError("WORKSPACE_SHARED_SCOPE_DENIED", "Shared workspace scope requires server authorization.", null, 403);
  }
  const normalizedTtl = Math.min(
    Math.max(Number(ttlMs) || DEFAULT_SESSION_TTL_MS, 60 * 1000),
    MAX_SESSION_TTL_MS
  );
  const scopeKey = scopeKeyOf({
    tenantId: context.tenantId,
    entityId: context.entityId,
    workspaceId: stableId(workspaceId, "workspaceId"),
    placementScope: scope,
    scopeOwnerId: owner
  });
  const sessions = readSessions();
  Object.values(sessions)
    .filter(session => session.scopeKey === scopeKey)
    .forEach(session => expireWorkspaceSessionRecord(sessions, session));
  const resumableSessions = Object.values(sessions).filter(session =>
    session.scopeKey === scopeKey &&
    session.status === "active" &&
    Date.parse(session.expiresAt) > Date.now()
  );
  if (resumableSessions.length > 1) {
    sessionError(
      "WORKSPACE_SESSION_SCOPE_CONFLICT",
      "Multiple active sessions exist for one canonical workspace scope.",
      { scopeKey, sessionIds: resumableSessions.map(session => session.sessionId) },
      409
    );
  }
  if (resumableSessions[0]) {
    return { created: false, resumed: true, session: resumableSessions[0] };
  }

  const timestamp = nowIso();
  const sessionId = `session_${crypto.randomUUID()}`;
  const session = {
    sessionId,
    tenantId: stableId(context.tenantId, "tenantId"),
    entityId: stableId(context.entityId, "entityId"),
    workspaceId: stableId(workspaceId, "workspaceId"),
    placementScope: scope,
    scopeOwnerId: owner,
    sharedScopeId: scope === "shared" ? owner : null,
    scopeKey,
    status: "active",
    revision: 0,
    objects: {},
    createdBy: context.principalId,
    updatedBy: context.principalId,
    lastCommandId: stableId(commandId, "commandId"),
    startedAt: timestamp,
    updatedAt: timestamp,
    expiresAt: new Date(Date.now() + normalizedTtl).toISOString(),
    endedAt: null
  };
  sessions[sessionId] = session;
  writeSessions(sessions);
  try {
    appendEvent({
      entityId: session.entityId,
      eventType: "workspace.session.opened",
      actorId: context.principalId,
      commandId,
      payload: {
        sessionId,
        workspaceId: session.workspaceId,
        placementScope: session.placementScope,
        scopeOwnerId: session.scopeOwnerId,
        revision: session.revision
      }
    });
  } catch (error) {
    delete sessions[sessionId];
    writeSessions(sessions);
    throw error;
  }
  return { created: true, resumed: false, session };
}

function placementFromPayload(payload, fallback = {}) {
  const surfaceId = stableId(payload.surfaceId || fallback.surfaceId, "surfaceId");
  const visualOrder = Number(payload.visualOrder ?? fallback.visualOrder ?? 0);
  if (!Number.isInteger(visualOrder) || visualOrder < 0) {
    sessionError("WORKSPACE_VISUAL_ORDER_INVALID", "visualOrder must be a non-negative integer.");
  }
  const operatingState = cleanText(payload.operatingState || fallback.operatingState || "operating");
  if (!OPERATING_STATES.has(operatingState)) {
    sessionError("WORKSPACE_OPERATING_STATE_INVALID", "operatingState is invalid.");
  }
  return { surfaceId, visualOrder, operatingState };
}

function applyWorkspaceSessionCommand({
  context,
  sessionId,
  expectedRevision,
  commandId,
  commandType,
  payload = {}
}) {
  const current = getWorkspaceSession({ sessionId, context });
  const revision = Number(expectedRevision);
  if (!Number.isInteger(revision) || revision !== current.revision) {
    sessionError(
      "WORKSPACE_SESSION_REVISION_CONFLICT",
      "Workspace session changed before this command was applied.",
      { expectedRevision, currentRevision: current.revision },
      409
    );
  }
  const type = cleanText(commandType);
  if (!COMMAND_TYPES.has(type)) {
    sessionError("WORKSPACE_SESSION_COMMAND_INVALID", "Workspace session command type is invalid.");
  }
  const next = JSON.parse(JSON.stringify(current));
  const timestamp = nowIso();
  const objectId = cleanText(payload.objectId);
  let changed = true;

  if (type === "objects.admit") {
    const objects = Array.isArray(payload.objects) ? payload.objects : [];
    if (!objects.length || objects.length > 250) {
      sessionError(
        "WORKSPACE_BATCH_ADMISSION_INVALID",
        "objects.admit requires between 1 and 250 canonical Object placements."
      );
    }

    const objectIds = objects.map(item => cleanText(item?.objectId));
    if (new Set(objectIds).size !== objectIds.length) {
      sessionError(
        "WORKSPACE_BATCH_ADMISSION_DUPLICATE",
        "objects.admit contains a duplicate canonical Object."
      );
    }

    objects.forEach(item => {
      const admittedObjectId = cleanText(item?.objectId);
      canonicalObject(current.entityId, admittedObjectId);
      if (next.objects[admittedObjectId]) {
        sessionError(
          "WORKSPACE_DUPLICATE_ACTIVE_PLACEMENT",
          "A canonical Object already has an active placement in this workspace scope.",
          { objectId: admittedObjectId },
          409
        );
      }
      const placement = placementFromPayload(item);
      next.objects[admittedObjectId] = {
        objectId: admittedObjectId,
        sessionOrigin: { ...placement },
        currentPlacement: { ...placement },
        activeSummonedContext: cleanText(item?.activeSummonedContext) || null,
        returnSnapshot: null,
        admittedAt: timestamp,
        updatedAt: timestamp
      };
    });
  } else if (type === "objects.move") {
    const objects = Array.isArray(payload.objects) ? payload.objects : [];
    if (!objects.length || objects.length > 250) {
      sessionError("WORKSPACE_BATCH_MOVE_INVALID", "objects.move requires between 1 and 250 placements.");
    }
    const objectIds = objects.map(item => cleanText(item?.objectId));
    if (new Set(objectIds).size !== objectIds.length) {
      sessionError("WORKSPACE_BATCH_MOVE_DUPLICATE", "objects.move contains a duplicate canonical Object.");
    }
    const operationId = cleanText(payload.operationId)
      ? stableId(payload.operationId, "operationId")
      : null;
    objects.forEach(item => {
      const movedObjectId = cleanText(item?.objectId);
      canonicalObject(current.entityId, movedObjectId);
      const entry = next.objects[movedObjectId];
      if (!entry) {
        sessionError("WORKSPACE_OBJECT_NOT_ADMITTED", "Object must be admitted before session operations.", { objectId: movedObjectId }, 409);
      }
      if (operationId && entry.returnSnapshot?.operationId !== operationId) {
        entry.returnSnapshot = {
          operationId,
          placement: { ...entry.currentPlacement },
          capturedAt: timestamp
        };
      }
      entry.currentPlacement = placementFromPayload(item, entry.currentPlacement);
      if (Object.prototype.hasOwnProperty.call(item, "activeSummonedContext")) {
        entry.activeSummonedContext = cleanText(item.activeSummonedContext) || null;
      }
      entry.updatedAt = timestamp;
    });
  } else if (type === "objects.recall") {
    const objectIds = Array.isArray(payload.objectIds)
      ? payload.objectIds.map(id => cleanText(id))
      : [];
    if (!objectIds.length || objectIds.length > 250 || new Set(objectIds).size !== objectIds.length) {
      sessionError("WORKSPACE_BATCH_RECALL_INVALID", "objects.recall requires 1 to 250 unique canonical Objects.");
    }
    const operationId = stableId(payload.operationId, "operationId");
    objectIds.forEach(recalledObjectId => {
      canonicalObject(current.entityId, recalledObjectId);
      const entry = next.objects[recalledObjectId];
      if (!entry) {
        sessionError("WORKSPACE_OBJECT_NOT_ADMITTED", "Object must be admitted before session operations.", { objectId: recalledObjectId }, 409);
      }
      entry.returnSnapshot = {
        operationId,
        placement: { ...entry.currentPlacement },
        capturedAt: timestamp
      };
      entry.currentPlacement = { ...entry.sessionOrigin };
      entry.updatedAt = timestamp;
    });
  } else if (type === "objects.undo") {
    const objectIds = Array.isArray(payload.objectIds)
      ? payload.objectIds.map(id => cleanText(id))
      : [];
    if (!objectIds.length || objectIds.length > 250 || new Set(objectIds).size !== objectIds.length) {
      sessionError("WORKSPACE_BATCH_UNDO_INVALID", "objects.undo requires 1 to 250 unique canonical Objects.");
    }
    const operationId = stableId(payload.operationId, "operationId");
    objectIds.forEach(undoObjectId => {
      canonicalObject(current.entityId, undoObjectId);
      const entry = next.objects[undoObjectId];
      if (!entry || entry.returnSnapshot?.operationId !== operationId) {
        sessionError("WORKSPACE_RETURN_SNAPSHOT_MISMATCH", "Return snapshot does not match this operation.", { objectId: undoObjectId, operationId }, 409);
      }
    });
    objectIds.forEach(undoObjectId => {
      const entry = next.objects[undoObjectId];
      entry.currentPlacement = { ...entry.returnSnapshot.placement };
      entry.returnSnapshot = null;
      entry.updatedAt = timestamp;
    });
  } else if (type === "objects.summon.set") {
    const objects = Array.isArray(payload.objects) ? payload.objects : [];
    if (!objects.length || objects.length > 250) {
      sessionError("WORKSPACE_BATCH_SUMMON_INVALID", "objects.summon.set requires between 1 and 250 Objects.");
    }
    const objectIds = objects.map(item => cleanText(item?.objectId));
    if (new Set(objectIds).size !== objectIds.length) {
      sessionError("WORKSPACE_BATCH_SUMMON_DUPLICATE", "objects.summon.set contains a duplicate canonical Object.");
    }
    objects.forEach(item => {
      const summonedObjectId = cleanText(item?.objectId);
      canonicalObject(current.entityId, summonedObjectId);
      const entry = next.objects[summonedObjectId];
      if (!entry) {
        sessionError("WORKSPACE_OBJECT_NOT_ADMITTED", "Object must be admitted before session operations.", { objectId: summonedObjectId }, 409);
      }
      entry.activeSummonedContext = cleanText(item?.activeSummonedContext) || null;
      entry.updatedAt = timestamp;
    });
  } else if (type.startsWith("object.") || type === "summon.set") {
    canonicalObject(current.entityId, objectId);
  }

  if (["objects.admit", "objects.move", "objects.recall", "objects.undo", "objects.summon.set"].includes(type)) {
    // The batch was validated and applied atomically above.
  } else if (type === "object.admit") {
    if (next.objects[objectId]) {
      sessionError(
        "WORKSPACE_DUPLICATE_ACTIVE_PLACEMENT",
        "A canonical Object already has an active placement in this workspace scope.",
        { objectId },
        409
      );
    } else {
      const placement = placementFromPayload(payload);
      next.objects[objectId] = {
        objectId,
        sessionOrigin: { ...placement },
        currentPlacement: { ...placement },
        activeSummonedContext: cleanText(payload.activeSummonedContext) || null,
        returnSnapshot: null,
        admittedAt: timestamp,
        updatedAt: timestamp
      };
    }
  } else {
    const entry = next.objects[objectId];
    if ((type.startsWith("object.") || type === "summon.set") && !entry) {
      sessionError("WORKSPACE_OBJECT_NOT_ADMITTED", "Object must be admitted before session operations.", { objectId }, 409);
    }
    if (type === "object.move") {
      entry.currentPlacement = placementFromPayload(payload, entry.currentPlacement);
      entry.updatedAt = timestamp;
    } else if (type === "object.recall") {
      entry.currentPlacement = { ...entry.sessionOrigin };
      entry.updatedAt = timestamp;
    } else if (type === "object.snapshot.capture") {
      const operationId = stableId(payload.operationId, "operationId");
      if (entry.returnSnapshot?.operationId === operationId) changed = false;
      else {
        entry.returnSnapshot = {
          operationId,
          placement: { ...entry.currentPlacement },
          capturedAt: timestamp
        };
        entry.updatedAt = timestamp;
      }
    } else if (type === "object.undo") {
      const operationId = stableId(payload.operationId, "operationId");
      if (!entry.returnSnapshot || entry.returnSnapshot.operationId !== operationId) {
        sessionError("WORKSPACE_RETURN_SNAPSHOT_MISMATCH", "Return snapshot does not match this operation.", { objectId, operationId }, 409);
      }
      entry.currentPlacement = { ...entry.returnSnapshot.placement };
      entry.returnSnapshot = null;
      entry.updatedAt = timestamp;
    } else if (type === "summon.set") {
      entry.activeSummonedContext = cleanText(payload.activeSummonedContext) || null;
      entry.updatedAt = timestamp;
    } else if (type === "surface.reorder") {
      const surfaceId = stableId(payload.surfaceId, "surfaceId");
      const ordered = Array.isArray(payload.orderedObjectIds)
        ? payload.orderedObjectIds.map(id => cleanText(id))
        : [];
      if (new Set(ordered).size !== ordered.length) {
        sessionError("WORKSPACE_SURFACE_ORDER_DUPLICATE", "Surface order contains duplicate Objects.");
      }
      ordered.forEach(id => canonicalObject(current.entityId, id));
      const members = Object.values(next.objects)
        .filter(item => item.currentPlacement.surfaceId === surfaceId)
        .map(item => item.objectId)
        .sort();
      if (ordered.slice().sort().join("|") !== members.join("|")) {
        sessionError("WORKSPACE_SURFACE_ORDER_INCOMPLETE", "Surface reorder must include its complete canonical membership.", { surfaceId }, 409);
      }
      ordered.forEach((id, index) => {
        next.objects[id].currentPlacement.visualOrder = index;
        next.objects[id].updatedAt = timestamp;
      });
    }
  }

  if (!changed) return { changed: false, session: current };
  next.revision = current.revision + 1;
  next.updatedBy = context.principalId;
  next.lastCommandId = stableId(commandId, "commandId");
  next.updatedAt = timestamp;
  const sessions = readSessions();
  if (sessions[current.sessionId]?.revision !== current.revision) {
    sessionError("WORKSPACE_SESSION_REVISION_CONFLICT", "Workspace session changed during command processing.", null, 409);
  }
  sessions[current.sessionId] = next;
  writeSessions(sessions);
  try {
    appendEvent({
      entityId: current.entityId,
      eventType: `workspace.session.${type}`,
      objectId: objectId || null,
      actorId: context.principalId,
      commandId,
      payload: {
        sessionId: current.sessionId,
        workspaceId: current.workspaceId,
        placementScope: current.placementScope,
        revision: next.revision
      }
    });
  } catch (error) {
    sessions[current.sessionId] = current;
    writeSessions(sessions);
    throw error;
  }
  return { changed: true, session: next };
}

function endWorkspaceSession({ context, sessionId, expectedRevision, commandId }) {
  const current = getWorkspaceSession({ sessionId, context });
  if (Number(expectedRevision) !== current.revision) {
    sessionError("WORKSPACE_SESSION_REVISION_CONFLICT", "Workspace session changed before it ended.", { expectedRevision, currentRevision: current.revision }, 409);
  }
  const timestamp = nowIso();
  const next = {
    ...current,
    status: "ended",
    revision: current.revision + 1,
    objects: Object.fromEntries(Object.entries(current.objects).map(([id, entry]) => [id, {
      ...entry,
      returnSnapshot: null
    }])),
    lastCommandId: stableId(commandId, "commandId"),
    updatedBy: context.principalId,
    updatedAt: timestamp,
    endedAt: timestamp
  };
  const sessions = readSessions();
  sessions[current.sessionId] = next;
  writeSessions(sessions);
  try {
    appendEvent({
      entityId: current.entityId,
      eventType: "workspace.session.ended",
      actorId: context.principalId,
      commandId,
      payload: { sessionId: current.sessionId, workspaceId: current.workspaceId, revision: next.revision }
    });
  } catch (error) {
    sessions[current.sessionId] = current;
    writeSessions(sessions);
    throw error;
  }
  return { changed: true, session: next };
}

module.exports = {
  DEFAULT_SESSION_TTL_MS,
  MAX_SESSION_TTL_MS,
  openWorkspaceSession,
  getWorkspaceSession,
  applyWorkspaceSessionCommand,
  endWorkspaceSession
};
