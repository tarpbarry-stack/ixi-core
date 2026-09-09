"use strict";

/*
 * TRAN$ACT DESKTOP REQUEST CONTRACT
 *
 * The browser may choose a view inside the authenticated Financial estate.
 * It may never enlarge that estate. The authenticated middleware owns the
 * authoritative Passport boundary and publishes it as req.ixiFinancialEstate.
 */

function clean(value) {
  return String(value ?? "").trim();
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values = []) {
  return Array.from(new Set(safeArray(values).map(clean).filter(Boolean)));
}

function contractError({
  name = "IXIFinancialValidationError",
  code,
  message,
  details = {}
}) {
  const error = new Error(message);
  error.name = name;
  error.code = code;
  error.details = safeObject(details);
  return error;
}

function normalizeLegacyScope(scope = {}) {
  const source = safeObject(scope);
  const entityPassportIds = uniqueStrings(source.entityPassportIds);
  const contextualPassportIds = uniqueStrings([
    ...safeArray(source.locationPassportIds),
    ...safeArray(source.assetPassportIds),
    ...safeArray(source.customerPassportIds),
    ...safeArray(source.vendorPassportIds)
  ]);

  /*
   * A selected operating context is narrower than the Entity. Querying both
   * as a Dynamo union would silently return every Entity document.
   */
  const scopePassportIds = contextualPassportIds.length
    ? contextualPassportIds
    : entityPassportIds;

  return {
    rootPassportId: scopePassportIds[0] || "",
    scopePassportIds
  };
}

function normalizeFinancialDashboardQuery(input = {}) {
  const source = safeObject(input);
  const period = safeObject(source.period);
  const explicitScopePassportIds = uniqueStrings(source.scopePassportIds);
  const explicitRootPassportId = clean(source.rootPassportId);
  const legacy = normalizeLegacyScope(source.scope);
  const usesExplicitContract = Boolean(
    explicitRootPassportId || explicitScopePassportIds.length
  );

  const rootPassportId = usesExplicitContract
    ? explicitRootPassportId || explicitScopePassportIds[0] || ""
    : legacy.rootPassportId;
  const scopePassportIds = usesExplicitContract
    ? uniqueStrings([rootPassportId, ...explicitScopePassportIds])
    : legacy.scopePassportIds;

  return {
    ...source,
    rootPassportId,
    scopePassportIds,
    startAt: clean(source.startAt || period.from),
    endAt: clean(source.endAt || period.through),
    accountingPeriod: clean(source.accountingPeriod || period.accountingPeriod)
  };
}

function normalizeAuthenticatedEstate(input = {}) {
  const source = safeObject(input);
  const entityPassportId = clean(source.entityPassportId);
  const rootPassportId = clean(source.rootPassportId || entityPassportId);
  const scopePassportIds = uniqueStrings([
    entityPassportId,
    rootPassportId,
    ...safeArray(source.scopePassportIds)
  ]);

  return {
    ...source,
    entityPassportId,
    rootPassportId,
    scopePassportIds
  };
}

function resolveFinancialDashboardQuery({
  requestQuery = {},
  accessContext = {},
  authenticatedEstate = null,
  requireAuthenticatedEstate = false
} = {}) {
  const query = normalizeFinancialDashboardQuery(requestQuery);
  const access = safeObject(accessContext);
  const estate = normalizeAuthenticatedEstate(authenticatedEstate);
  const hasEstate = Boolean(
    estate.entityPassportId && estate.rootPassportId && estate.scopePassportIds.length
  );

  if (requireAuthenticatedEstate && !hasEstate) {
    throw contractError({
      name: "IXIFinancialInternalContextError",
      code: "IXI_FINANCIAL_AUTHENTICATED_ESTATE_REQUIRED",
      message: "Authenticated Financial estate evidence is required for the dashboard."
    });
  }

  if (!hasEstate) return query;

  if (
    clean(access.entityPassportId) &&
    clean(access.entityPassportId) !== estate.entityPassportId
  ) {
    throw contractError({
      name: "IXIFinancialAuthorizationError",
      code: "IXI_FINANCIAL_ESTATE_ENTITY_MISMATCH",
      message: "Authenticated Financial estate does not match the active Entity.",
      details: {
        accessEntityPassportId: clean(access.entityPassportId),
        estateEntityPassportId: estate.entityPassportId
      }
    });
  }

  const requestedPassportIds = uniqueStrings([
    query.rootPassportId,
    ...query.scopePassportIds
  ]);
  const allowedPassportIds = new Set(estate.scopePassportIds);
  const deniedPassportIds = requestedPassportIds.filter(
    passportId => !allowedPassportIds.has(passportId)
  );

  if (deniedPassportIds.length) {
    throw contractError({
      name: "IXIFinancialAuthorizationError",
      code: "IXI_FINANCIAL_DASHBOARD_SCOPE_DENIED",
      message: "Requested dashboard scope is outside the authenticated Financial estate.",
      details: { deniedPassportIds }
    });
  }

  const effectivePassportIds = requestedPassportIds.length
    ? requestedPassportIds
    : estate.scopePassportIds;

  return {
    ...query,
    rootPassportId: query.rootPassportId || estate.rootPassportId,
    scopePassportIds: effectivePassportIds
  };
}

module.exports = {
  normalizeLegacyScope,
  normalizeFinancialDashboardQuery,
  normalizeAuthenticatedEstate,
  resolveFinancialDashboardQuery
};
