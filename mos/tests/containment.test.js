const fs = require("fs");
const path = require("path");
const assert = require("assert");

const TEST_ROOT = path.join(
  "/tmp",
  `ixi-mos-containment-${process.pid}`
);

process.env.IXI_MOS_DATA_ROOT =
  TEST_ROOT;

fs.rmSync(TEST_ROOT, {
  recursive: true,
  force: true
});

const {
  createEntity
} = require("../entities/entityService");

const {
  createObject,
  getObject
} = require("../objects/objectService");

const {
  placeObjectInContainer,
  removeObjectFromContainer,
  resolveEffectivePath,
  listDirectContents,
  listAllDescendants
} = require(
  "../containers/containerService"
);

const entity = createEntity({
  displayName: "IXI Construction",
  actorId: "owner-1"
});

const yard = createObject({
  entityId: entity.entityId,
  objectType: "location",
  displayName: "Midland Yard",
  actorId: "owner-1"
});

const shop = createObject({
  entityId: entity.entityId,
  objectType: "building",
  displayName: "Midland Shop",
  actorId: "owner-1"
});

const truck = createObject({
  entityId: entity.entityId,
  objectType: "vehicle",
  displayName: "Mechanic Truck 12",
  value: 82000,
  actorId: "owner-1"
});

const toolbox = createObject({
  entityId: entity.entityId,
  objectType: "tool",
  displayName: "Toolbox 4",
  value: 12000,
  actorId: "owner-1"
});

const socketSet = createObject({
  entityId: entity.entityId,
  objectType: "tool",
  displayName: "Snap-on Socket Set",
  value: 2500,
  actorId: "owner-1"
});

toolbox.capabilities.canContain = true;

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  readJsonFile,
  writeJsonFileAtomic
} = require("../storage/jsonStore");

const objects =
  readJsonFile(
    MOS_PATHS.objects,
    {}
  );

objects[toolbox.objectId]
  .capabilities.canContain = true;

writeJsonFileAtomic(
  MOS_PATHS.objects,
  objects
);

placeObjectInContainer({
  objectId: shop.objectId,
  destinationContainerId:
    yard.objectId,
  actorId: "owner-1"
});

placeObjectInContainer({
  objectId: truck.objectId,
  destinationContainerId:
    shop.objectId,
  actorId: "owner-1"
});

placeObjectInContainer({
  objectId: toolbox.objectId,
  destinationContainerId:
    truck.objectId,
  actorId: "owner-1"
});

placeObjectInContainer({
  objectId: socketSet.objectId,
  destinationContainerId:
    toolbox.objectId,
  actorId: "owner-1"
});

const pathResult =
  resolveEffectivePath(
    socketSet.objectId
  );

assert.deepStrictEqual(
  pathResult.pathObjectIds,
  [
    yard.objectId,
    shop.objectId,
    truck.objectId,
    toolbox.objectId,
    socketSet.objectId
  ]
);

assert.strictEqual(
  getObject(socketSet.objectId)
    .directContainerId,
  toolbox.objectId
);

assert.strictEqual(
  listDirectContents(
    truck.objectId
  ).length,
  1
);

assert.strictEqual(
  listAllDescendants(
    yard.objectId
  ).length,
  4
);

let cycleBlocked = false;

try {
  placeObjectInContainer({
    objectId: yard.objectId,
    destinationContainerId:
      toolbox.objectId,
    actorId: "owner-1"
  });
} catch (error) {
  cycleBlocked =
    error.code ===
    "DESCENDANT_MOVE_FORBIDDEN";
}

assert.strictEqual(
  cycleBlocked,
  true
);

const removal =
  removeObjectFromContainer({
    objectId: socketSet.objectId,
    actorId: "owner-1"
  });

assert.strictEqual(
  removal.changed,
  true
);

assert.strictEqual(
  getObject(socketSet.objectId)
    .directContainerId,
  null
);

console.log(
  JSON.stringify(
    {
      ok: true,
      entityId: entity.entityId,
      yardId: yard.objectId,
      pathBeforeRemoval:
        pathResult.pathObjectIds,
      descendantCount:
        listAllDescendants(
          yard.objectId
        ).length,
      cycleBlocked,
      testRoot: TEST_ROOT
    },
    null,
    2
  )
);
