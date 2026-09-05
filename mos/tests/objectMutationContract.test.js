const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const TEST_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), "ixi-mos-object-contract-")
);

process.env.IXI_MOS_DATA_ROOT = TEST_ROOT;

const {
  createEntity
} = require("../entities/entityService");

const {
  createObject,
  getObject,
  updateObject
} = require("../objects/objectService");

const {
  listEvents
} = require("../events/eventService");

test.after(() => {
  fs.rmSync(TEST_ROOT, {
    recursive: true,
    force: true
  });
});

test("Object updates advance a durable revision and record command lineage", () => {
  const entity = createEntity({
    displayName: "Revision Test Entity",
    sharetribeUserId: "revision-user",
    actorId: "revision-user"
  });

  const created = createObject({
    entityId: entity.entityId,
    objectType: "person",
    displayName: "Initial Name",
    actorId: "revision-user"
  });

  assert.equal(created.revision, 1);

  const updated = updateObject({
    objectId: created.objectId,
    displayName: "Updated Name",
    expectedRevision: 1,
    commandId: "object-update-1",
    actorId: "revision-user"
  });

  assert.equal(updated.revision, 2);
  assert.equal(updated.displayName, "Updated Name");
  assert.equal(getObject(created.objectId).revision, 2);

  const updateEvent = listEvents({
    entityId: entity.entityId,
    objectId: created.objectId,
    eventType: "object.updated"
  })[0];

  assert.equal(updateEvent.commandId, "object-update-1");
  assert.equal(updateEvent.payload.previousRevision, 1);
  assert.equal(updateEvent.payload.revision, 2);
});

test("A stale Object update fails closed without changing canonical data", () => {
  const entity = createEntity({
    displayName: "Conflict Test Entity",
    sharetribeUserId: "conflict-user",
    actorId: "conflict-user"
  });

  const created = createObject({
    entityId: entity.entityId,
    objectType: "person",
    displayName: "Canonical Name",
    actorId: "conflict-user"
  });

  updateObject({
    objectId: created.objectId,
    displayName: "Revision Two",
    expectedRevision: 1,
    commandId: "object-update-2",
    actorId: "conflict-user"
  });

  assert.throws(
    () => updateObject({
      objectId: created.objectId,
      displayName: "Stale Overwrite",
      expectedRevision: 1,
      commandId: "stale-object-update",
      actorId: "conflict-user"
    }),
    error =>
      error.code === "OBJECT_REVISION_CONFLICT" &&
      error.statusCode === 412 &&
      error.details.currentRevision === 2
  );

  const canonical = getObject(created.objectId);
  assert.equal(canonical.displayName, "Revision Two");
  assert.equal(canonical.revision, 2);
});

test("the HTTP boundary requires idempotency and matching revision headers", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "routes", "mosRouter.js"),
    "utf8"
  );

  assert.match(source, /idempotency-key/);
  assert.match(source, /req\.headers\["if-match"\]/);
  assert.match(source, /OBJECT_COMMAND_REUSE_CONFLICT/);
  assert.match(source, /record\.status\s*===\s*"completed"/);
  assert.match(source, /replayed: true/);
});
