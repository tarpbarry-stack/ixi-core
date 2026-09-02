"use strict";

/*
 * IXI PASSPORT IDENTITY BRIDGE
 *
 * PURPOSE
 * -------
 *
 * Establish authoritative Passport identity
 * for AOS/MOS business identities.
 *
 *
 * CONTRACT
 * --------
 *
 * MOS Entity:
 *
 *   sourceType = "mos-entity"
 *   sourceId   = entityId
 *
 *
 * MOS Person:
 *
 *   sourceType = "mos-person"
 *   sourceId   = objectId
 *
 *
 * IMPORTANT
 * ---------
 *
 * Employee is NOT a separate Passport type.
 *
 * An employee is a MOS Person participating
 * in an Entity through IXI membership/access.
 */


const {
  ensurePassportForSource
} =
  require(
    "../passport/passportRegistry"
  );


const {
  getEntity
} =
  require(
    "../mos/entities/entityService"
  );


const {
  getObject
} =
  require(
    "../mos/objects/objectService"
  );


const {
  MOS_OBJECT_TYPES,
  MOS_OBJECT_STATUS
} =
  require(
    "../mos/constants"
  );


const {
  identityError
} =
  require(
    "./IXIIdentityErrors"
  );


const PASSPORT_SOURCE_TYPES =
  Object.freeze({
    MOS_ENTITY:
      "mos-entity",

    MOS_PERSON:
      "mos-person"
  });


function clean(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


/*
 * Passport Registry compatibility.
 *
 * ensurePassportForSource historically returned
 * the Passport record directly.
 *
 * The current registry returns:
 *
 * {
 *   ok,
 *   created,
 *   passport
 * }
 *
 * This normalizer supports both shapes so every
 * identity consumer receives the canonical
 * Passport record.
 */

function normalizePassportRecord(
  value
) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    if (
      value.passport &&
      typeof value.passport === "object" &&
      !Array.isArray(value.passport)
    ) {
      return value.passport;
    }

    return value;
  }

  return {};
}


/* =========================================================
   ENTITY PASSPORT
   ========================================================= */

function ensureEntityPassport(
  entityId
) {
  const id =
    clean(
      entityId
    );

  if (!id) {
    throw identityError(
      "IXI_ENTITY_ID_REQUIRED",
      "MOS Entity ID is required.",
      {},
      400
    );
  }


  const entity =
    getEntity(
      id
    );


  if (
    clean(
      entity.status
    ) !==
      "active"
  ) {
    throw identityError(
      "IXI_ENTITY_NOT_ACTIVE",
      "MOS Entity must be active before Passport identity can be established.",
      {
        entityId:
          id,

        status:
          clean(
            entity.status
          )
      },
      409
    );
  }


  const passportResult =
    ensurePassportForSource({
      sourceType:
        PASSPORT_SOURCE_TYPES
          .MOS_ENTITY,

      sourceId:
        id,

      visibility:
        "private",

      status:
        "active",

      dealerName:
        clean(
          entity.displayName
        )
    });


  const passport =
    normalizePassportRecord(
      passportResult
    );


  const entityPassportId =
    clean(
      passport.passportId
    );


  if (!entityPassportId) {
    throw identityError(
      "IXI_ENTITY_PASSPORT_INVALID",
      "MOS Entity Passport provisioning did not return a valid Passport identity.",
      {
        entityId:
          id
      },
      500
    );
  }


  return {
    entity,
    passport,

    entityId:
      id,

    entityPassportId
  };
}


/* =========================================================
   PERSON PASSPORT
   ========================================================= */

function ensurePersonPassport({
  objectId,
  expectedEntityId = ""
} = {}) {
  const id =
    clean(
      objectId
    );

  if (!id) {
    throw identityError(
      "IXI_PERSON_OBJECT_ID_REQUIRED",
      "MOS Person object ID is required.",
      {},
      400
    );
  }


  const person =
    getObject(
      id
    );


  if (
    clean(
      person.objectType
    ) !==
      MOS_OBJECT_TYPES.PERSON
  ) {
    throw identityError(
      "IXI_OBJECT_NOT_PERSON",
      "MOS object is not a Person.",
      {
        objectId:
          id,

        objectType:
          clean(
            person.objectType
          )
      },
      409
    );
  }


  if (
    clean(
      person.status
    ) !==
      MOS_OBJECT_STATUS.ACTIVE
  ) {
    throw identityError(
      "IXI_PERSON_NOT_ACTIVE",
      "MOS Person must be active before Passport identity can be established.",
      {
        objectId:
          id,

        status:
          clean(
            person.status
          )
      },
      409
    );
  }


  const entityId =
    clean(
      person.entityId
    );


  const requiredEntityId =
    clean(
      expectedEntityId
    );


  if (
    requiredEntityId &&
    entityId !==
      requiredEntityId
  ) {
    throw identityError(
      "IXI_PERSON_ENTITY_MISMATCH",
      "MOS Person does not belong to the expected Entity.",
      {
        objectId:
          id,

        personEntityId:
          entityId,

        expectedEntityId:
          requiredEntityId
      },
      409
    );
  }


  const passportResult =
    ensurePassportForSource({
      sourceType:
        PASSPORT_SOURCE_TYPES
          .MOS_PERSON,

      sourceId:
        id,

      visibility:
        "private",

      status:
        "active",

      salesmanName:
        clean(
          person.displayName
        )
    });


  const passport =
    normalizePassportRecord(
      passportResult
    );


  const actorPassportId =
    clean(
      passport.passportId
    );


  if (!actorPassportId) {
    throw identityError(
      "IXI_PERSON_PASSPORT_INVALID",
      "MOS Person Passport provisioning did not return a valid Passport identity.",
      {
        objectId:
          id,

        entityId
      },
      500
    );
  }


  return {
    person,
    passport,

    personObjectId:
      id,

    entityId,

    actorPassportId
  };
}


module.exports = {
  PASSPORT_SOURCE_TYPES,

  normalizePassportRecord,

  ensureEntityPassport,
  ensurePersonPassport
};
