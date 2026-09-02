const {
  readJsonFile,
  writeJsonFileAtomic
} = require("../storage/jsonStore");

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  MOS_RELATIONSHIP_TYPES
} = require("../constants");

const {
  createMosId
} = require("../objects/objectIdEngine");

const {
  cleanText,
  nowIso
} = require("../util/normalize");

const {
  MosError
} = require("../errors/MosError");

function readRelationships() {
  return readJsonFile(
    MOS_PATHS.relationships,
    {}
  );
}

function writeRelationships(relationships) {
  writeJsonFileAtomic(
    MOS_PATHS.relationships,
    relationships
  );

  return relationships;
}

function createRelationshipRecord({
  entityId,
  relationshipType,
  sourceObjectId,
  targetObjectId,
  actorId = null,
  metadata = {}
}) {
  const relationshipId =
    createMosId("relationship");

  const timestamp = nowIso();

  return {
    relationshipId,
    entityId: cleanText(entityId),
    relationshipType:
      cleanText(relationshipType),

    sourceObjectId:
      cleanText(sourceObjectId),

    targetObjectId:
      cleanText(targetObjectId),

    status: "active",

    actorId: cleanText(actorId) || null,

    metadata:
      metadata &&
      typeof metadata === "object"
        ? metadata
        : {},

    createdAt: timestamp,
    updatedAt: timestamp,
    endedAt: null
  };
}

function listRelationships({
  entityId = null,
  relationshipType = null,
  sourceObjectId = null,
  targetObjectId = null,
  status = "active"
} = {}) {
  const relationships =
    readRelationships();

  return Object.values(relationships).filter(
    relationship => {
      if (
        entityId &&
        relationship.entityId !== entityId
      ) {
        return false;
      }

      if (
        relationshipType &&
        relationship.relationshipType !==
          relationshipType
      ) {
        return false;
      }

      if (
        sourceObjectId &&
        relationship.sourceObjectId !==
          sourceObjectId
      ) {
        return false;
      }

      if (
        targetObjectId &&
        relationship.targetObjectId !==
          targetObjectId
      ) {
        return false;
      }

      if (
        status &&
        relationship.status !== status
      ) {
        return false;
      }

      return true;
    }
  );
}

function getActiveContainmentForObject(
  objectId
) {
  const matches = listRelationships({
    relationshipType:
      MOS_RELATIONSHIP_TYPES.CONTAINED_IN,
    sourceObjectId: objectId,
    status: "active"
  });

  if (matches.length > 1) {
    throw new MosError(
      "MULTIPLE_ACTIVE_CONTAINERS",
      `Object has more than one active physical container: ${objectId}`,
      {
        objectId,
        relationshipIds: matches.map(
          relationship =>
            relationship.relationshipId
        )
      },
      409
    );
  }

  return matches[0] || null;
}

function getDirectChildren(containerId) {
  return listRelationships({
    relationshipType:
      MOS_RELATIONSHIP_TYPES.CONTAINED_IN,
    targetObjectId: containerId,
    status: "active"
  });
}

module.exports = {
  readRelationships,
  writeRelationships,
  createRelationshipRecord,
  listRelationships,
  getActiveContainmentForObject,
  getDirectChildren
};
