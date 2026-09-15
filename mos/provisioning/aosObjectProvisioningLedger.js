"use strict";

const {
  beginCommand,
  getCommandRecord,
  completeCommand,
  failCommand
} = require(
  "../commands/idempotencyService"
);

const {
  cleanText
} = require("../util/normalize");

const {
  MosError
} = require("../errors/MosError");

const {
  PROVISIONING_COMMAND_TYPE
} = require(
  "./aosObjectProvisioningValidator"
);


function beginProvisioning({
  commandId,
  entityId,
  payloadHash,
  resumeInterrupted = false
}) {
  const result =
    beginCommand({
      commandId,
      entityId,
      commandType:
        PROVISIONING_COMMAND_TYPE,
      payloadHash
    });

  if (!result.duplicate) {
    return {
      replayed: false,
      record:
        result.record,
      result: null
    };
  }

  const existing =
    result.record;

  if (
    cleanText(
      existing.entityId
    ) !==
    cleanText(entityId) ||
    cleanText(
      existing.commandType
    ) !==
    PROVISIONING_COMMAND_TYPE
  ) {
    throw new MosError(
      "AOS_PROVISION_COMMAND_COLLISION",
      "The provisioning commandId is already owned by another command.",
      {
        commandId
      },
      409
    );
  }

  if (
    cleanText(
      existing.payloadHash
    ) &&
    cleanText(
      existing.payloadHash
    ) !==
    cleanText(payloadHash)
  ) {
    throw new MosError(
      "AOS_PROVISION_PAYLOAD_CONFLICT",
      "The same provisioning commandId cannot be reused with a different payload.",
      {
        commandId
      },
      409
    );
  }

  if (
    existing.status ===
      "completed" &&
    existing.result
  ) {
    return {
      replayed: true,
      record:
        existing,
      result:
        existing.result
    };
  }

  // Only the creation coordinator may resume under its durable lease. It has
  // already established that no Object exists for this identity command.
  if (resumeInterrupted && ["failed", "processing"].includes(existing.status)) {
    return { replayed: false, record: existing, result: null };
  }

  if (
    existing.status ===
      "processing"
  ) {
    throw new MosError(
      "AOS_PROVISION_ALREADY_PROCESSING",
      "This provisioning command is already processing.",
      {
        commandId
      },
      409
    );
  }

  /*
   * Failed commands retain their command ID.
   * We fail closed rather than silently
   * creating another object. Recovery will
   * become an explicit operation.
   */
  throw new MosError(
    "AOS_PROVISION_PREVIOUSLY_FAILED",
    "This provisioning command previously failed and requires explicit recovery.",
    {
      commandId,
      error:
        existing.error ||
        null
    },
    409
  );
}


function completeProvisioning({
  commandId,
  result
}) {
  return completeCommand({
    commandId,
    result
  });
}


function failProvisioning({
  commandId,
  error
}) {
  const current = getCommandRecord(commandId);
  if (current?.status === "completed") return current;
  return failCommand({
    commandId,
    error
  });
}


module.exports = {
  beginProvisioning,
  completeProvisioning,
  failProvisioning
};
