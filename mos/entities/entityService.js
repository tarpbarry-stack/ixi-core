const {
  readJsonFile,
  writeJsonFileAtomic
} = require("../storage/jsonStore");

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  createMosId
} = require("../objects/objectIdEngine");

const {
  MosError
} = require("../errors/MosError");

const {
  cleanText,
  normalizeKey,
  nowIso
} = require("../util/normalize");

const {
  appendEvent
} = require("../events/eventService");

function createEntity({
  displayName,
  sharetribeUserId = null,
  actorId = null,
  metadata = {}
}) {
  const name = cleanText(displayName);

  if (!name) {
    throw new MosError(
      "ENTITY_NAME_REQUIRED",
      "Entity displayName is required."
    );
  }

  const entities = readJsonFile(
    MOS_PATHS.entities,
    {}
  );

  const entityId = createMosId("entity");
  const timestamp = nowIso();

  const entity = {
    entityId,
    displayName: name,
    normalizedName: normalizeKey(name),
    sharetribeUserId:
      cleanText(sharetribeUserId) || null,

    status: "active",

    metadata,

    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    softDeletedAt: null
  };

  entities[entityId] = entity;

  writeJsonFileAtomic(
    MOS_PATHS.entities,
    entities
  );

  appendEvent({
    entityId,
    eventType: "entity.created",
    actorId,
    payload: {
      displayName: name
    }
  });

  return entity;
}

function getEntity(entityId) {
  const entities = readJsonFile(
    MOS_PATHS.entities,
    {}
  );

  const entity = entities[entityId];

  if (!entity) {
    throw new MosError(
      "ENTITY_NOT_FOUND",
      `Entity not found: ${entityId}`,
      { entityId },
      404
    );
  }

  return entity;
}

function listEntities() {
  const entities = readJsonFile(
    MOS_PATHS.entities,
    {}
  );

  return Object.values(entities);
}

module.exports = {
  createEntity,
  getEntity,
  listEntities
};
