const {
  readJsonFile,
  writeJsonFileAtomic
} = require("../storage/jsonStore");

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  MOS_RELATIONSHIP_TYPES,
  MOS_OBJECT_STATUS
} = require("../constants");

const {
  MosError
} = require("../errors/MosError");

const {
  cleanText,
  nowIso
} = require("../util/normalize");

const {
  appendEvent
} = require("../events/eventService");

const {
  readRelationships,
  writeRelationships,
  createRelationshipRecord
} = require(
  "../relationships/relationshipService"
);

function readObjects() {
  return readJsonFile(
    MOS_PATHS.objects,
    {}
  );
}

function getRequiredObject(
  objects,
  objectId,
  label = "Object"
) {
  const object = objects[objectId];

  if (!object) {
    throw new MosError(
      "OBJECT_NOT_FOUND",
      `${label} not found: ${objectId}`,
      { objectId },
      404
    );
  }

  return object;
}

function assertSameEntity(
  sourceObject,
  targetObject
) {
  if (
    sourceObject.entityId !==
    targetObject.entityId
  ) {
    throw new MosError(
      "CROSS_ENTITY_CONTAINMENT_FORBIDDEN",
      "Objects from different entities cannot be physically contained together.",
      {
        sourceObjectId:
          sourceObject.objectId,
        sourceEntityId:
          sourceObject.entityId,
        targetObjectId:
          targetObject.objectId,
        targetEntityId:
          targetObject.entityId
      },
      403
    );
  }
}

function assertActive(object, label) {
  if (
    object.status !==
    MOS_OBJECT_STATUS.ACTIVE
  ) {
    throw new MosError(
      "OBJECT_NOT_ACTIVE",
      `${label} must be active.`,
      {
        objectId: object.objectId,
        status: object.status
      },
      409
    );
  }
}

function assertCanContain(container) {
  if (!container.capabilities?.canContain) {
    throw new MosError(
      "DESTINATION_CANNOT_CONTAIN",
      `${container.displayName} cannot contain other objects.`,
      {
        containerId: container.objectId,
        objectType: container.objectType
      },
      409
    );
  }
}

function buildAncestorPathFromObjects(
  objects,
  startingObjectId
) {
  const path = [];
  const visited = new Set();

  let currentId =
    cleanText(startingObjectId) || null;

  while (currentId) {
    if (visited.has(currentId)) {
      throw new MosError(
        "CONTAINMENT_CYCLE_DETECTED",
        "A containment cycle already exists in the object graph.",
        {
          repeatedObjectId: currentId,
          path
        },
        409
      );
    }

    visited.add(currentId);

    const current =
      getRequiredObject(
        objects,
        currentId
      );

    path.push(current.objectId);

    currentId =
      cleanText(
        current.directContainerId
      ) || null;
  }

  return path;
}

function assertNoCycle({
  objects,
  objectId,
  destinationContainerId
}) {
  if (
    objectId === destinationContainerId
  ) {
    throw new MosError(
      "SELF_CONTAINMENT_FORBIDDEN",
      "An object cannot contain itself.",
      {
        objectId,
        destinationContainerId
      },
      409
    );
  }

  const destinationAncestorPath =
    buildAncestorPathFromObjects(
      objects,
      destinationContainerId
    );

  if (
    destinationAncestorPath.includes(
      objectId
    )
  ) {
    throw new MosError(
      "DESCENDANT_MOVE_FORBIDDEN",
      "A container cannot be moved into one of its own descendants.",
      {
        objectId,
        destinationContainerId,
        destinationAncestorPath
      },
      409
    );
  }
}

function resolveEffectivePath(
  objectId
) {
  const objects = readObjects();

  const object =
    getRequiredObject(
      objects,
      objectId
    );

  const bottomUp =
    buildAncestorPathFromObjects(
      objects,
      object.objectId
    );

  const topDown = [...bottomUp].reverse();

  return {
    objectId,
    directContainerId:
      object.directContainerId || null,
    pathObjectIds: topDown,
    depth: Math.max(
      topDown.length - 1,
      0
    )
  };
}

