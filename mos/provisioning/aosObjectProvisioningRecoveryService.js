"use strict";

const {
  getObject,
  updateObject
} = require(
  "../objects/objectService"
);

const {
  getCommandRecord,
  completeCommand
} = require(
  "../commands/idempotencyService"
);

const {
  cleanText
} = require(
  "../util/normalize"
);

const {
  MosError
} = require(
  "../errors/MosError"
);

const {
  AOS_PASSPORT_IDENTITY_TYPE,
  ensurePassportForAosObject,
  verifyAosObjectPassport
} = require(
  "./aosObjectPassportService"
);

const {
  mergePassportIdentity,
  getObjectPassportIdentity
} = require(
  "./aosObjectProvisioningService"
);

const {
  PROVISIONING_COMMAND_TYPE
} = require(
  "./aosObjectProvisioningValidator"
);


function safeObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}


function findProvisioningObject({
  entityId,
  commandId
}) {
  const {
    listObjects
  } = require(
    "../objects/objectService"
  );

  const objects =
    listObjects({
      entityId
    });

  const matches =
    objects.filter(
      object =>
        cleanText(
          object?.metadata
            ?.provisioning
            ?.commandId
        ) ===
        cleanText(commandId)
    );

  if (matches.length > 1) {
    throw new MosError(
      "AOS_PROVISION_RECOVERY_MULTIPLE_OBJECTS",
      "More than one AOS Object claims the same provisioning commandId.",
      {
        commandId,
        objectIds:
          matches.map(
            object =>
              object.objectId
          )
      },
      500
    );
  }

  return matches[0] || null;
}


function recoverAosObjectProvisioning({
  commandId,
  entityId,
  actorId = null
}) {
  const normalizedCommandId =
    cleanText(commandId);

  const normalizedEntityId =
    cleanText(entityId);

  if (!normalizedCommandId) {
    throw new MosError(
      "AOS_PROVISION_RECOVERY_COMMAND_REQUIRED",
      "commandId is required.",
      null,
      400
    );
  }

  if (!normalizedEntityId) {
    throw new MosError(
      "AOS_PROVISION_RECOVERY_ENTITY_REQUIRED",
      "entityId is required.",
      null,
      400
    );
  }

  const command =
    getCommandRecord(
      normalizedCommandId
    );

  if (!command) {
    throw new MosError(
      "AOS_PROVISION_RECOVERY_COMMAND_NOT_FOUND",
      "Provisioning command was not found.",
      {
        commandId:
          normalizedCommandId
      },
      404
    );
  }

  if (
    cleanText(
      command.entityId
    ) !==
    normalizedEntityId
  ) {
    throw new MosError(
      "AOS_PROVISION_RECOVERY_ENTITY_MISMATCH",
      "Provisioning command does not belong to this entity.",
      {
        commandId:
          normalizedCommandId
      },
      403
    );
  }

  if (
    cleanText(
      command.commandType
    ) !==
    PROVISIONING_COMMAND_TYPE
  ) {
    throw new MosError(
      "AOS_PROVISION_RECOVERY_COMMAND_TYPE_INVALID",
      "Command is not an AOS Object provisioning command.",
      {
        commandId:
          normalizedCommandId
      },
      409
    );
  }

  if (
    command.status ===
      "completed" &&
    command.result
  ) {
    return {
      ...command.result,
      recovered: false,
      replayed: true
    };
  }

  const object =
    findProvisioningObject({
      entityId:
        normalizedEntityId,

      commandId:
        normalizedCommandId
    });

  if (!object) {
    throw new MosError(
      "AOS_PROVISION_RECOVERY_OBJECT_NOT_FOUND",
      "No existing AOS Object was found for this provisioning command. Recovery will not create a replacement object.",
      {
        commandId:
          normalizedCommandId
      },
      409
    );
  }

  /*
   * If Passport identity was already
   * persisted before the failure, verify it
   * first instead of generating another.
   */
  let persistedIdentity =
    getObjectPassportIdentity(
      object
    );

  let passport;
  let passportCreated = false;

  if (
    persistedIdentity
      ?.passportId
  ) {
    passport =
      verifyAosObjectPassport({
        objectId:
          object.objectId,

        passportId:
          persistedIdentity.passportId
      });
  } else {
    const passportResult =
      ensurePassportForAosObject({
        objectId:
          object.objectId
      });

    passport =
      passportResult.passport;

    passportCreated =
      passportResult.created ===
      true;

    const identities =
      mergePassportIdentity(
        object.identities,
        passportResult.identity
      );

    updateObject({
      objectId:
        object.objectId,

      identities,

      actorId:
        cleanText(actorId) ||
        null,

      metadata: {
        ...safeObject(
          object.metadata
        ),

        provisioning: {
          ...safeObject(
            object.metadata
              ?.provisioning
          ),

          commandId:
            normalizedCommandId,

          state:
            "complete",

          passportProvisioned:
            true,

          passportId:
            passport.passportId,

          recovered:
            true
        }
      }
    });

    passport =
      verifyAosObjectPassport({
        objectId:
          object.objectId,

        passportId:
          passport.passportId
      });
  }

  const finalObject =
    getObject(
      object.objectId
    );

  persistedIdentity =
    getObjectPassportIdentity(
      finalObject
    );

  if (
    !persistedIdentity ||
    persistedIdentity.passportId !==
      passport.passportId ||
    persistedIdentity.identityType !==
      AOS_PASSPORT_IDENTITY_TYPE
  ) {
    throw new MosError(
      "AOS_PROVISION_RECOVERY_VERIFY_FAILED",
      "Recovered AOS Object does not contain the verified Passport identity.",
      {
        objectId:
          object.objectId,

        passportId:
          passport.passportId
      },
      500
    );
  }

  const result = {
    ok: true,

    contractVersion:
      "ixi-aos-object-provision-v1",

    commandId:
      normalizedCommandId,

    replayed: false,
    recovered: true,

    object:
      finalObject,

    passport,

    identity: {
      objectId:
        finalObject.objectId,

      passportId:
        passport.passportId
    },

    transact: {
      eligible: true,

      objectId:
        finalObject.objectId,

      passportId:
        passport.passportId
    },

    provisioning: {
      state:
        "complete",

      objectCreated:
        true,

      passportCreated,

      passportLinked:
        true,

      verified:
        true,

      recovered:
        true
    }
  };

  completeCommand({
    commandId:
      normalizedCommandId,

    result
  });

  return result;
}


module.exports = {
  findProvisioningObject,
  recoverAosObjectProvisioning
};
