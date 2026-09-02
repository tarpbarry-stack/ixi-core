"use strict";

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


async function ixiAuthenticatedAuthorityRequest(
  req,
  res,
  next
) {
  const accessToken =
    getBearerToken(
      req
    );


  if (!accessToken) {
    return res
      .status(401)
      .json({
        ok:
          false,

        contract:
          "ixi-authority",

        operation:
          "authority.authentication",

        data:
          null,

        errors: [
          {
            code:
              "IXI_AUTHORITY_AUTHENTICATION_REQUIRED",

            message:
              "IXI authentication is required."
          }
        ],

        warnings:
          []
      });
  }


  try {
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


    req.ixiAuthenticatedAccess =
      access;


    req.ixiAuthorityPrincipal =
      principalFromAuthenticatedAccess(
        access
      );


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
          "authority.authentication",

        data:
          null,

        errors: [
          {
            code:
              clean(
                error?.code
              ) ||
              "IXI_AUTHORITY_AUTHENTICATION_FAILED",

            message:
              clean(
                error?.message
              ) ||
              "IXI authentication failed."
          }
        ],

        warnings:
          []
      });
  }
}


module.exports = {
  getBearerToken,
  ixiAuthenticatedAuthorityRequest
};
