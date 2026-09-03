"use strict";

/*
 * Authenticates Financial requests sent by the IronXchange server gateway.
 *
 * The browser session is verified by Sharetribe inside the gateway. The
 * gateway then signs the resolved principal + AOS Entity with the same HMAC
 * contract already used by MOS. Passport identity and Financial authority are
 * derived again inside IX-Core; no browser-supplied identity or permission is
 * trusted.
 */

const {
  verifyInternalRequest
} = require("../mos/security/internalRequestAuthService");

const {
  getAosAccountForUser
} = require("../mos/accounts/aosAccountService");

const {
  listObjects
} = require("../mos/objects/objectService");

const {
  MOS_OBJECT_TYPES,
  MOS_OBJECT_STATUS
} = require("../mos/constants");

const {
  ensureEntityPassport,
  ensurePersonPassport
} = require("./IXIPassportIdentityBridge");

const {
  discoverFinancialPassportScope
} = require("../financial/IXIFinancialScopeDiscoveryService");

function clean(value) {
  return String(value ?? "").trim();
}

function hasInternalSignature(req) {
  return Boolean(clean(req?.headers?.["x-ixi-internal-signature"]));
}

function fail(code, message, details = {}, statusCode = 401) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  error.statusCode = statusCode;
  throw error;
}

function resolveOwnerPerson({ membership, entityId }) {
  const explicitObjectId = clean(membership?.personObjectId);
  const people = listObjects({
    entityId,
    status: MOS_OBJECT_STATUS.ACTIVE
  }).filter(object => clean(object?.objectType) === MOS_OBJECT_TYPES.PERSON);

  if (explicitObjectId) {
    const explicit = people.find(person => person.objectId === explicitObjectId);
    if (!explicit) {
      fail(
        "IXI_FINANCIAL_OWNER_PERSON_INVALID",
        "The AOS owner membership references an invalid Person identity.",
        { entityId, personObjectId: explicitObjectId },
        409
      );
    }
    return explicit;
  }

  if (people.length !== 1) {
    fail(
      "IXI_FINANCIAL_OWNER_PERSON_REQUIRED",
      people.length
        ? "The AOS owner must be linked to one Person before Financial access can open."
        : "The AOS Entity needs an owner Person before Financial access can open.",
      { entityId, activePersonCount: people.length },
      409
    );
  }

  return people[0];
}

async function bindInternalFinancialContext(req) {
  const signed = verifyInternalRequest(req);
  const principalId = clean(signed.principalId);
  const entityId = clean(signed.entityId);

  if (!entityId) {
    fail(
      "IXI_FINANCIAL_INTERNAL_ENTITY_REQUIRED",
      "Signed Financial requests require an AOS Entity.",
      {},
      401
    );
  }

  const accountContext = getAosAccountForUser(principalId);
  const membership = accountContext?.membership || {};
  const ownedEntityId = clean(accountContext?.entity?.entityId);

  if (
    ownedEntityId !== entityId ||
    clean(membership.principalId) !== principalId ||
    clean(membership.entityId) !== entityId ||
    clean(membership.role) !== "owner" ||
    clean(membership.status) !== "active"
  ) {
    fail(
      "IXI_FINANCIAL_INTERNAL_TENANT_DENIED",
      "The signed principal is not the active owner of this AOS Entity.",
      { entityId },
      403
    );
  }

  const person = resolveOwnerPerson({ membership, entityId });
  const entityIdentity = ensureEntityPassport(entityId);
  const personIdentity = ensurePersonPassport({
    objectId: person.objectId,
    expectedEntityId: entityId
  });

  const authorityPrincipal = {
    authenticated: true,
    principalType: "sharetribe-user",
    principalId,
    actorPassportId: personIdentity.actorPassportId,
    entityId,
    entityPassportId: entityIdentity.entityPassportId,
    roleIds: ["owner"],
    groupIds: [],
    directGrants: [],
    directDenies: [],
    scopes: []
  };

  const estate = await discoverFinancialPassportScope({
    principal: authorityPrincipal,
    aosEntityId: entityId,
    entityPassportId: entityIdentity.entityPassportId
  });

  req.ixiIdentity = {
    authenticatedUserId: principalId,
    actorPassportId: personIdentity.actorPassportId,
    entityPassportId: entityIdentity.entityPassportId,
    authProvider: "sharetribe-server-gateway",
    sessionId: signed.requestId,
    tokenSubject: principalId,
    trustedInternal: true,
    metadata: { entityId, personObjectId: person.objectId }
  };

  req.trustedFinancialAccess = {
    actorPassportId: personIdentity.actorPassportId,
    entityPassportId: entityIdentity.entityPassportId,
    roles: ["financial-admin"],
    permissions: [],
    deniedPermissions: [],
    managedPassportIds: estate.scopePassportIds,
    metadata: {
      principalId,
      entityId,
      source: "sharetribe-server-gateway"
    }
  };

  req.ixiAuthorityPrincipal = authorityPrincipal;
  req.ixiFinancialEstate = estate;
  req.ixiInternalAuth = signed;
}

async function ixiInternalFinancialRequest(req, res, next) {
  if (!hasInternalSignature(req)) return next();

  try {
    await bindInternalFinancialContext(req);
    return next();
  } catch (error) {
    const status = Number(error?.statusCode || error?.status || 401);
    return res.status(status >= 400 && status <= 599 ? status : 401).json({
      ok: false,
      contract: "ixi-identity",
      operation: "ixi.financial.internal-authentication",
      data: null,
      errors: [{
        name: clean(error?.name) || "IXIAuthenticationError",
        code: clean(error?.code) || "IXI_INTERNAL_AUTH_FAILED",
        message: clean(error?.message) || "IXI internal authentication failed.",
        details: error?.details || null
      }],
      warnings: []
    });
  }
}

module.exports = {
  hasInternalSignature,
  resolveOwnerPerson,
  bindInternalFinancialContext,
  ixiInternalFinancialRequest
};
