"use strict";

/*
 * IXI AUTHENTICATED FINANCIAL REQUEST
 *
 * HTTP Authorization Bearer token
 *        ↓
 * Cognito JWT verification
 *        ↓
 * IXI Identity
 *        ↓
 * Active Entity Membership
 *        ↓
 * trusted Financial request context
 */


const {
  resolveAuthenticatedAccess
} =
  require(
    "./IXIIdentityClaimService"
  );


const {
  buildFinancialRequestContext
} =
  require(
    "./IXIFinancialIdentityBridge"
  );


const {
  resolveAuthenticatedFinancialIdentity
} =
  require(
    "./IXIAuthenticatedFinancialIdentityResolver"
  );


const {
  discoverFinancialPassportScope
} =
  require(
    "../financial/IXIFinancialScopeDiscoveryService"
  );


function clean(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


function getBearerToken(
  req
) {
  const authorization =
    clean(
      req
        ?.headers
        ?.authorization
    );


  const match =
    authorization.match(
      /^Bearer\s+(.+)$/i
    );


  return match
    ? clean(
        match[1]
      )
    : "";
}


/* =========================================================
   MIDDLEWARE
   ========================================================= */

async function ixiAuthenticatedFinancialRequest(
  req,
  res,
  next
) {
  const accessToken =
    getBearerToken(
      req
    );


  /*
   * No Bearer token:
   *
   * Let Financial handle the request normally.
   *
   * This preserves:
   *
   * - /financial/health
   * - existing authentication-required behavior
   * - test resolver behavior when explicitly enabled
   */

  if (!accessToken) {
    return next();
  }


  try {
    const requestedEntityId =
      clean(
        req.headers[
          "x-ixi-entity-id"
        ]
      );


    const authenticatedAccess =
      await resolveAuthenticatedAccess({
        accessToken,

        entityId:
          requestedEntityId
      });


    const financialIdentity =
      await resolveAuthenticatedFinancialIdentity(
        authenticatedAccess
      );


    /*
     * Authoritative Passport identity is
     * resolved server-side.
     *
     * We enrich the trusted structures consumed
     * by IXIFinancialIdentityBridge.
     *
     * Browser headers/body values are never used.
     */

    const financialAuthenticatedAccess = {
      ...authenticatedAccess,

      identity: {
        ...(authenticatedAccess.identity || {}),

        actorPassportId:
          financialIdentity.actorPassportId,

        employeePassportId:
          financialIdentity.actorPassportId,

        entityPassportId:
          financialIdentity.entityPassportId,

        personObjectId:
          financialIdentity.personObjectId,

        aosEntityId:
          financialIdentity.aosEntityId
      },

      membership: {
        ...(authenticatedAccess.membership || {}),

        actorPassportId:
          financialIdentity.actorPassportId,

        entityPassportId:
          financialIdentity.entityPassportId,

        personObjectId:
          financialIdentity.personObjectId,

        aosEntityId:
          financialIdentity.aosEntityId
      }
    };


    /*
     * Build the authenticated Authority principal
     * from server-resolved identity and membership.
     *
     * Browser values never establish authority.
     */

    const authorityPrincipal = {
      authenticated:
        true,

      principalType:
        "ixi-principal",

      principalId:
        financialIdentity.employeeId,

      employeeId:
        financialIdentity.employeeId,

      actorPassportId:
        financialIdentity.actorPassportId,

      entityId:
        financialIdentity.identityEntityId,

      entityPassportId:
        financialIdentity.entityPassportId,

      roleIds:
        Array.isArray(
          financialAuthenticatedAccess
            ?.membership
            ?.roleIds
        )
          ? financialAuthenticatedAccess
              .membership
              .roleIds
          : [],

      groupIds:
        Array.isArray(
          financialAuthenticatedAccess
            ?.membership
            ?.groupIds
        )
          ? financialAuthenticatedAccess
              .membership
              .groupIds
          : [],

      directGrants:
        Array.isArray(
          financialAuthenticatedAccess
            ?.membership
            ?.directGrants
        )
          ? financialAuthenticatedAccess
              .membership
              .directGrants
          : [],

      directDenies:
        Array.isArray(
          financialAuthenticatedAccess
            ?.membership
            ?.directDenies
        )
          ? financialAuthenticatedAccess
              .membership
              .directDenies
          : [],

      scopes:
        Array.isArray(
          financialAuthenticatedAccess
            ?.membership
            ?.scopes
        )
          ? financialAuthenticatedAccess
              .membership
              .scopes
          : []
    };


    /*
     * Resolve the permanent production Passport
     * estate for this authenticated Entity.
     *
     * The discovery service itself:
     *
     *   - accepts only valid production AOS objects
     *   - verifies aos-object Passport identity
     *   - applies Authority aos.discover
     *
     * Therefore its resulting Passport IDs are
     * trusted managed Financial scope.
     */

    const financialEstate =
      await discoverFinancialPassportScope({
        principal:
          authorityPrincipal,

        aosEntityId:
          financialIdentity.aosEntityId,

        entityPassportId:
          financialIdentity.entityPassportId
      });


    const existingManagedPassportIds =
      Array.isArray(
        financialAuthenticatedAccess
          ?.membership
          ?.managedPassportIds
      )
        ? financialAuthenticatedAccess
            .membership
            .managedPassportIds
        : [];


    const discoveredPassportIds =
      Array.isArray(
        financialEstate
          ?.scopePassportIds
      )
        ? financialEstate
            .scopePassportIds
        : [];


    financialAuthenticatedAccess
      .membership
      .managedPassportIds =
        Array.from(
          new Set([
            ...existingManagedPassportIds,
            ...discoveredPassportIds
          ])
        );


    /*
     * Build Financial context AFTER estate
     * enrichment.
     *
     * This ordering is critical.
     */

    const financialContext =
      buildFinancialRequestContext(
        financialAuthenticatedAccess
      );


    req.ixiIdentity =
      financialContext.ixiIdentity;


    req.trustedFinancialAccess =
      financialContext
        .trustedFinancialAccess;


    req.ixiAuthenticatedAccess =
      financialAuthenticatedAccess;


    req.ixiFinancialIdentity =
      financialIdentity;


    req.ixiAuthorityPrincipal =
      authorityPrincipal;


    req.ixiFinancialEstate =
      financialEstate;


    return next();


  } catch (error) {

    const statusCode =
      Number(
        error?.statusCode
      ) ||
      401;


    return res
      .status(
        statusCode >= 400 &&
        statusCode <= 599
          ? statusCode
          : 401
      )
      .json({
        ok:
          false,

        contract:
          "ixi-identity",

        operation:
          "ixi.financial.authentication",

        data:
          null,

        errors: [
          {
            name:
              clean(
                error?.name
              ) ||
              "IXIAuthenticationError",

            code:
              clean(
                error?.code
              ) ||
              "IXI_AUTHENTICATION_FAILED",

            message:
              clean(
                error?.message
              ) ||
              "IXI authentication failed."
          }
        ],

        warnings:
          [],

        metadata:
          {}
      });
  }
}


module.exports = {
  getBearerToken,
  ixiAuthenticatedFinancialRequest
};
