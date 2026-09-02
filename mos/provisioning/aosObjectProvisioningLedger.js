"use strict";

const {
  beginCommand,
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
  payloadHash
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