function listDirectContents(
  containerId
) {
  const objects = readObjects();

  const container =
    getRequiredObject(
      objects,
      containerId,
      "Container"
    );

  assertCanContain(container);

  return Object.values(objects).filter(
    object =>
      object.status ===
        MOS_OBJECT_STATUS.ACTIVE &&
      object.directContainerId ===
        containerId
  );
}

function listAllDescendants(
  containerId
) {
  const objects = readObjects();

  const container =
    getRequiredObject(
      objects,
      containerId,
      "Container"
    );

  assertCanContain(container);

  const childrenByContainer =
    new Map();

  Object.values(objects).forEach(object => {
    const parentId =
      cleanText(
        object.directContainerId
      ) || null;

    if (!parentId) {
      return;
    }

    if (
      !childrenByContainer.has(parentId)
    ) {
      childrenByContainer.set(
        parentId,
        []
      );
    }

    childrenByContainer
      .get(parentId)
      .push(object);
  });

  const descendants = [];
  const visited = new Set();
  const queue = [containerId];

  while (queue.length) {
    const currentContainerId =
      queue.shift();

    if (
      visited.has(currentContainerId)
    ) {
      throw new MosError(
        "CONTAINMENT_CYCLE_DETECTED",
        "A containment cycle exists while resolving descendants.",
        {
          containerId,
          repeatedObjectId:
            currentContainerId
        },
        409
      );
    }

    visited.add(currentContainerId);

    const children =
      childrenByContainer.get(
        currentContainerId
      ) || [];

    children.forEach(child => {
      descendants.push(child);

      if (
        child.capabilities?.canContain
      ) {
        queue.push(child.objectId);
      }
    });
  }

  return descendants;
}

function placeObjectInContainer({
  objectId,
  destinationContainerId,
  actorId = null,
  commandId = null,
  metadata = {}
}) {
  const objectsBefore = readObjects();
  const relationshipsBefore =
    readRelationships();

  const object =
    getRequiredObject(
      objectsBefore,
      objectId
    );

  const destination =
    getRequiredObject(
      objectsBefore,
      destinationContainerId,
      "Destination container"
    );

  assertActive(object, "Object");
  assertActive(
    destination,
    "Destination container"
  );

  assertSameEntity(
    object,
    destination
  );

  assertCanContain(destination);

  assertNoCycle({
    objects: objectsBefore,
    objectId,
    destinationContainerId
  });

  const previousContainerId =
    cleanText(
      object.directContainerId
    ) || null;

  if (
    previousContainerId ===
    destinationContainerId
  ) {
    return {
      changed: false,
      object,
      previousContainerId,
      destinationContainerId,
      relationship: null,
      effectivePath:
        resolveEffectivePath(objectId)
    };
  }

  const objectsNext =
    JSON.parse(
      JSON.stringify(objectsBefore)
    );

  const relationshipsNext =
    JSON.parse(
      JSON.stringify(
        relationshipsBefore
      )
    );

  const timestamp = nowIso();

  Object.values(
    relationshipsNext
  ).forEach(relationship => {
    if (
      relationship.status === "active" &&
      relationship.relationshipType ===
        MOS_RELATIONSHIP_TYPES
          .CONTAINED_IN &&
      relationship.sourceObjectId ===
        objectId
    ) {
      relationship.status = "ended";
      relationship.updatedAt =
        timestamp;
      relationship.endedAt =
        timestamp;
    }
  });

  const relationship =
    createRelationshipRecord({
      entityId: object.entityId,
      relationshipType:
        MOS_RELATIONSHIP_TYPES
          .CONTAINED_IN,
      sourceObjectId: objectId,
      targetObjectId:
        destinationContainerId,
      actorId,
      metadata: {
        ...metadata,
        previousContainerId
      }
    });

  relationshipsNext[
    relationship.relationshipId
  ] = relationship;

  objectsNext[objectId] = {
    ...objectsNext[objectId],
    directContainerId:
      destinationContainerId,
    updatedAt: timestamp
  };

  try {
    writeRelationships(
      relationshipsNext
    );

    writeJsonFileAtomic(
      MOS_PATHS.objects,
      objectsNext
    );
  } catch (error) {
    try {
      writeRelationships(
        relationshipsBefore
      );

      writeJsonFileAtomic(
        MOS_PATHS.objects,
        objectsBefore
      );
    } catch (rollbackError) {
      console.error(
        "MOS CONTAINMENT ROLLBACK FAILED:",
        {
          originalError:
            error?.message ||
            String(error),
          rollbackError:
            rollbackError?.message ||
            String(rollbackError),
          objectId,
          destinationContainerId
        }
      );
    }

    throw error;
  }

  const event = appendEvent({
    entityId: object.entityId,
    eventType:
      "containment.changed",
    objectId,
    actorId,
    commandId,
    payload: {
      previousContainerId,
      destinationContainerId,
      relationshipId:
        relationship.relationshipId,
      metadata
    }
  });

  return {
    changed: true,
    object: objectsNext[objectId],
    previousContainerId,
    destinationContainerId,
    relationship,
    event,
    effectivePath:
      resolveEffectivePath(objectId)
  };
}

