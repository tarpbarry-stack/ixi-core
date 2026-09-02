"use strict";

/*
 * IXI AUTHENTICATED FINANCIAL IDENTITY RESOLVER
 *
 * PURPOSE
 * -------
 *
 * Resolve the permanent Financial identity of an
 * authenticated IXI principal from authoritative
 * server-side relationships.
 *
 * We DO NOT trust browser Passport IDs.
 *
 *
 * COGNITO
 *   ↓
 * IXI Employee
 *   ↓
 * Employee Identity Link
 *   ↓
 * MOS Person
 *   ↓
 * Person Passport = actorPassportId
 *
 * Membership Identity Entity
 *   ↓
 * IXI Entity Binding
 *   ↓
 * MOS/AOS Entity
 *   ↓
 * Entity Passport = entityPassportId
 */


const {
  getEmployeeIdentityLink
} =
  require(
    "./IXIIdentityRepository"
  );


const {
  resolveAosEntityId
} =
  require(
    "./IXIEntityBindingService"
  );


const {
  ensureEntityPassport,
  ensurePersonPassport
} =
  require(
    "./IXIPassportIdentityBridge"
  );


const {
  identityError
} =
  require(
    "./IXIIdentityErrors"
  );


function clean(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


function safeObject(
  value
) {
  return (
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}


/* =========================================================
   RESOLVE AUTHENTICATED FINANCIAL IDENTITY
   ========================================================= */

async function resolveAuthenticatedFinancialIdentity(
  authenticatedAccess = {}
) {
  const access =
    safeObject(
      authenticatedAccess
    );


  const identity =
    safeObject(
      access.identity
    );


  const membership =
    safeObject(
      access.membership
    );


  const employeeId =
    clean(
      identity.employeeId ||
      membership.employeeId
    );


  const identityEntityId =
    clean(
      membership.entityId ||
      identity.entityId
    );


  if (!employeeId) {
    throw identityError(
      "IXI_FINANCIAL_EMPLOYEE_REQUIRED",
      "Authenticated Financial access requires an IXI Employee identity.",
      {},
      401
    );
  }


  if (!identityEntityId) {
    throw identityError(
      "IXI_FINANCIAL_ENTITY_REQUIRED",
      "Authenticated Financial access requires an IXI Entity membership.",
      {
        employeeId
      },
      401
    );
  }


  /*
   * EMPLOYEE → MOS PERSON
   */

  const employeeLink =
    await getEmployeeIdentityLink(
      employeeId
    );


  const personObjectId =
    clean(
      employeeLink
        ?.personObjectId ||
      membership
        ?.personObjectId
    );


  if (!personObjectId) {
    throw identityError(
      "IXI_FINANCIAL_PERSON_IDENTITY_REQUIRED",
      "IXI Employee is not linked to a permanent MOS Person identity.",
      {
        employeeId,
        identityEntityId
      },
      409
    );
  }


  /*
   * IDENTITY ENTITY → AOS/MOS ENTITY
   */

  const aosEntityId =
    await resolveAosEntityId(
      identityEntityId
    );


  if (!aosEntityId) {
    throw identityError(
      "IXI_FINANCIAL_AOS_ENTITY_BINDING_REQUIRED",
      "IXI Entity is not bound to an AOS Entity for Financial access.",
      {
        employeeId,
        identityEntityId
      },
      409
    );
  }


  /*
   * PERMANENT PASSPORT IDENTITIES
   *
   * ensure* is idempotent against source identity.
   * It also validates the underlying MOS records.
   */

  const entityIdentity =
    ensureEntityPassport(
      aosEntityId
    );


  const personIdentity =
    ensurePersonPassport({
      objectId:
        personObjectId,

      expectedEntityId:
        aosEntityId
    });


  const actorPassportId =
    clean(
      personIdentity
        .actorPassportId
    );


  const entityPassportId =
    clean(
      entityIdentity
        .entityPassportId
    );


  if (
    !actorPassportId ||
    !entityPassportId
  ) {
    throw identityError(
      "IXI_FINANCIAL_PASSPORT_IDENTITY_INCOMPLETE",
      "Authenticated Financial Passport identity is incomplete.",
      {
        employeeId,
        identityEntityId,
        aosEntityId,
        personObjectId,
        actorPassportId,
        entityPassportId
      },
      409
    );
  }


  return {
    employeeId,
    identityEntityId,
    aosEntityId,
    personObjectId,

    actorPassportId,
    entityPassportId,

    employeeLink,

    person:
      personIdentity.person,

    entity:
      entityIdentity.entity
  };
}


module.exports = {
  resolveAuthenticatedFinancialIdentity
};
