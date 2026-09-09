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
  ensurePassportForSource,
  findPassportById,
  bindPassportSource,
  readPassportRecords,
  passportSources
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
  getObject,
  updateObject
} =
  require(
    "../mos/objects/objectService"
  );


const {
  ensurePassportForAosObject,
  verifyAosObjectPassport
} =
  require(
    "../mos/provisioning/aosObjectPassportService"
  );


const {
  MOS_OBJECT_TYPES,
  MOS_OBJECT_STATUS
} =
  require(
    "../mos/constants"
  );

const {
  resolveCanonicalObjectIdentity
} = require(
  "../mos/identity/canonicalObjectAdmissionService"
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


function resolveEntityPassport(
  entityId
) {
  const id = clean(entityId);
  if (!id) {
    throw identityError(
      "IXI_ENTITY_ID_REQUIRED",
      "MOS Entity ID is required.",
      {},
      400
    );
  }

  const entity = getEntity(id);
  if (clean(entity.status) !== "active") {
    throw identityError(
      "IXI_ENTITY_NOT_ACTIVE",
      "MOS Entity must be active before its Passport can be used.",
      { entityId: id, status: clean(entity.status) },
      409
    );
  }

  const matches = readPassportRecords().filter(passport =>
    passportSources(passport).some(source =>
      source.sourceType === PASSPORT_SOURCE_TYPES.MOS_ENTITY &&
      source.sourceId === id
    )
  );

  if (matches.length !== 1) {
    throw identityError(
      matches.length > 1
        ? "IXI_ENTITY_PASSPORT_CONFLICT"
        : "IXI_ENTITY_PASSPORT_REPAIR_REQUIRED",
      matches.length > 1
        ? "MOS Entity resolves to multiple Passports."
        : "MOS Entity has no established Passport.",
      { entityId: id, passportIds: matches.map(item => item.passportId) },
      409
    );
  }

  const passport = matches[0];
  if (clean(passport.entityId) && clean(passport.entityId) !== id) {
    throw identityError(
      "IXI_ENTITY_PASSPORT_TENANT_MISMATCH",
      "MOS Entity Passport carries a conflicting tenant identity.",
      { entityId: id, passportId: passport.passportId, passportEntityId: passport.entityId },
      409
    );
  }

  return {
    entity,
    passport,
    entityId: id,
    entityPassportId: clean(passport.passportId)
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
    (() => {
      const objectPassportId =
        (Array.isArray(person.identities)
          ? person.identities
          : [])
          .map(identity => clean(identity?.passportId))
          .find(Boolean);

      if (!objectPassportId) {
        return ensurePassportForSource({
          sourceType:
            PASSPORT_SOURCE_TYPES.MOS_PERSON,
          sourceId: id,
          entityId,
          visibility: "private",
          status: "active",
          salesmanName: clean(person.displayName)
        });
      }

      const existing =
        findPassportById(objectPassportId);

      if (!existing) {
        throw identityError(
          "IXI_PERSON_OBJECT_PASSPORT_NOT_FOUND",
          "The Person references a Passport that does not exist.",
          { objectId: id, passportId: objectPassportId },
          409
        );
      }

      const passport = bindPassportSource({
        passportId: objectPassportId,
        sourceType: PASSPORT_SOURCE_TYPES.MOS_PERSON,
        sourceId: id,
        entityId
      });

      return { ok: true, created: false, passport };
    })();


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


  /*
   * A Person Passport is not complete until the same identity is bound to
   * the canonical AOS Object and persisted on the Person record. Earlier
   * onboarding code created the registry record but returned a stale card,
   * which is what allowed AOS/Work to render "IXI - PENDING".
   */
  const aosPassportResult =
    ensurePassportForAosObject({
      objectId: id,
      entityId,
      trustedPassportId: actorPassportId
    });

  if (
    clean(aosPassportResult?.passport?.passportId) !==
      actorPassportId
  ) {
    throw identityError(
      "IXI_PERSON_PASSPORT_BINDING_CONFLICT",
      "The Person Object is bound to a different IXI Passport.",
      {
        objectId: id,
        expectedPassportId: actorPassportId,
        actualPassportId:
          clean(aosPassportResult?.passport?.passportId) || null
      },
      409
    );
  }

  const existingIdentities =
    Array.isArray(person.identities)
      ? person.identities
      : [];

  const expectedIdentity =
    aosPassportResult.identity;

  const existingPassportIdentities =
    existingIdentities.filter(
      identity =>
        clean(identity?.identityType) ===
          "ixi-passport"
    );

  const identityIsCanonical =
    existingPassportIdentities.length === 1 &&
    clean(existingPassportIdentities[0]?.passportId) === actorPassportId &&
    clean(existingPassportIdentities[0]?.entityId) === entityId &&
    clean(existingPassportIdentities[0]?.sourceType) === "aos-object" &&
    clean(existingPassportIdentities[0]?.sourceId) === id;

  const persistedPerson =
    identityIsCanonical &&
    person?.metadata?.transactEligible === true
      ? person
      : updateObject({
          objectId: id,
          identities: [
            ...existingIdentities.filter(
              identity =>
                clean(identity?.identityType) !==
                  "ixi-passport"
            ),
            expectedIdentity
          ],
          actorId: id,
          metadata: {
            ...(person.metadata || {}),
            transactEligible: true,
            passportIdentity: {
              state: "complete",
              passportId: actorPassportId,
              verified: true
            }
          }
        });

  verifyAosObjectPassport({
    objectId: id,
    passportId: actorPassportId,
    entityId
  });


  return {
    person: persistedPerson,
    passport,

    personObjectId:
      id,

    entityId,

    actorPassportId
  };
}


function resolvePersonPassport({
  objectId,
  expectedEntityId = ""
} = {}) {
  const admission = resolveCanonicalObjectIdentity({
    objectId,
    entityId: expectedEntityId
  });
  const person = admission.object;

  if (clean(person.objectType) !== MOS_OBJECT_TYPES.PERSON) {
    throw identityError(
      "IXI_OBJECT_NOT_PERSON",
      "MOS object is not a Person.",
      { objectId: admission.objectId, objectType: clean(person.objectType) },
      409
    );
  }

  return {
    person,
    passport: admission.passport,
    personObjectId: admission.objectId,
    entityId: admission.entityId,
    actorPassportId: admission.passportId
  };
}


module.exports = {
  PASSPORT_SOURCE_TYPES,

  normalizePassportRecord,

  ensureEntityPassport,
  ensurePersonPassport,
  resolveEntityPassport,
  resolvePersonPassport
};
