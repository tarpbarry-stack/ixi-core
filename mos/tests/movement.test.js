const fs = require("fs");
const path = require("path");
const assert = require("assert");

const TEST_ROOT = path.join(
  "/tmp",
  `ixi-mos-movement-${process.pid}`
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
  placeObjectInContainer
} = require("../containers/containerService");

const {
  rebuildEntityProjections,
  getContainerProjection,
  getBranchSummary
} = require("../projections/projectionService");

const {
  executeImmediateMove,
  requestFreightMove,
  completeFreightMove,
  listMovements
} = require("../movements/movementService");

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  readJsonFile,
  writeJsonFileAtomic
} = require("../storage/jsonStore");

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

const job = createObject({
  entityId: entity.entityId,
  objectType: "job",
  displayName: "Job 41",
  actorId: "owner-1"
});

const truck = createObject({
  entityId: entity.entityId,
  objectType: "vehicle",
  displayName: "Truck 18",
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
  displayName: "Socket Set",
  value: 2500,
  actorId: "owner-1"
});

const objects = readJsonFile(
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
  objectId: truck.objectId,
  destinationContainerId:
    yard.objectId,
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

rebuildEntityProjections(
  entity.entityId
);

const yardBefore =
  getContainerProjection(
    yard.objectId
  );

assert.strictEqual(
  yardBefore.descendantItemCount,
  3
);

assert.strictEqual(
  yardBefore.branchValue,
  96500
);

const branch =
  getBranchSummary(
    truck.objectId
  );

assert.strictEqual(
  branch.branchValue,
  96500
);

assert.strictEqual(
  branch.branchItemCount,
  3
);

const moveCommandId =
  "cmd-move-truck-18";

const moveResult =
  executeImmediateMove({
    commandId: moveCommandId,
    entityId: entity.entityId,
    objectId: truck.objectId,
    destinationContainerId:
      job.objectId,
    actorId: "owner-1"
  });

assert.strictEqual(
  moveResult.duplicate,
  false
);

assert.strictEqual(
  getObject(truck.objectId)
    .directContainerId,
  job.objectId
);

const duplicateMove =
  executeImmediateMove({
    commandId: moveCommandId,
    entityId: entity.entityId,
    objectId: truck.objectId,
    destinationContainerId:
      job.objectId,
    actorId: "owner-1"
  });

assert.strictEqual(
  duplicateMove.duplicate,
  true
);

const yardAfter =
  getContainerProjection(
    yard.objectId
  );

const jobAfter =
  getContainerProjection(
    job.objectId
  );

assert.strictEqual(
  yardAfter.descendantItemCount,
  0
);

assert.strictEqual(
  jobAfter.descendantItemCount,
  3
);

assert.strictEqual(
  jobAfter.branchValue,
  96500
);

const freightRequest =
  requestFreightMove({
    commandId:
      "cmd-freight-request-1",
    entityId: entity.entityId,
    objectId: truck.objectId,
    destinationContainerId:
      yard.objectId,
    actorId: "owner-1"
  });

assert.strictEqual(
  freightRequest
    .physicalLocationChanged,
  false
);

assert.strictEqual(
  getObject(truck.objectId)
    .directContainerId,
  job.objectId
);

const completedFreight =
  completeFreightMove({
    commandId:
      "cmd-freight-complete-1",
    movementId:
      freightRequest
        .movement
        .movementId,
    actorId: "owner-1"
  });

assert.strictEqual(
  completedFreight
    .movement.status,
  "completed"
);

assert.strictEqual(
  getObject(truck.objectId)
    .directContainerId,
  yard.objectId
);

assert.strictEqual(
  listMovements({
    entityId: entity.entityId
  }).length,
  3
);

console.log(
  JSON.stringify(
    {
      ok: true,
      entityId: entity.entityId,
      truckId: truck.objectId,
      branchValue:
        branch.branchValue,
      movedToJob:
        moveResult
          .movement
          .movementId,
      freightMovementId:
        freightRequest
          .movement
          .movementId,
      movementCount:
        listMovements({
          entityId:
            entity.entityId
        }).length,
      testRoot: TEST_ROOT
    },
    null,
    2
  )
);
