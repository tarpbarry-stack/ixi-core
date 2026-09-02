"use strict";

const {
  executeImmediateMove
} = require(
  "../../mos/movements/movementService"
);

const {
  getObject
} = require(
  "../../mos/objects/objectService"
);

const {
  clean
} = require("../util");

const {
  FreightError
} = require("../FreightError");

function completeAssetMove({
  commandId,
  entityId,
  actorId = "",
  objectId,
  destinationContainerId,
  moveType = "location",
  reason = "",
  metadata = {}
} = {}) {
  const resolvedCommandId =
    clean(commandId);

  const resolvedEntityId =
    clean(entityId);

  const resolvedObjectId =
    clean(objectId);

  const destination =
    clean(destinationContainerId);

  if (!resolvedCommandId) {
    throw new FreightError(
      "ASSET_MOVE_COMMAND_REQUIRED",
      "Asset Move requires a command ID.",
      {},
      400
    );
  }

  if (
    !resolvedEntityId ||
    !resolvedObjectId ||
    !destination
  ) {
    throw new FreightError(
      "ASSET_MOVE_REQUIRED_FIELDS",
      "Asset Move requires Entity, asset Object and destination.",
      {},
      400
    );
  }

  const object =
    getObject(
      resolvedObjectId
    );

  if (
    object.entityId !==
    resolvedEntityId
  ) {
    throw new FreightError(
      "ASSET_MOVE_ENTITY_MISMATCH",
      "Asset does not belong to the authenticated Entity.",
      {},
      403
    );
  }

  return executeImmediateMove({
    commandId:
      resolvedCommandId,

    entityId:
      resolvedEntityId,

    objectId:
      resolvedObjectId,

    destinationContainerId:
      destination,

    actorId:
      clean(actorId),

    reason:
      clean(reason) ||
      "IXI Asset Move Order",

    metadata: {
      ...(metadata &&
      typeof metadata === "object"
        ? metadata
        : {}),

      source:
        "ixi-transact",

      moveType:
        clean(moveType) ||
        "location",

      assetMoveOrder:
        true
    }
  });
}

module.exports = {
  completeAssetMove
};
