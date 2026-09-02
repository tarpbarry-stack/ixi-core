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
  cleanText,
  nowIso
} = require("../util/normalize");

function appendEvent({
  entityId,
  eventType,
  objectId = null,
  actorId = null,
  commandId = null,
  payload = {}
}) {
  const events = readJsonFile(
    MOS_PATHS.events,
    []
  );

  const event = {
    eventId: createMosId("event"),
    entityId: cleanText(entityId),
    eventType: cleanText(eventType),
    objectId: cleanText(objectId) || null,
    actorId: cleanText(actorId) || null,
    commandId: cleanText(commandId) || null,
    occurredAt: nowIso(),
    payload
  };

  events.push(event);

  writeJsonFileAtomic(
    MOS_PATHS.events,
    events
  );

  return event;
}

function listEvents({
  entityId,
  objectId = null,
  eventType = null
}) {
  const events = readJsonFile(
    MOS_PATHS.events,
    []
  );

  return events.filter(event => {
    if (
      entityId &&
      event.entityId !== entityId
    ) {
      return false;
    }

    if (
      objectId &&
      event.objectId !== objectId
    ) {
      return false;
    }

    if (
      eventType &&
      event.eventType !== eventType
    ) {
      return false;
    }

    return true;
  });
}

module.exports = {
  appendEvent,
  listEvents
};
