"use strict";

/*
 * IXI FINANCIAL IDENTITY BRIDGE
 *
 * PURPOSE
 * -------
 *
 * Translate an authenticated IXI AOS
 * Employee + Membership into the trusted
 * request contract already expected by
 * IXI Financial.
 *
 *
 * IMPORTANT
 * ---------
 *
 * This bridge NEVER invents Passport IDs.
 *
 * employeeId !== actorPassportId
 * entityId   !== entityPassportId
 *
 * Until authoritative Passport links exist,
 * Passport IDs remain empty.
 */


function clean(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


function safeArray(
  value
) {
  return Array.isArray(
    value
  )
    ? value
    : [];
}


function safeObject(
  value
) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}


function uniqueStrings(
  value
) {
  return Array.from(
    new Set(
      safeArray(
        value
      )
        .map(clean)
        .filter(Boolean)
    )
  );
}


/* =========================================================
   PASSPORT RESOLUTION
   ========================================================= */

/*
 * Only consume explicit authoritative fields.
 *
 * We intentionally do NOT fall back to:
 *
 *   employeeId
 *   entityId
 *
 * Those identifiers are different domains.
 */

function resolveActorPassportId({
  identity = {},
  membership = {}
} = {}) {
  return clean(
    membership.actorPassportId ||
    identity.actorPassportId ||
    identity.employeePassportId
  );
}


function resolveEntityPassportId({
  identity = {},
  membership = {}
} = {}) {
  return clean(
    membership.entityPassportId ||
    identity.entityPassportId
  );
}


/* =========================================================
   FINANCIAL REQUEST CONTEXT
   ========================================================= */

function buildFinancialRequestContext(
  authenticatedAccess = {}
) {
  const source =
    safeObject(
      authenticatedAccess
    );

  const authentication =
    safeObject(
      source.authentication
    );

  const identity =
    safeObject(
      source.identity
    );

  const membership =
    safeObject(
      source.membership
    );


  const cognitoSubject =
    clean(
      authentication.cognitoSubject
    );


  const employeeId =
    clean(
      identity.employeeId ||
      membership.employeeId
    );


  const entityId =
    clean(
      membership.entityId ||
      identity.entityId
    );


  const actorPassportId =
    resolveActorPassportId({
      identity,
      membership
    });


  const entityPassportId =
    resolveEntityPassportId({
      identity,
      membership
    });


  /*
   * Today membership.roleIds is already the
   * authoritative AOS role assignment field.
   *
   * Financial will only gain permissions from
   * role IDs that its own permission engine
   * actually recognizes.
   *
   * No translation is invented here.
   */

  const roles =
    uniqueStrings(
      membership.roleIds
    );


  /*
   * Direct grants / denies are forwarded as
   * capability IDs.
   *
   * Financial will only honor actions that
   * match its own registered action namespace.
   */

  const permissions =
    uniqueStrings(
      membership.directGrants
    );


  const deniedPermissions =
    uniqueStrings(
      membership.directDenies
    );


  /*
   * Passport access is intentionally separate
   * from AOS location/resource scopes.
   *
   * Do not put location IDs into
   * managedPassportIds.
   */

  const managedPassportIds =
    uniqueStrings(
      membership.managedPassportIds
    );


  const scopes =
    uniqueStrings(
      membership.scopes
    );


  return {
    ixiIdentity: {
      authenticatedUserId:
        cognitoSubject,

      actorPassportId,
      entityPassportId,

      authProvider:
        "cognito",

      tokenSubject:
        cognitoSubject,

      trustedInternal:
        true,

      metadata: {
        employeeId,
        entityId,

        cognitoUsername:
          clean(
            authentication.username
          ),

        scopes
      }
    },


    trustedFinancialAccess: {
      actorPassportId,
      entityPassportId,

      roles,
      permissions,

      managedPassportIds,
      deniedPermissions,

      metadata: {
        employeeId,
        entityId,
        scopes,

        source:
          "ixi-aos-identity"
      }
    },


    resolved: {
      cognitoSubject,
      employeeId,
      entityId,

      actorPassportId,
      entityPassportId,

      roles,
      permissions,
      deniedPermissions,
      managedPassportIds,
      scopes
    }
  };
}


module.exports = {
  resolveActorPassportId,
  resolveEntityPassportId,

  buildFinancialRequestContext
};