function removeObjectFromContainer({
  objectId,
  actorId = null,
  commandId = null,
  metadata = {}
}) {
  const objectsBefore = readObjects();
  const relationshipsBefore =
    readRelationships();

  const object =
    getRequiredObject(
      objectsBefore,
      objectId
    );

  const previousContainerId =
    cleanText(
      object.directContainerId
    ) || null;

  if (!previousContainerId) {
    return {
      changed: false,
      object,
      previousContainerId: null,
      effectivePath:
        resolveEffectivePath(objectId)
    };
  }

  const objectsNext =
    JSON.parse(
      JSON.stringify(objectsBefore)
    );

  const relationshipsNext =
    JSON.parse(
      JSON.stringify(
        relationshipsBefore
      )
    );

  const timestamp = nowIso();

  Object.values(
    relationshipsNext
  ).forEach(relationship => {
    if (
      relationship.status === "active" &&
      relationship.relationshipType ===
        MOS_RELATIONSHIP_TYPES
          .CONTAINED_IN &&
      relationship.sourceObjectId ===
        objectId
    ) {
      relationship.status = "ended";
      relationship.updatedAt =
        timestamp;
      relationship.endedAt =
        timestamp;
    }
  });

  objectsNext[objectId] = {
    ...objectsNext[objectId],
    directContainerId: null,
    updatedAt: timestamp
  };

  try {
    writeRelationships(
      relationshipsNext
    );

    writeJsonFileAtomic(
      MOS_PATHS.objects,
      objectsNext
    );
  } catch (error) {
    try {
      writeRelationships(
        relationshipsBefore
      );

      writeJsonFileAtomic(
        MOS_PATHS.objects,
        objectsBefore
      );
    } catch (rollbackError) {
      console.error(
        "MOS CONTAINMENT ROLLBACK FAILED:",
        {
          originalError:
            error?.message ||
            String(error),
          rollbackError:
            rollbackError?.message ||
            String(rollbackError),
          objectId
        }
      );
    }

    throw error;
  }

  const event = appendEvent({
    entityId: object.entityId,
    eventType:
      "containment.removed",
    objectId,
    actorId,
    commandId,
    payload: {
      previousContainerId,
      metadata
    }
  });

  return {
    changed: true,
    object: objectsNext[objectId],
    previousContainerId,
    event,
    effectivePath:
      resolveEffectivePath(objectId)
  };
}

module.exports = {
  placeObjectInContainer,
  removeObjectFromContainer,
  resolveEffectivePath,
  listDirectContents,
  listAllDescendants
};
