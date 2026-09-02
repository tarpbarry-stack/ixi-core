const fs = require("fs");
const path = require("path");
const assert = require("assert");

const TEST_ROOT = path.join(
  "/tmp",
  `ixi-mos-foundation-${process.pid}`
);

process.env.IXI_MOS_DATA_ROOT =
  TEST_ROOT;

fs.rmSync(TEST_ROOT, {
  recursive: true,
  force: true
});

const {
  createEntity,
  getEntity
} = require("../entities/entityService");

const {
  createObject,
  getObject,
  listObjects
} = require("../objects/objectService");

const {
  listEvents
} = require("../events/eventService");

const entity = createEntity({
  displayName: "IXI Construction",
  sharetribeUserId: "sharetribe-user-1",
  actorId: "owner-1"
});

assert.ok(entity.entityId);
assert.strictEqual(
  getEntity(entity.entityId).displayName,
  "IXI Construction"
);

const job = createObject({
  entityId: entity.entityId,
  objectType: "job",
  displayName: "Plains Job 243",
  customerCategory: "Jobs",
  value: 1250000,
  actorId: "owner-1"
});

assert.ok(job.objectId);
assert.strictEqual(job.capabilities.canContain, true);
assert.strictEqual(job.value, 1250000);

const tool = createObject({
  entityId: entity.entityId,
  objectType: "tool",
  displayName: "Snap-on Socket Set",
  customerCategory: "Tools",
  customerAssetId: "TOOL-18",
  actorId: "owner-1"
});

assert.strictEqual(
  getObject(tool.objectId).displayName,
  "Snap-on Socket Set"
);

const objects = listObjects({
  entityId: entity.entityId
});

assert.strictEqual(objects.length, 2);

const events = listEvents({
  entityId: entity.entityId
});

assert.strictEqual(events.length, 3);
assert.strictEqual(
  events[0].eventType,
  "entity.created"
);

console.log(
  JSON.stringify(
    {
      ok: true,
      entityId: entity.entityId,
      objectIds: objects.map(
        object => object.objectId
      ),
      eventCount: events.length,
      testRoot: TEST_ROOT
    },
    null,
    2
  )
);
