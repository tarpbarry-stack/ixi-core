"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-session-placement-"));
process.env.IXI_MOS_DATA_ROOT = path.join(testRoot, "mos");
process.env.IXI_PASSPORT_DATA_FILE = path.join(testRoot, "passports.json");

const { ensureAosAccount } = require("../accounts/aosAccountService");
const { provisionAosObject } = require("../provisioning/aosObjectProvisioningService");
const { MOS_PATHS } = require("../storage/mosPaths");
const { readJsonFile, writeJsonFileAtomic } = require("../storage/jsonStore");
const { readPassportRecords } = require("../../passport/passportRegistry");
const {
  openWorkspaceSession,
  getWorkspaceSession,
  applyWorkspaceSessionCommand,
  endWorkspaceSession
} = require("../workspaces/sessionPlacementService");

test.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

const bootstrap = ensureAosAccount({ ownerUserId: "owner-1", displayName: "Star and Sons" });
const first = provisionAosObject({
  commandId: "session-object-1",
  entityId: bootstrap.entity.entityId,
  objectType: "customer-defined",
  displayName: "First",
  actorId: "owner-1"
}).object;
const second = provisionAosObject({
  commandId: "session-object-2",
  entityId: bootstrap.entity.entityId,
  objectType: "customer-defined",
  displayName: "Second",
  actorId: "owner-1"
}).object;

const context = {
  principalId: "owner-1",
  entityId: bootstrap.entity.entityId,
  tenantId: bootstrap.account.tenantId,
  sharedAuthorized: false
};

function command(session, commandType, payload, suffix) {
  return applyWorkspaceSessionCommand({
    context,
    sessionId: session.sessionId,
    expectedRevision: session.revision,
    commandId: `session-command-${suffix}`,
    commandType,
    payload
  }).session;
}

test("personal sessions are isolated and unexpired sessions resume", () => {
  const opened = openWorkspaceSession({
    context,
    workspaceId: "aos-work",
    commandId: "open-personal-1"
  });
  const resumed = openWorkspaceSession({
    context,
    workspaceId: "aos-work",
    commandId: "open-personal-retry"
  });
  assert.equal(opened.created, true);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.session.sessionId, opened.session.sessionId);
  assert.throws(
    () => getWorkspaceSession({
      sessionId: opened.session.sessionId,
      context: { ...context, principalId: "other-user" }
    }),
    error => error.code === "WORKSPACE_PERSONAL_SCOPE_DENIED"
  );
});

test("shared scopes require explicit server authorization", () => {
  assert.throws(
    () => openWorkspaceSession({
      context,
      workspaceId: "shared-work",
      placementScope: "shared",
      sharedScopeId: "operations",
      commandId: "open-shared-denied"
    }),
    error => error.code === "WORKSPACE_SHARED_SCOPE_DENIED"
  );
  const opened = openWorkspaceSession({
    context: { ...context, sharedAuthorized: true },
    workspaceId: "shared-work",
    placementScope: "shared",
    sharedScopeId: "operations",
    commandId: "open-shared-allowed"
  });
  assert.equal(opened.session.scopeOwnerId, "operations");
});

test("origin is immutable, snapshots are operation-specific, and recall uses origin", () => {
  let session = openWorkspaceSession({
    context,
    workspaceId: "origin-work",
    commandId: "open-origin"
  }).session;
  session = command(session, "object.admit", {
    objectId: first.objectId,
    surfaceId: "equipment",
    visualOrder: 0,
    operatingState: "tucked"
  }, "admit");
  const origin = session.objects[first.objectId].sessionOrigin;
  session = command(session, "object.snapshot.capture", {
    objectId: first.objectId,
    operationId: "move-1"
  }, "snapshot");
  session = command(session, "object.move", {
    objectId: first.objectId,
    surfaceId: "wichita-falls",
    visualOrder: 1,
    operatingState: "operating"
  }, "move");
  assert.deepEqual(session.objects[first.objectId].sessionOrigin, origin);
  session = command(session, "object.undo", {
    objectId: first.objectId,
    operationId: "move-1"
  }, "undo");
  assert.deepEqual(session.objects[first.objectId].currentPlacement, origin);
  assert.equal(session.objects[first.objectId].returnSnapshot, null);
  assert.throws(
    () => command(session, "object.undo", {
      objectId: first.objectId,
      operationId: "move-1"
    }, "undo-again"),
    error => error.code === "WORKSPACE_RETURN_SNAPSHOT_MISMATCH"
  );
  session = command(session, "object.move", {
    objectId: first.objectId,
    surfaceId: "somewhere-else"
  }, "move-again");
  session = command(session, "object.recall", { objectId: first.objectId }, "recall");
  assert.deepEqual(session.objects[first.objectId].currentPlacement, origin);
});

