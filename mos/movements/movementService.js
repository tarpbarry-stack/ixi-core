const crypto = require("crypto");

const {
  readJsonFile,
  writeJsonFileAtomic
} = require("../storage/jsonStore");

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  MOS_MOVEMENT_STATUS,
  MOS_MOVEMENT_TYPES
} = require("../constants");

const {
  createMosId
} = require("../objects/objectIdEngine");

const {
  MosError
} = require("../errors/MosError");

const {
  cleanText,
  nowIso
} = require("../util/normalize");

const {
  getObject
} = require("../objects/objectService");

const {
  placeObjectInContainer,
  resolveEffectivePath
} = require("../containers/containerService");

const {
  rebuildEntityProjections,
  getContainerProjection,
  getBranchSummary
} = require("../projections/projectionService");

const {
  appendEvent
} = require("../events/eventService");

const {
  beginCommand,
  completeCommand,
  failCommand
} = require("../commands/idempotencyService");

function readMovements() {
  return readJsonFile(
    MOS_PATHS.movements,
    {}
  );
}

function hashPayload(payload) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(payload)
    )
    .digest("hex");
}

function createMovementRecord({
  entityId,
  objectId,
  fromContainerId,
  toContainerId,
  movementType,
  actorId,
  commandId,
  reason = null,
  status
}) {
  const timestamp = nowIso();

  return {
    movementId:
      createMosId("movement"),

    entityId,
    objectId,

    fromContainerId:
      fromContainerId || null,

    toContainerId,

    movementType,
    status,

    actorId:
      cleanText(actorId) || null,

    commandId,

    reason:
      cleanText(reason) || null,

    requestedAt: timestamp,
    completedAt:
      status ===
      MOS_MOVEMENT_STATUS.COMPLETED
        ? timestamp
        : null,

    cancelledAt: null,

    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function executeImmediateMove({
  commandId,
  entityId,
  objectId,
  destinationContainerId,
  movementType =
    MOS_MOVEMENT_TYPES.IMMEDIATE,
  actorId = null,
  reason = null,
  metadata = {}
}) {
  const commandPayload = {
    entityId,
    objectId,
    destinationContainerId,
    movementType,
    actorId,
    reason,
    metadata
  };

  const payloadHash =
    hashPayload(commandPayload);

  const commandStart =
    beginCommand({
      commandId,
      entityId,
      commandType:
        "movement.execute-immediate",
      payloadHash
    });

  if (commandStart.duplicate) {
    const existing =
      commandStart.record;

    if (
      existing.payloadHash !==
      payloadHash
    ) {
      throw new MosError(
        "COMMAND_PAYLOAD_CONFLICT",
        "The commandId was already used with a different payload.",
        {
          commandId,
          existingPayloadHash:
            existing.payloadHash,
          incomingPayloadHash:
            payloadHash
        },
        409
      );
    }

    if (
      existing.status ===
      "completed"
    ) {
      return {
        duplicate: true,
        ...existing.result
      };
    }

    throw new MosError(
      "COMMAND_ALREADY_PROCESSING",
      "The movement command is already being processed.",
      {
        commandId,
        status: existing.status
      },
      409
    );
  }

  try {
    const object =
      getObject(objectId);

    if (
      object.entityId !== entityId
    ) {
      throw new MosError(
        "OBJECT_ENTITY_MISMATCH",
        "Object does not belong to the supplied entity.",
        {
          objectId,
          objectEntityId:
            object.entityId,
          entityId
        },
        403
      );
    }

    const fromContainerId =
      object.directContainerId ||
      null;

    const branchBefore =
      getBranchSummary(
        objectId
      );

    const containmentResult =
      placeObjectInContainer({
        objectId,
        destinationContainerId,
        actorId,
        commandId,
        metadata: {
          ...metadata,
          movementType,
          reason
        }
      });

    rebuildEntityProjections(
      entityId
    );

    const sourceProjection =
      fromContainerId
        ? getContainerProjection(
            fromContainerId
          )
        : null;

    const destinationProjection =
      getContainerProjection(
        destinationContainerId
      );

    const movement =
      createMovementRecord({
        entityId,
        objectId,
        fromContainerId,
        toContainerId:
          destinationContainerId,
        movementType,
        actorId,
        commandId,
        reason,
        status:
          MOS_MOVEMENT_STATUS
            .COMPLETED
      });

    const movements =
      readMovements();

    movements[
      movement.movementId
    ] = movement;

    writeJsonFileAtomic(
      MOS_PATHS.movements,
      movements
    );

    const event =
      appendEvent({
        entityId,
        eventType:
          "movement.completed",
        objectId,
        actorId,
        commandId,
        payload: {
          movementId:
            movement.movementId,
          movementType,
          fromContainerId,
          toContainerId:
            destinationContainerId,
          branchBefore
        }
      });

    const result = {
      changed:
        containmentResult.changed,
      movement,
      event,
      effectivePath:
        resolveEffectivePath(
          objectId
        ),
      branch:
        getBranchSummary(
          objectId
        ),
      sourceProjection,
      destinationProjection
    };

    completeCommand({
      commandId,
      result
    });

    return {
      duplicate: false,
      ...result
    };
  } catch (error) {
    failCommand({
      commandId,
      error
    });

    throw error;
  }
}

function requestFreightMove({
  commandId,
  entityId,
  objectId,
  destinationContainerId,
  actorId = null,
  reason = null,
  metadata = {}
}) {
  const commandPayload = {
    entityId,
    objectId,
    destinationContainerId,
    movementType:
      MOS_MOVEMENT_TYPES
        .FREIGHT_REQUIRED,
    actorId,
    reason,
    metadata
  };

  const payloadHash =
    hashPayload(commandPayload);

  const commandStart =
    beginCommand({
      commandId,
      entityId,
      commandType:
        "movement.request-freight",
      payloadHash
    });

  if (commandStart.duplicate) {
    const existing =
      commandStart.record;

    if (
      existing.payloadHash !==
      payloadHash
    ) {
      throw new MosError(
        "COMMAND_PAYLOAD_CONFLICT",
        "The commandId was already used with a different payload.",
        {
          commandId
        },
        409
      );
    }

    if (
      existing.status ===
      "completed"
    ) {
      return {
        duplicate: true,
        ...existing.result
      };
    }

    throw new MosError(
      "COMMAND_ALREADY_PROCESSING",
      "The freight command is already being processed.",
      {
        commandId,
        status: existing.status
      },
      409
    );
  }

  try {
    const object =
      getObject(objectId);

    if (
      object.entityId !== entityId
    ) {
      throw new MosError(
        "OBJECT_ENTITY_MISMATCH",
        "Object does not belong to the supplied entity.",
        {
          objectId,
          objectEntityId:
            object.entityId,
          entityId
        },
        403
      );
    }

    const movement =
      createMovementRecord({
        entityId,
        objectId,
        fromContainerId:
          object.directContainerId ||
          null,
        toContainerId:
          destinationContainerId,
        movementType:
          MOS_MOVEMENT_TYPES
            .FREIGHT_REQUIRED,
        actorId,
        commandId,
        reason,
        status:
          MOS_MOVEMENT_STATUS
            .REQUESTED
      });

    movement.metadata = metadata;

    const movements =
      readMovements();

    movements[
      movement.movementId
    ] = movement;

    writeJsonFileAtomic(
      MOS_PATHS.movements,
      movements
    );

    const event =
      appendEvent({
        entityId,
        eventType:
          "freight.requested",
        objectId,
        actorId,
        commandId,
        payload: {
          movementId:
            movement.movementId,
          fromContainerId:
            movement
              .fromContainerId,
          toContainerId:
            destinationContainerId,
          branch:
            getBranchSummary(
              objectId
            ),
          metadata
        }
      });

    const result = {
      movement,
      event,
      physicalLocationChanged:
        false,
      effectivePath:
        resolveEffectivePath(
          objectId
        ),
      branch:
        getBranchSummary(
          objectId
        )
    };

    completeCommand({
      commandId,
      result
    });

    return {
      duplicate: false,
      ...result
    };
  } catch (error) {
    failCommand({
      commandId,
      error
    });

    throw error;
  }
}

function completeFreightMove({
  commandId,
  movementId,
  actorId = null
}) {
  const movements =
    readMovements();

  const movement =
    movements[movementId];

  if (!movement) {
    throw new MosError(
      "MOVEMENT_NOT_FOUND",
      `Movement not found: ${movementId}`,
      { movementId },
      404
    );
  }

  if (
    movement.status ===
    MOS_MOVEMENT_STATUS.COMPLETED
  ) {
    return {
      duplicate: true,
      movement
    };
  }

  if (
    movement.status ===
    MOS_MOVEMENT_STATUS.CANCELLED
  ) {
    throw new MosError(
      "MOVEMENT_CANCELLED",
      "A cancelled movement cannot be completed.",
      { movementId },
      409
    );
  }

  const moveResult =
    executeImmediateMove({
      commandId,
      entityId:
        movement.entityId,
      objectId:
        movement.objectId,
      destinationContainerId:
        movement.toContainerId,
      movementType:
        MOS_MOVEMENT_TYPES
          .PHYSICAL_TRANSFER,
      actorId,
      reason:
        movement.reason,
      metadata: {
        freightMovementId:
          movementId
      }
    });

  const refreshedMovements =
    readMovements();

  const timestamp = nowIso();

  refreshedMovements[
    movementId
  ] = {
    ...movement,
    status:
      MOS_MOVEMENT_STATUS
        .COMPLETED,
    completedAt: timestamp,
    updatedAt: timestamp,
    completedByActorId:
      cleanText(actorId) || null
  };

  writeJsonFileAtomic(
    MOS_PATHS.movements,
    refreshedMovements
  );

  return {
    duplicate: false,
    movement:
      refreshedMovements[
        movementId
      ],
    moveResult
  };
}

function listMovements({
  entityId = null,
  objectId = null,
  status = null
} = {}) {
  const movements =
    readMovements();

  return Object.values(
    movements
  ).filter(movement => {
    if (
      entityId &&
      movement.entityId !==
        entityId
    ) {
      return false;
    }

    if (
      objectId &&
      movement.objectId !==
        objectId
    ) {
      return false;
    }

    if (
      status &&
      movement.status !== status
    ) {
      return false;
    }

    return true;
  });
}

module.exports = {
  executeImmediateMove,
  requestFreightMove,
  completeFreightMove,
  listMovements
};
