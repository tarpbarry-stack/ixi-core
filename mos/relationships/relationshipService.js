const { readJsonFile, writeJsonFileAtomic } = require("../storage/jsonStore");
const { MOS_PATHS } = require("../storage/mosPaths");
const { MOS_RELATIONSHIP_TYPES, MOS_OBJECT_STATUS } = require("../constants");
const { createMosId } = require("../objects/objectIdEngine");
const { cleanText, normalizeKey, nowIso } = require("../util/normalize");
const { MosError } = require("../errors/MosError");
const { appendEvent } = require("../events/eventService");
const { getEdgeBehavior } = require("./edgeBehaviorRegistry");

function readRelationships() {
  return readJsonFile(MOS_PATHS.relationships, {});
}

function writeRelationships(relationships) {
  writeJsonFileAtomic(MOS_PATHS.relationships, relationships);
  return relationships;
}

function readObjects() {
  return readJsonFile(MOS_PATHS.objects, {});
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeMetadata(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? clone(value)
    : {};
}

function normalizeRelationshipType(value) {
  const displayName = cleanText(value);

  if (!displayName) {
    throw new MosError(
      "RELATIONSHIP_TYPE_REQUIRED",
      "A user-defined relationship name is required.",
      null,
      400
    );
  }

  if (displayName.length > 160) {
    throw new MosError(
      "RELATIONSHIP_TYPE_TOO_LONG",
      "Relationship names cannot exceed 160 characters.",
      { maximumLength: 160 },
      400
    );
  }

  return { displayName, key: normalizeKey(displayName) };
}

function requireObject(objects, objectId, endpoint) {
  const normalizedObjectId = cleanText(objectId);
  const object = objects[normalizedObjectId];

  if (!normalizedObjectId || !object) {
    throw new MosError(
      "RELATIONSHIP_OBJECT_NOT_FOUND",
      `${endpoint} Object not found: ${normalizedObjectId || "missing"}`,
      { objectId: normalizedObjectId || null, endpoint: endpoint.toLowerCase() },
      404
    );
  }

  if (object.status !== MOS_OBJECT_STATUS.ACTIVE) {
    throw new MosError(
      "RELATIONSHIP_OBJECT_INACTIVE",
      `${endpoint} Object is not active: ${normalizedObjectId}`,
      { objectId: normalizedObjectId, status: object.status || null },
      409
    );
  }

  return object;
}

function assertSameEntity(sourceObject, targetObject) {
  if (sourceObject.entityId !== targetObject.entityId) {
    throw new MosError(
      "CROSS_ENTITY_RELATIONSHIP_FORBIDDEN",
      "Objects from different Entities require an explicit cross-Entity agreement.",
      {
        sourceEntityId: sourceObject.entityId,
        targetEntityId: targetObject.entityId
      },
      403
    );
  }
}

function createRelationshipRecord({
  entityId,
  relationshipType,
  relationshipLabel = null,
  behaviorId = null,
  definitionId = null,
  orderKey = null,
  sourceObjectId,
  targetObjectId,
  actorId = null,
  commandId = null,
  effectiveFrom = null,
  effectiveTo = null,
  metadata = {}
}) {
  const timestamp = nowIso();
  const technicalBehavior = cleanText(behaviorId)
    ? getEdgeBehavior(behaviorId)
    : null;
  const labelValue = cleanText(relationshipLabel || relationshipType);
  const normalizedType = labelValue
    ? normalizeRelationshipType(labelValue)
    : { displayName: null, key: null };

  if (!technicalBehavior && !normalizedType.displayName) {
    throw new MosError(
      "RELATIONSHIP_CONTRACT_REQUIRED",
      "A technical behavior ID or customer relationship label is required.",
      null,
      400
    );
  }

  if (technicalBehavior && !cleanText(commandId)) {
    throw new MosError(
      "TECHNICAL_EDGE_COMMAND_REQUIRED",
      "Technical edge creation requires an idempotent command ID.",
      { behaviorId: technicalBehavior.behaviorId },
      428
    );
  }
  if (technicalBehavior && !cleanText(actorId)) {
    throw new MosError(
      "TECHNICAL_EDGE_ACTOR_REQUIRED",
      "Technical edge creation requires authenticated actor evidence.",
      { behaviorId: technicalBehavior.behaviorId },
      401
    );
  }

  return {
    relationshipId: createMosId("relationship"),
    entityId: cleanText(entityId),

    /* User vocabulary is preserved; IX Core does not infer its meaning. */
    relationshipType: normalizedType.displayName,
    relationshipKey: normalizedType.key,
    relationshipLabel: normalizedType.displayName,

    /* Technical behavior is stable. Customer vocabulary is optional data. */
    behaviorId: technicalBehavior?.behaviorId || null,
    definitionId: cleanText(definitionId) || null,
    orderKey: cleanText(orderKey) || null,
    behavior: technicalBehavior ? { ...technicalBehavior } : null,

    sourceObjectId: cleanText(sourceObjectId),
    targetObjectId: cleanText(targetObjectId),
    status: "active",
    revision: 1,
    actorId: cleanText(actorId) || null,
    createdBy: cleanText(actorId) || null,
    updatedBy: cleanText(actorId) || null,
    commandId: cleanText(commandId) || null,
    effectiveFrom: cleanText(effectiveFrom) || timestamp,
    effectiveTo: cleanText(effectiveTo) || null,
    metadata: normalizeMetadata(metadata),
    createdAt: timestamp,
    updatedAt: timestamp,
    endedAt: null
  };
}

function storedRelationshipKey(relationship) {
  return cleanText(relationship?.relationshipKey) || normalizeKey(
    relationship?.relationshipLabel || relationship?.relationshipType
  );
}

function listRelationships({
  entityId = null,
  relationshipType = null,
  relationshipKey = null,
  behaviorId = null,
  definitionId = null,
  sourceObjectId = null,
  targetObjectId = null,
  objectId = null,
  direction = "both",
  status = "active"
} = {}) {
  const requestedKey = cleanText(relationshipKey) || (
    cleanText(relationshipType) ? normalizeKey(relationshipType) : null
  );
  const normalizedDirection = cleanText(direction).toLowerCase() || "both";

  return Object.values(readRelationships()).filter(relationship => {
    if (entityId && relationship.entityId !== entityId) return false;
    if (behaviorId && relationship.behaviorId !== cleanText(behaviorId)) return false;
    if (definitionId && relationship.definitionId !== cleanText(definitionId)) return false;
    if (requestedKey && storedRelationshipKey(relationship) !== requestedKey) return false;
    if (sourceObjectId && relationship.sourceObjectId !== sourceObjectId) return false;
    if (targetObjectId && relationship.targetObjectId !== targetObjectId) return false;

    if (objectId) {
      const outgoing = relationship.sourceObjectId === objectId;
      const incoming = relationship.targetObjectId === objectId;
      if (normalizedDirection === "outgoing" ? !outgoing :
          normalizedDirection === "incoming" ? !incoming :
          !outgoing && !incoming) return false;
    }

    return !status || relationship.status === status;
  });
}

function getRelationship(relationshipId) {
  const id = cleanText(relationshipId);
  const relationship = readRelationships()[id];
  if (!relationship) {
    throw new MosError(
      "RELATIONSHIP_NOT_FOUND",
      `Relationship not found: ${id || "missing"}`,
      { relationshipId: id || null },
      404
    );
  }
  return relationship;
}

function createObjectRelationship({
  relationshipType,
  relationshipLabel = null,
  behaviorId = null,
  definitionId = null,
  orderKey = null,
  sourceObjectId,
  targetObjectId,
  actorId = null,
  commandId = null,
  effectiveFrom = null,
  effectiveTo = null,
  metadata = {}
}) {
  const objects = readObjects();
  const sourceObject = requireObject(objects, sourceObjectId, "Source");
  const targetObject = requireObject(objects, targetObjectId, "Target");
  assertSameEntity(sourceObject, targetObject);

  const technicalBehavior = cleanText(behaviorId)
    ? getEdgeBehavior(behaviorId)
    : null;
  const labelValue = cleanText(relationshipLabel || relationshipType);
  const normalizedType = labelValue
    ? normalizeRelationshipType(labelValue)
    : { displayName: null, key: null };

  if (!technicalBehavior && !normalizedType.displayName) {
    throw new MosError(
      "RELATIONSHIP_CONTRACT_REQUIRED",
      "A technical behavior ID or customer relationship label is required.",
      null,
      400
    );
  }

  if (technicalBehavior && !cleanText(commandId)) {
    throw new MosError(
      "TECHNICAL_EDGE_COMMAND_REQUIRED",
      "Technical edge creation requires an idempotent command ID.",
      { behaviorId: technicalBehavior.behaviorId },
      428
    );
  }
  if (technicalBehavior && !cleanText(actorId)) {
    throw new MosError(
      "TECHNICAL_EDGE_ACTOR_REQUIRED",
      "Technical edge creation requires authenticated actor evidence.",
      { behaviorId: technicalBehavior.behaviorId },
      401
    );
  }

  const relationshipsBefore = readRelationships();
  const existing = Object.values(relationshipsBefore).find(relationship =>
    relationship.status === "active" &&
    relationship.entityId === sourceObject.entityId &&
    relationship.sourceObjectId === sourceObject.objectId &&
    relationship.targetObjectId === targetObject.objectId &&
    (technicalBehavior
      ? relationship.behaviorId === technicalBehavior.behaviorId &&
        cleanText(relationship.definitionId) === cleanText(definitionId)
      : storedRelationshipKey(relationship) === normalizedType.key)
  );

  if (existing) {
    return {
      changed: false,
      replayed: true,
      relationship: existing,
      sourceObject,
      targetObject
    };
  }

  if (technicalBehavior?.cyclePolicy === "acyclic-structural") {
    if (sourceObject.objectId === targetObject.objectId) {
      throw new MosError(
        "STRUCTURAL_EDGE_SELF_REFERENCE",
        "A structural edge cannot project an Object into itself.",
        { objectId: sourceObject.objectId, behaviorId: technicalBehavior.behaviorId },
        409
      );
    }

    const outgoing = new Map();
    Object.values(relationshipsBefore)
      .filter(relationship =>
        relationship.status === "active" &&
        relationship.entityId === sourceObject.entityId &&
        relationship.behaviorId === technicalBehavior.behaviorId
      )
      .forEach(relationship => {
        const entries = outgoing.get(relationship.sourceObjectId) || [];
        entries.push(relationship.targetObjectId);
        outgoing.set(relationship.sourceObjectId, entries);
      });

    const queue = [targetObject.objectId];
    const visited = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (current === sourceObject.objectId) {
        throw new MosError(
          "STRUCTURAL_EDGE_CYCLE",
          "The requested structural edge would create a projection cycle.",
          {
            sourceObjectId: sourceObject.objectId,
            targetObjectId: targetObject.objectId,
            behaviorId: technicalBehavior.behaviorId
          },
          409
        );
      }
      if (visited.has(current)) continue;
      visited.add(current);
      queue.push(...(outgoing.get(current) || []));
    }
  }

  const relationship = createRelationshipRecord({
    entityId: sourceObject.entityId,
    relationshipType: normalizedType.displayName,
    behaviorId: technicalBehavior?.behaviorId || null,
    definitionId,
    orderKey,
    sourceObjectId: sourceObject.objectId,
    targetObjectId: targetObject.objectId,
    actorId,
    commandId,
    effectiveFrom,
    effectiveTo,
    metadata
  });
  const relationshipsNext = {
    ...relationshipsBefore,
    [relationship.relationshipId]: relationship
  };

  writeRelationships(relationshipsNext);
  let event;
  try {
    event = appendEvent({
      entityId: sourceObject.entityId,
      eventType: "relationship.created",
      objectId: sourceObject.objectId,
      actorId,
      commandId,
      payload: {
        relationshipId: relationship.relationshipId,
        relationshipType: relationship.relationshipType,
        relationshipKey: relationship.relationshipKey,
        behaviorId: relationship.behaviorId,
        definitionId: relationship.definitionId,
        orderKey: relationship.orderKey,
        sourceObjectId: sourceObject.objectId,
        targetObjectId: targetObject.objectId,
        effectiveFrom: relationship.effectiveFrom,
        effectiveTo: relationship.effectiveTo,
        metadata: relationship.metadata
      }
    });
  } catch (error) {
    writeRelationships(relationshipsBefore);
    throw error;
  }

  return {
    changed: true,
    replayed: false,
    relationship,
    sourceObject,
    targetObject,
    event
  };
}

