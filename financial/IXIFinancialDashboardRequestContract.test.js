"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeFinancialDashboardQuery,
  resolveFinancialDashboardQuery
} = require("./IXIFinancialDashboardRequestContract");

const estate = Object.freeze({
  entityId: "entity-star",
  entityPassportId: "IXI_ENTITY",
  rootPassportId: "IXI_ENTITY",
  scopePassportIds: ["IXI_ENTITY", "IXI_MACHINE", "IXI_LOCATION"]
});

const accessContext = Object.freeze({
  authenticated: true,
  entityPassportId: "IXI_ENTITY"
});

test("normalizes the released TRAN$ACT nested company and period contract", () => {
  const query = normalizeFinancialDashboardQuery({
    scope: { entityPassportIds: ["IXI_ENTITY"] },
    period: {
      from: "2026-09-01",
      through: "2026-09-30",
      accountingPeriod: "2026-09"
    },
    currency: "usd"
  });

  assert.equal(query.rootPassportId, "IXI_ENTITY");
  assert.deepEqual(query.scopePassportIds, ["IXI_ENTITY"]);
  assert.equal(query.startAt, "2026-09-01");
  assert.equal(query.endAt, "2026-09-30");
  assert.equal(query.accountingPeriod, "2026-09");
});

test("a selected machine narrows the query instead of unioning the whole Entity", () => {
  const query = normalizeFinancialDashboardQuery({
    scope: {
      entityPassportIds: ["IXI_ENTITY"],
      assetPassportIds: ["IXI_MACHINE"]
    }
  });

  assert.equal(query.rootPassportId, "IXI_MACHINE");
  assert.deepEqual(query.scopePassportIds, ["IXI_MACHINE"]);
});

test("reuses the authenticated estate and never requires duplicate discovery", () => {
  const query = resolveFinancialDashboardQuery({
    requestQuery: {},
    accessContext,
    authenticatedEstate: estate,
    requireAuthenticatedEstate: true
  });

  assert.equal(query.rootPassportId, "IXI_ENTITY");
  assert.deepEqual(query.scopePassportIds, estate.scopePassportIds);
});

test("rejects browser scope outside the authenticated estate", () => {
  assert.throws(
    () => resolveFinancialDashboardQuery({
      requestQuery: {
        rootPassportId: "IXI_FOREIGN",
        scopePassportIds: ["IXI_FOREIGN"]
      },
      accessContext,
      authenticatedEstate: estate,
      requireAuthenticatedEstate: true
    }),
    error => error.name === "IXIFinancialAuthorizationError" &&
      error.code === "IXI_FINANCIAL_DASHBOARD_SCOPE_DENIED"
  );
});

test("fails closed when authenticated middleware omits estate evidence", () => {
  assert.throws(
    () => resolveFinancialDashboardQuery({
      requestQuery: {},
      accessContext,
      authenticatedEstate: null,
      requireAuthenticatedEstate: true
    }),
    error => error.code === "IXI_FINANCIAL_AUTHENTICATED_ESTATE_REQUIRED"
  );
});
