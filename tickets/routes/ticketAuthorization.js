"use strict";

const {
  TicketError
} = require("../TicketError");

function clean(value) {
  return String(
    value ?? ""
  ).trim();
}

function safeArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function collectPermissions(req) {
  const principal =
    req.ixiAuthorityPrincipal || {};

  const access =
    req.ixiAuthenticatedAccess || {};

  const trusted =
    req.trustedFinancialAccess || {};

  const sources = [
    principal.permissions,
    principal.actions,
    principal.allowedActions,

    access.permissions,
    access.actions,
    access.allowedActions,

    access.authority?.permissions,
    access.authority?.actions,
    access.authority?.allowedActions,

    trusted.permissions,
    trusted.actions,
    trusted.allowedActions
  ];

  return new Set(
    sources
      .flatMap(safeArray)
      .map(clean)
      .filter(Boolean)
  );
}

function principalIsOwnerOrAdmin(req) {
  const principal =
    req.ixiAuthorityPrincipal || {};

  const access =
    req.ixiAuthenticatedAccess || {};

  const roles = [
    ...safeArray(
      principal.roles
    ),

    ...safeArray(
      access.roles
    ),

    ...safeArray(
      access.authority?.roles
    )
  ]
    .map(value =>
      clean(value).toLowerCase()
    );

  return (
    roles.includes("owner") ||
    roles.includes("admin") ||
    roles.includes("administrator")
  );
}

function requireTicketPermission(
  req,
  action
) {
  const required =
    clean(action);

  const permissions =
    collectPermissions(req);

  const allowed =
    permissions.has(required) ||
    permissions.has("tickets.manage") ||
    principalIsOwnerOrAdmin(req);

  if (!allowed) {
    throw new TicketError(
      "TICKET_AUTHORIZATION_REQUIRED",
      "Authenticated actor is not authorized for this Ticket operation.",
      {
        action:
          required
      },
      403
    );
  }

  return true;
}

module.exports = {
  collectPermissions,
  requireTicketPermission
};