function endObjectRelationship({
  relationshipId,
  expectedRevision,
  actorId = null,
  commandId = null,
  reason = null,
  effectiveTo = null,
  metadata = {}
}) {
  const relationshipsBefore = readRelationships();
  const current = relationshipsBefore[cleanText(relationshipId)];
  if (!current) {
    getRelationship(relationshipId);
  }

  if (current.status === "ended") {
    return { changed: false, replayed: true, relationship: current };
  }

  const currentRevision = Number.isInteger(Number(current.revision))
    ? Number(current.revision)
    : 0;
  if (!Number.isInteger(Number(expectedRevision)) ||
      Number(expectedRevision) !== currentRevision) {
    throw new MosError(
      "RELATIONSHIP_REVISION_CONFLICT",
      "The relationship changed before this command was applied.",
      { relationshipId: current.relationshipId, expectedRevision, currentRevision },
      409
    );
  }

  const timestamp = nowIso();
  const relationship = {
    ...current,
    status: "ended",
    revision: currentRevision + 1,
    updatedBy: cleanText(actorId) || null,
    commandId: cleanText(commandId) || null,
    effectiveTo: cleanText(effectiveTo) || timestamp,
    endedAt: timestamp,
    updatedAt: timestamp,
    metadata: {
      ...normalizeMetadata(current.metadata),
      ...normalizeMetadata(metadata),
      ...(cleanText(reason) ? { endReason: cleanText(reason) } : {})
    }
  };
  const relationshipsNext = {
    ...relationshipsBefore,
    [relationship.relationshipId]: relationship
  };

  writeRelationships(relationshipsNext);
  let event;
  try {
    event = appendEvent({
      entityId: relationship.entityId,
      eventType: "relationship.ended",
      objectId: relationship.sourceObjectId,
      actorId,
      commandId,
      payload: {
        relationshipId: relationship.relationshipId,
        relationshipType: relationship.relationshipType,
        behaviorId: relationship.behaviorId || null,
        definitionId: relationship.definitionId || null,
        sourceObjectId: relationship.sourceObjectId,
        targetObjectId: relationship.targetObjectId,
        effectiveTo: relationship.effectiveTo,
        reason: cleanText(reason) || null,
        metadata: normalizeMetadata(metadata)
      }
    });
  } catch (error) {
    writeRelationships(relationshipsBefore);
    throw error;
  }

  return { changed: true, replayed: false, relationship, event };
}

