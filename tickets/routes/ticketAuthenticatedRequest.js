"use strict";

function clean(value) {
  return String(
    value ?? ""
  ).trim();
}

function ticketAuthenticatedRequest(
  req,
  res,
  next
) {
  const identity =
    req.ixiFinancialIdentity || {};

  const access =
    req.ixiAuthenticatedAccess || {};

  const accessIdentity =
    access.identity || {};

  const principal =
    req.ixiAuthorityPrincipal || {};

  const actorPassportId =
    clean(
      identity.actorPassportId ||
      accessIdentity.actorPassportId ||
      principal.actorPassportId
    );

  const entityPassportId =
    clean(
      identity.entityPassportId ||
      accessIdentity.entityPassportId ||
      principal.entityPassportId
    );

  const aosEntityId =
    clean(
      identity.aosEntityId ||
      accessIdentity.aosEntityId
    );

  const identityEntityId =
    clean(
      identity.identityEntityId ||
      principal.entityId
    );

  if (
    !actorPassportId ||
    !entityPassportId ||
    !aosEntityId
  ) {
    return res
      .status(401)
      .json({
        ok: false,

        contract:
          "ixi-ticket",

        contractVersion:
          "1.0.0",

        operation:
          "ticket.authentication",

        data:
          null,

        errors: [
          {
            name:
              "IXITicketAuthenticationError",

            message:
              "Ticket authentication required.",

            details: {
              reason:
                "authentication-required"
            }
          }
        ],

        warnings: [],
        metadata: {}
      });
  }

  req.ixiTicketContext = {
    authenticated:
      true,

    actorPassportId,

    entityPassportId,

    aosEntityId,

    identityEntityId,

    principal
  };

  return next();
}

module.exports = {
  ticketAuthenticatedRequest
};
