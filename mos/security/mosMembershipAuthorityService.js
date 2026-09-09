"use strict";

const {
  readJsonFile
} = require("../storage/jsonStore");

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  MosError
} = require("../errors/MosError");

const {
  cleanText
} = require("../util/normalize");

function uniqueStrings(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map(cleanText)
      .filter(Boolean)
  )];
}

function principalFromMosMembership(membership, {
  strictAuthorization = true
} = {}) {
  return {
    authenticated: true,
    strictAuthorization: strictAuthorization === true,
    principalId: cleanText(membership.principalId),
    employeeId: cleanText(membership.employeeId),
    actorPassportId: cleanText(
      membership.actorPassportId ||
      membership.personPassportId
    ),
    entityId: cleanText(membership.entityId),
    entityPassportId: cleanText(membership.entityPassportId),
    roleIds: uniqueStrings([
      ...(membership.roleIds || []),
      membership.role
    ]),
    groupIds: uniqueStrings(membership.groupIds),
    directGrants: uniqueStrings(
      membership.directGrants ||
      membership.permissions
    ),
    directDenies: uniqueStrings(membership.directDenies),
    scopes: uniqueStrings(membership.scopes),
    membershipId: cleanText(membership.membershipId),
    tenantId: cleanText(membership.tenantId),
    accountId: cleanText(membership.accountId),
    authoritySource: "mos-membership"
  };
}

function resolveMosMembershipPrincipal({
  principalId,
  entityId,
  strictAuthorization = true
}) {
  const normalizedPrincipalId = cleanText(principalId);
  const normalizedEntityId = cleanText(entityId);

  if (!normalizedPrincipalId || !normalizedEntityId) {
    throw new MosError(
      "IXI_AUTHORITY_CONTEXT_REQUIRED",
      "Authenticated principal and Entity are required for MOS authorization.",
      null,
      401
    );
  }

  const memberships = Object.values(
    readJsonFile(MOS_PATHS.memberships, {})
  );
  const principalMemberships = memberships.filter(membership =>
    cleanText(membership.principalId) === normalizedPrincipalId
  );
  const activeMatches = principalMemberships.filter(membership =>
    cleanText(membership.entityId) === normalizedEntityId &&
    cleanText(membership.status).toLowerCase() === "active"
  );

  if (activeMatches.length > 1) {
    throw new MosError(
      "IXI_AUTHORITY_MEMBERSHIP_CONFLICT",
      "Multiple active memberships match the authenticated principal and Entity.",
      {
        principalId: normalizedPrincipalId,
        entityId: normalizedEntityId,
        membershipIds: activeMatches.map(item => item.membershipId)
      },
      409
    );
  }

  if (!activeMatches.length) {
    const hasOtherEntity = principalMemberships.some(membership =>
      cleanText(membership.status).toLowerCase() === "active" &&
      cleanText(membership.entityId) !== normalizedEntityId
    );
    throw new MosError(
      hasOtherEntity
        ? "IXI_AUTHORITY_ENTITY_MISMATCH"
        : "IXI_AUTHORITY_MEMBERSHIP_REQUIRED",
      hasOtherEntity
        ? "Authenticated principal is not an active member of the requested Entity."
        : "An active membership is required for this IXI operation.",
      { principalId: normalizedPrincipalId, entityId: normalizedEntityId },
      403
    );
  }

  const membership = activeMatches[0];
  const accounts = readJsonFile(MOS_PATHS.accounts, {});
  const account = accounts[cleanText(membership.accountId)];

  if (!account || cleanText(account.status).toLowerCase() !== "active") {
    throw new MosError(
      "IXI_AUTHORITY_ACCOUNT_INACTIVE",
      "The membership does not belong to an active IXI account.",
      { membershipId: membership.membershipId },
      403
    );
  }
  if (
    cleanText(account.tenantId) !== cleanText(membership.tenantId)
  ) {
    throw new MosError(
      "IXI_AUTHORITY_TENANT_CONFLICT",
      "Membership, account, tenant, and Entity identity are inconsistent.",
      { membershipId: membership.membershipId, accountId: account.accountId },
      409
    );
  }

  return {
    account,
    membership,
    principal: principalFromMosMembership(membership, { strictAuthorization })
  };
}

function createMosMembershipAuthorityMiddleware() {
  return function mosMembershipAuthorityMiddleware(req, res, next) {
    if (req.ixiAuthorityPrincipal?.authenticated) return next();
    if (!req.ixiRequestContext?.authenticated) return next();

    if (String(req.path || "").split("?")[0] === "/aos/onboarding/bootstrap") {
      return next();
    }

    /* Environment/bootstrap may establish the first governed membership. */
    if (!cleanText(req.ixiRequestContext.entityId)) return next();

    try {
      const resolved = resolveMosMembershipPrincipal({
        principalId: req.ixiRequestContext.principalId,
        entityId: req.ixiRequestContext.entityId,
        strictAuthorization: true
      });
      req.ixiAuthorityMembership = resolved.membership;
      req.ixiAuthorityPrincipal = resolved.principal;
      return next();
    } catch (error) {
      return res.status(Number(error.statusCode || error.status || 403)).json({
        ok: false,
        error: {
          code: error.code || "IXI_AUTHORITY_MEMBERSHIP_FAILED",
          message: error.message,
          details: error.details || null
        }
      });
    }
  };
}

function assertPrincipalCapability(principal, capability) {
  const requested = cleanText(capability);
  const denies = uniqueStrings(principal?.directDenies);
  const grants = uniqueStrings(principal?.directGrants);
  if (!principal?.authenticated) {
    throw new MosError(
      "IXI_AUTHORITY_PRINCIPAL_REQUIRED",
      "An authenticated authority principal is required.",
      null,
      401
    );
  }
  if (denies.includes("*") || denies.includes(requested)) {
    throw new MosError(
      "IXI_AUTHORITY_DENIED",
      "IXI Authority denied this operation.",
      { capability: requested, reason: "principal-direct-deny" },
      403
    );
  }
  if (grants.includes("*") || grants.includes(requested)) return true;
  throw new MosError(
    "IXI_AUTHORITY_DENIED",
    "IXI Authority denied this operation.",
    { capability: requested, reason: "default-deny" },
    403
  );
}

module.exports = {
  uniqueStrings,
  principalFromMosMembership,
  resolveMosMembershipPrincipal,
  createMosMembershipAuthorityMiddleware,
  assertPrincipalCapability
};
