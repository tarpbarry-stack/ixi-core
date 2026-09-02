const {
  readJsonFile,
  writeJsonFileAtomic
} = require("../storage/jsonStore");

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  cleanText,
  nowIso
} = require("../util/normalize");

const {
  MosError
} = require("../errors/MosError");

function readIdempotencyStore() {
  return readJsonFile(
    MOS_PATHS.idempotency,
    {}
  );
}

function getCommandRecord(commandId) {
  const normalizedCommandId =
    cleanText(commandId);

  if (!normalizedCommandId) {
    return null;
  }

  const store =
    readIdempotencyStore();

  return (
    store[normalizedCommandId] ||
    null
  );
}

function beginCommand({
  commandId,
  entityId,
  commandType,
  payloadHash = null
}) {
  const normalizedCommandId =
    cleanText(commandId);

  if (!normalizedCommandId) {
    throw new MosError(
      "COMMAND_ID_REQUIRED",
      "commandId is required.",
      null,
      400
    );
  }

  const store =
    readIdempotencyStore();

  const existing =
    store[normalizedCommandId];

  if (existing) {
    return {
      duplicate: true,
      record: existing
    };
  }

  const timestamp = nowIso();

  const record = {
    commandId:
      normalizedCommandId,
    entityId:
      cleanText(entityId),
    commandType:
      cleanText(commandType),
    payloadHash:
      cleanText(payloadHash) ||
      null,

    status: "processing",

    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,

    result: null,
    error: null
  };

  store[normalizedCommandId] =
    record;

  writeJsonFileAtomic(
    MOS_PATHS.idempotency,
    store
  );

  return {
    duplicate: false,
    record
  };
}

function completeCommand({
  commandId,
  result
}) {
  const store =
    readIdempotencyStore();

  const record =
    store[commandId];

  if (!record) {
    throw new MosError(
      "COMMAND_NOT_FOUND",
      `Command not found: ${commandId}`,
      { commandId },
      404
    );
  }

  const timestamp = nowIso();

  store[commandId] = {
    ...record,
    status: "completed",
    updatedAt: timestamp,
    completedAt: timestamp,
    result,
    error: null
  };

  writeJsonFileAtomic(
    MOS_PATHS.idempotency,
    store
  );

  return store[commandId];
}

function failCommand({
  commandId,
  error
}) {
  const store =
    readIdempotencyStore();

  const record =
    store[commandId];

  if (!record) {
    return null;
  }

  store[commandId] = {
    ...record,
    status: "failed",
    updatedAt: nowIso(),
    error: {
      code:
        error?.code || null,
      message:
        error?.message ||
        String(error)
    }
  };

  writeJsonFileAtomic(
    MOS_PATHS.idempotency,
    store
  );

  return store[commandId];
}

module.exports = {
  getCommandRecord,
  beginCommand,
  completeCommand,
  failCommand
};