test("revision conflicts and noncanonical placement keys fail closed", () => {
  let session = openWorkspaceSession({
    context,
    workspaceId: "conflict-work",
    commandId: "open-conflict"
  }).session;
  assert.throws(
    () => applyWorkspaceSessionCommand({
      context,
      sessionId: session.sessionId,
      expectedRevision: 99,
      commandId: "stale",
      commandType: "object.admit",
      payload: { objectId: first.objectId, surfaceId: "board" }
    }),
    error => error.code === "WORKSPACE_SESSION_REVISION_CONFLICT"
  );
  for (const identity of ["listing-123", first.identities[0].passportId]) {
    assert.throws(
      () => command(session, "object.admit", { objectId: identity, surfaceId: "board" }, identity),
      error => error.code === "WORKSPACE_CANONICAL_OBJECT_REQUIRED"
    );
  }
});

test("one canonical object has one placement and complete surface reorder is stable", () => {
  let session = openWorkspaceSession({
    context,
    workspaceId: "reorder-work",
    commandId: "open-reorder"
  }).session;
  session = command(session, "object.admit", { objectId: first.objectId, surfaceId: "board" }, "first");
  assert.throws(
    () => applyWorkspaceSessionCommand({
      context,
      sessionId: session.sessionId,
      expectedRevision: session.revision,
      commandId: "duplicate-admit",
      commandType: "object.admit",
      payload: { objectId: first.objectId, surfaceId: "other" }
    }),
    error => error.code === "WORKSPACE_DUPLICATE_ACTIVE_PLACEMENT"
  );
  session = command(session, "object.admit", { objectId: second.objectId, surfaceId: "board" }, "second");
  session = command(session, "surface.reorder", {
    surfaceId: "board",
    orderedObjectIds: [second.objectId, first.objectId]
  }, "reorder");
  assert.equal(session.objects[second.objectId].currentPlacement.visualOrder, 0);
  assert.equal(session.objects[first.objectId].currentPlacement.visualOrder, 1);
});

test("expired sessions cannot resume and end consumes operation snapshots", () => {
  let session = openWorkspaceSession({
    context,
    workspaceId: "end-work",
    commandId: "open-end"
  }).session;
  session = command(session, "object.admit", { objectId: first.objectId, surfaceId: "board" }, "end-admit");
  session = command(session, "object.snapshot.capture", { objectId: first.objectId, operationId: "op-end" }, "end-snapshot");
  const ended = endWorkspaceSession({
    context,
    sessionId: session.sessionId,
    expectedRevision: session.revision,
    commandId: "end-session"
  }).session;
  assert.equal(ended.status, "ended");
  assert.equal(ended.objects[first.objectId].returnSnapshot, null);

  const expiring = openWorkspaceSession({
    context,
    workspaceId: "expiry-work",
    commandId: "open-expiry"
  }).session;
  const records = readJsonFile(MOS_PATHS.workspaceSessions, {});
  records[expiring.sessionId].expiresAt = "2000-01-01T00:00:00.000Z";
  writeJsonFileAtomic(MOS_PATHS.workspaceSessions, records);
  assert.throws(
    () => getWorkspaceSession({ sessionId: expiring.sessionId, context }),
    error => error.code === "WORKSPACE_SESSION_EXPIRED"
  );
  const replacement = openWorkspaceSession({
    context,
    workspaceId: "expiry-work",
    commandId: "open-after-expiry"
  });
  assert.notEqual(replacement.session.sessionId, expiring.sessionId);
});

test("placement commands cannot create Objects or Passports", () => {
  const beforeObjects = Object.keys(readJsonFile(MOS_PATHS.objects, {})).length;
  const beforePassports = readPassportRecords().length;
  let session = openWorkspaceSession({
    context,
    workspaceId: "growth-work",
    commandId: "open-growth"
  }).session;
  session = command(session, "object.admit", { objectId: first.objectId, surfaceId: "equipment" }, "growth-admit");
  session = command(session, "object.move", { objectId: first.objectId, surfaceId: "yard" }, "growth-move");
  assert.equal(Object.keys(readJsonFile(MOS_PATHS.objects, {})).length, beforeObjects);
  assert.equal(readPassportRecords().length, beforePassports);
});
