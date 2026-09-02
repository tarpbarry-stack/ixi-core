"use strict";

/*
 * IXI AUTHORITY — MOS REQUEST BOUNDARY
 *
 * Establishes authenticated IXI identity for
 * protected AOS/MOS routes.
 *
 * Browser-supplied ownerUserId, actorId,
 * permissions, roles and ancestor chains are
 * NOT security authority.
 */


const {
  resolveAuthenticatedAccess
} =
  require(
    "../identity/IXIIdentityClaimService"
  );


const {
  principalFromAuthenticatedAccess
} =
  require(
    "./IXIAuthorityService"
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
      req?.headers?.authorization
    );

  const match =
    authorization.match(
      /^Bearer\s+(.+)$/i
    );

  return match
    ? clean(match[1])
    : "";
}


async function resolveMosAuthorityRequest(
  req
) {
  const accessToken =
    getBearerToken(req);

  if (!accessToken) {
    return null;
  }


  const requestedEntityId =
    clean(
      req.headers[
        "x-ixi-entity-id"
      ]
    );


  const access =
    await resolveAuthenticatedAccess({
      accessToken,

      entityId:
        requestedEntityId
    });


  return {
    access,

    principal:
      principalFromAuthenticatedAccess(
        access
      )
  };
}


/*
 * COMPATIBILITY MODE
 *
 * Existing MOS/AOS callers without Cognito
 * remain operational while the frontend is
 * migrated.
 *
 * When a valid Bearer token is present, the
 * server establishes trusted IXI authority.
 *
 * We will remove compatibility mode only after
 * current AOS callers have migrated.
 */

async function ixiOptionalMosAuthorityRequest(
  req,
  res,
  next
) {
  try {
    const resolved =
      await resolveMosAuthorityRequest(
        req
      );


    if (resolved) {
      req.ixiAuthenticatedAccess =
        resolved.access;

      req.ixiAuthorityPrincipal =
        resolved.principal;
    }


    return next();

  } catch (error) {
    return res
      .status(
        Number(
          error?.statusCode
        ) ||
        401
      )
      .json({
        ok:
          false,

        contract:
          "ixi-authority",

        operation:
          "aos.authentication",

        data:
          null,

        errors: [
          {
            code:
              clean(
                error?.code
              ) ||
              "IXI_AOS_AUTHENTICATION_FAILED",

            message:
              clean(
                error?.message
              ) ||
              "IXI AOS authentication failed."
          }
        ],

        warnings:
          []
      });
  }
}


module.exports = {
  getBearerToken,
  resolveMosAuthorityRequest,
  ixiOptionalMosAuthorityRequest
};
