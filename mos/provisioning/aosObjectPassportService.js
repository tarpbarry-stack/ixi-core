"use strict";

const {
  ensurePassportForSource,
  findPassportById,
  findPassportBySource
} = require(
  "../../passport/passportRegistry"
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


const AOS_PASSPORT_SOURCE_TYPE =
  "aos-object";

const AOS_PASSPORT_IDENTITY_TYPE =
  "ixi-passport";


function requireText(
  value,
  code,
  message
) {
  const normalized =
    cleanText(value);

  if (!normalized) {
    throw new MosError(
      code,
      message,
      null,
      400
    );
  }

  return normalized;
}


function assertPassportEntity({
  passport,
  entityId,
  objectId
}) {
  const expectedEntityId =
    requireText(
      entityId,
      "AOS_PASSPORT_ENTITY_REQUIRED",
      "AOS Passport provisioning requires entityId."
    );

  const actualEntityId =
    cleanText(
      passport?.entityId
    );

  /*
   * Historical AOS Passports may predate
   * persisted Passport tenant identity.
   *
   * We do not mutate them here.
   *
   * New births MUST carry entityId.
   */
  if (
    actualEntityId &&
    actualEntityId !==
      expectedEntityId
  ) {
    throw new MosError(
      "AOS_PASSPORT_ENTITY_MISMATCH",
      "AOS Passport belongs to a different Entity.",
      {
        objectId:
          cleanText(objectId),

        passportId:
          cleanText(
            passport?.passportId
          ),

        expectedEntityId,

        actualEntityId
      },
      409
    );
  }

  return passport;
}


function createPassportIdentity(
  passport,
  {
    objectId,
    entityId
  }
) {
  const passportId =
    cleanText(
      passport?.passportId
    );

  if (!passportId) {
    throw new MosError(
      "AOS_PASSPORT_ID_REQUIRED",
      "Passport service returned no passportId.",
      {
        objectId:
          cleanText(objectId)
      },
      500
    );
  }

  return {
    identityType:
      "ixi-passport",

    passportId,

    entityId:
      cleanText(entityId),

    sourceType:
      AOS_PASSPORT_SOURCE_TYPE,

    sourceId:
      cleanText(objectId)
  };
}


function ensurePassportForAosObject({
  objectId,
  entityId
}) {
  const normalizedObjectId =
    requireText(
      objectId,
      "AOS_PASSPORT_OBJECT_REQUIRED",
      "AOS Passport provisioning requires objectId."
    );

  const normalizedEntityId =
    requireText(
      entityId,
      "AOS_PASSPORT_ENTITY_REQUIRED",
      "AOS Passport provisioning requires entityId."
    );

  const existing =
    findPassportBySource(
      AOS_PASSPORT_SOURCE_TYPE,
      normalizedObjectId
    );

  if (existing) {
    assertPassportEntity({
      passport:
        existing,

      entityId:
        normalizedEntityId,

      objectId:
        normalizedObjectId
    });

    return {
      ok: true,
      created: false,
      passport:
        existing,

      identity:
        createPassportIdentity(
          existing,
          {
            objectId:
              normalizedObjectId,

            entityId:
              normalizedEntityId
          }
        )
    };
  }

  const result =
    ensurePassportForSource({
      sourceType:
        AOS_PASSPORT_SOURCE_TYPE,

      sourceId:
        normalizedObjectId,

      entityId:
        normalizedEntityId,

      visibility:
        "private",

      status:
        "active"
    });

  const passport =
    result?.passport;

  if (
    !passport?.passportId
  ) {
    throw new MosError(
      "AOS_PASSPORT_CREATE_FAILED",
      "AOS Passport could not be created.",
      {
        objectId:
          normalizedObjectId,

        entityId:
          normalizedEntityId
      },
      500
    );
  }

  /*
   * New Passport creation MUST persist
   * the authenticated Object tenant.
   */
  if (
    cleanText(
      passport.entityId
    ) !==
      normalizedEntityId
  ) {
    throw new MosError(
      "AOS_PASSPORT_ENTITY_PERSISTENCE_FAILED",
      "New AOS Passport did not persist the Object Entity identity.",
      {
        objectId:
          normalizedObjectId,

        passportId:
          passport.passportId,

        expectedEntityId:
          normalizedEntityId,

        actualEntityId:
          cleanText(
            passport.entityId
          ) || null
      },
      500
    );
  }

  return {
    ...result,

    identity:
      createPassportIdentity(
        passport,
        {
          objectId:
            normalizedObjectId,

          entityId:
            normalizedEntityId
        }
      )
  };
}


function verifyAosObjectPassport({
  objectId,
  passportId,
  entityId
}) {
  const normalizedObjectId =
    requireText(
      objectId,
      "AOS_PASSPORT_OBJECT_REQUIRED",
      "AOS Passport verification requires objectId."
    );

  const normalizedPassportId =
    requireText(
      passportId,
      "AOS_PASSPORT_ID_REQUIRED",
      "AOS Passport verification requires passportId."
    );

  const normalizedEntityId =
    requireText(
      entityId,
      "AOS_PASSPORT_ENTITY_REQUIRED",
      "AOS Passport verification requires entityId."
    );

  const bySource =
    findPassportBySource(
      AOS_PASSPORT_SOURCE_TYPE,
      normalizedObjectId
    );

  const byId =
    findPassportById(
      normalizedPassportId
    );

  if (
    !bySource ||
    !byId ||
    bySource.passportId !==
      normalizedPassportId ||
    byId.passportId !==
      normalizedPassportId ||
    byId.sourceType !==
      AOS_PASSPORT_SOURCE_TYPE ||
    cleanText(
      byId.sourceId
    ) !==
      normalizedObjectId
  ) {
    throw new MosError(
      "AOS_PASSPORT_VERIFY_FAILED",
      "AOS Passport identity does not resolve consistently.",
      {
        objectId:
          normalizedObjectId,

        passportId:
          normalizedPassportId
      },
      500
    );
  }

  assertPassportEntity({
    passport:
      byId,

    entityId:
      normalizedEntityId,

    objectId:
      normalizedObjectId
  });

  return byId;
}


module.exports = {
  AOS_PASSPORT_SOURCE_TYPE,
  AOS_PASSPORT_IDENTITY_TYPE,

  createPassportIdentity,

  ensurePassportForAosObject,
  verifyAosObjectPassport,

  assertPassportEntity
};