function updateObjectRelationshipOrder({
  relationshipId,
  expectedRevision,
  orderKey,
  actorId,
  commandId
}) {
  const relationshipsBefore = readRelationships();
  const current = relationshipsBefore[cleanText(relationshipId)];
  if (!current) getRelationship(relationshipId);

  if (current.status !== "active") {
    throw new MosError(
      "RELATIONSHIP_NOT_ACTIVE",
      "Only an active relationship can be reordered.",
      { relationshipId: current.relationshipId, status: current.status },
      409
    );
  }

  const behavior = current.behaviorId ? getEdgeBehavior(current.behaviorId) : null;
  if (behavior?.orderingPolicy !== "explicit") {
    throw new MosError(
      "RELATIONSHIP_ORDERING_NOT_SUPPORTED",
      "This technical edge behavior does not support explicit ordering.",
      { relationshipId: current.relationshipId, behaviorId: current.behaviorId || null },
      409
    );
  }

  const nextOrderKey = cleanText(orderKey);
  if (!nextOrderKey) {
    throw new MosError(
      "RELATIONSHIP_ORDER_KEY_REQUIRED",
      "Relationship reordering requires a stable orderKey.",
      { relationshipId: current.relationshipId },
      400
    );
  }
  if (!cleanText(actorId) || !cleanText(commandId)) {
    throw new MosError(
      "RELATIONSHIP_ORDER_EVIDENCE_REQUIRED",
      "Relationship reordering requires actor and command evidence.",
      { relationshipId: current.relationshipId },
      401
    );
  }

  const currentRevision = Number(current.revision || 0);
  if (!Number.isInteger(Number(expectedRevision)) || Number(expectedRevision) !== currentRevision) {
    throw new MosError(
      "RELATIONSHIP_REVISION_CONFLICT",
      "The relationship changed before this reorder command was applied.",
      { relationshipId: current.relationshipId, expectedRevision, currentRevision },
      409
    );
  }

  if (cleanText(current.orderKey) === nextOrderKey) {
    return { changed: false, replayed: true, relationship: current };
  }

  const timestamp = nowIso();
  const relationship = {
    ...current,
    orderKey: nextOrderKey,
    revision: currentRevision + 1,
    updatedBy: cleanText(actorId),
    commandId: cleanText(commandId),
    updatedAt: timestamp
  };
  writeRelationships({
    ...relationshipsBefore,
    [relationship.relationshipId]: relationship
  });

  let event;
  try {
    event = appendEvent({
      entityId: relationship.entityId,
      eventType: "relationship.reordered",
      objectId: relationship.sourceObjectId,
      actorId,
      commandId,
      payload: {
        relationshipId: relationship.relationshipId,
        behaviorId: relationship.behaviorId,
        previousOrderKey: current.orderKey || null,
        orderKey: nextOrderKey,
        revision: relationship.revision
      }
    });
  } catch (error) {
    writeRelationships(relationshipsBefore);
    throw error;
  }

  return { changed: true, replayed: false, relationship, event };
}

function listRelatedObjects({
  objectId,
  entityId = null,
  relationshipType = null,
  behaviorId = null,
  definitionId = null,
  direction = "both",
  status = "active"
}) {
  const objects = readObjects();
  const object = requireObject(objects, objectId, "Root");
  if (entityId && object.entityId !== entityId) {
    throw new MosError(
      "RELATIONSHIP_ENTITY_MISMATCH",
      "The requested Object does not belong to the requested Entity.",
      { objectId: object.objectId, requestedEntityId: entityId, objectEntityId: object.entityId },
      403
    );
  }

  return listRelationships({
    entityId: object.entityId,
    relationshipType,
    behaviorId,
    definitionId,
    objectId: object.objectId,
    direction,
    status
  }).map(relationship => {
    const outgoing = relationship.sourceObjectId === object.objectId;
    const relatedObjectId = outgoing
      ? relationship.targetObjectId
      : relationship.sourceObjectId;
    return {
      relationship,
      direction: outgoing ? "outgoing" : "incoming",
      relatedObject: objects[relatedObjectId] || null
    };
  });
}

function traverseRelationships({
  objectId,
  relationshipTypes = [],
  behaviorIds = [],
  direction = "both",
  maxDepth = 4,
  maxObjects = 500,
  status = "active"
}) {
  const objects = readObjects();
  const rootObject = requireObject(objects, objectId, "Root");
  const depthLimit = Math.min(Math.max(Number(maxDepth) || 1, 1), 12);
  const objectLimit = Math.min(Math.max(Number(maxObjects) || 1, 1), 5000);
  const allowedKeys = new Set(
    (Array.isArray(relationshipTypes) ? relationshipTypes : [relationshipTypes])
      .map(normalizeKey)
      .filter(Boolean)
  );
  const allowedBehaviorIds = new Set(
    (Array.isArray(behaviorIds) ? behaviorIds : [behaviorIds])
      .map(cleanText)
      .filter(Boolean)
  );
  const requestedDirection = cleanText(direction).toLowerCase();
  const resolvedDirection = ["incoming", "outgoing", "both"].includes(requestedDirection)
    ? requestedDirection
    : "both";
  const relationships = Object.values(readRelationships()).filter(relationship =>
    relationship.entityId === rootObject.entityId &&
    (!status || relationship.status === status) &&
    (allowedKeys.size === 0 || allowedKeys.has(storedRelationshipKey(relationship))) &&
    (allowedBehaviorIds.size === 0 || allowedBehaviorIds.has(cleanText(relationship.behaviorId)))
  );

  const visited = new Set([rootObject.objectId]);
  const queue = [{ objectId: rootObject.objectId, depth: 0 }];
  const discoveredObjects = [];
  const discoveredRelationships = [];
  const relationshipIds = new Set();

  while (queue.length && discoveredObjects.length < objectLimit) {
    const current = queue.shift();
    if (current.depth >= depthLimit) continue;

    relationships.forEach(relationship => {
      const outgoing = relationship.sourceObjectId === current.objectId;
      const incoming = relationship.targetObjectId === current.objectId;
      const included = resolvedDirection === "outgoing"
        ? outgoing
        : resolvedDirection === "incoming"
          ? incoming
          : outgoing || incoming;
      if (!included) return;

      if (!relationshipIds.has(relationship.relationshipId)) {
        relationshipIds.add(relationship.relationshipId);
        discoveredRelationships.push(relationship);
      }

      const relatedObjectId = outgoing
        ? relationship.targetObjectId
        : relationship.sourceObjectId;
      if (visited.has(relatedObjectId) || discoveredObjects.length >= objectLimit) return;

      const relatedObject = objects[relatedObjectId];
      if (!relatedObject) return;
      visited.add(relatedObjectId);
      discoveredObjects.push({
        object: relatedObject,
        depth: current.depth + 1,
        viaRelationshipId: relationship.relationshipId,
        fromObjectId: current.objectId
      });
      queue.push({ objectId: relatedObjectId, depth: current.depth + 1 });
    });
  }

  return {
    rootObject,
    maxDepth: depthLimit,
    maxObjects: objectLimit,
    truncated: discoveredObjects.length >= objectLimit,
    objects: discoveredObjects,
    relationships: discoveredRelationships
  };
}

/* Legacy exclusive containment remains available for backward compatibility only. */
function getActiveContainmentForObject(objectId) {
  const matches = listRelationships({
    relationshipType: MOS_RELATIONSHIP_TYPES.CONTAINED_IN,
    sourceObjectId: objectId,
    status: "active"
  });
  if (matches.length > 1) {
    throw new MosError(
      "MULTIPLE_ACTIVE_CONTAINERS",
      `Object has more than one active physical container: ${objectId}`,
      { objectId, relationshipIds: matches.map(item => item.relationshipId) },
      409
    );
  }
  return matches[0] || null;
}

function getDirectChildren(containerId) {
  return listRelationships({
    relationshipType: MOS_RELATIONSHIP_TYPES.CONTAINED_IN,
    targetObjectId: containerId,
    status: "active"
  });
}

module.exports = {
  readRelationships,
  writeRelationships,
  createRelationshipRecord,
  createObjectRelationship,
  endObjectRelationship,
  updateObjectRelationshipOrder,
  getRelationship,
  listRelationships,
  listRelatedObjects,
  traverseRelationships,
  getActiveContainmentForObject,
  getDirectChildren
};
