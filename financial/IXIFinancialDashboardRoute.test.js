"use strict";

const http = require("node:http");
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const providerService = require("./IXIFinancialProviderService");
const financialRoutes = require("./IXIFinancialRoutes");

function request(server, body, headers = {}) {
  const address = server.address();
  return fetch(`http://127.0.0.1:${address.port}/dashboard`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  }).then(async response => ({
    status: response.status,
    body: await response.json()
  }));
}

function createApp({ includeEstate = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.ixiIdentity = {
      authenticatedUserId: "sharetribe-owner",
      actorPassportId: "IXI_OWNER",
      entityPassportId: "IXI_ENTITY",
      trustedInternal: true
    };
    req.trustedFinancialAccess = {
      actorPassportId: "IXI_OWNER",
      entityPassportId: "IXI_ENTITY",
      roles: ["financial-admin"],
      managedPassportIds: ["IXI_ENTITY", "IXI_MACHINE"]
    };
    req.ixiInternalAuth = { requestId: "signed-request" };
    if (includeEstate) {
      req.ixiFinancialEstate = {
        entityId: "entity-star",
        entityPassportId: "IXI_ENTITY",
        rootPassportId: "IXI_ENTITY",
        scopePassportIds: ["IXI_ENTITY", "IXI_MACHINE"]
      };
    }
    next();
  });
  app.use(financialRoutes);
  return app;
}

test("HMAC-authenticated TRAN$ACT returns a valid zero-ledger projection", async t => {
  const original = providerService.getScopeSnapshot;
  const calls = [];
  providerService.getScopeSnapshot = async input => {
    calls.push(input);
    return {
      ok: true,
      operation: "financial.scope.snapshot",
      requestId: "snapshot-request",
      data: {
        rootPassportId: input.rootPassportId,
        scopePassportIds: input.scopePassportIds,
        currency: input.currency,
        financialSnapshot: {
          currencies: [],
          snapshots: {},
          startAt: input.startAt,
          endAt: input.endAt
        },
        lifecycleSnapshot: {},
        recentActivity: [],
        storageProvider: "test"
      },
      errors: [],
      warnings: []
    };
  };
  t.after(() => {
    providerService.getScopeSnapshot = original;
  });

  const server = http.createServer(createApp());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const result = await request(server, {
    contract: "ixi-transact-dashboard-query",
    scope: { entityPassportIds: ["IXI_ENTITY"] },
    period: {
      from: "2026-09-01",
      through: "2026-09-30",
      accountingPeriod: "2026-09"
    },
    currency: "USD"
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.data.lineage.serverCalculated, true);
  assert.equal(result.body.data.executive.documentCount, 0);
  assert.equal(result.body.data.executive.factCount, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].rootPassportId, "IXI_ENTITY");
  assert.deepEqual(calls[0].scopePassportIds, ["IXI_ENTITY"]);
  assert.equal(calls[0].startAt, "2026-09-01");
  assert.equal(calls[0].endAt, "2026-09-30");
});

test("dashboard rejects a foreign Passport before the Financial provider runs", async t => {
  const original = providerService.getScopeSnapshot;
  let calls = 0;
  providerService.getScopeSnapshot = async () => {
    calls += 1;
    throw new Error("provider must not run");
  };
  t.after(() => {
    providerService.getScopeSnapshot = original;
  });

  const server = http.createServer(createApp());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const result = await request(server, {
    rootPassportId: "IXI_FOREIGN",
    scopePassportIds: ["IXI_FOREIGN"]
  });

  assert.equal(result.status, 403);
  assert.equal(result.body.ok, false);
  assert.equal(
    result.body.errors[0].code,
    "IXI_FINANCIAL_DASHBOARD_SCOPE_DENIED"
  );
  assert.equal(calls, 0);
});

test("missing authenticated estate returns a structured fail-closed envelope", async t => {
  const original = providerService.getScopeSnapshot;
  providerService.getScopeSnapshot = async () => {
    throw new Error("provider must not run");
  };
  t.after(() => {
    providerService.getScopeSnapshot = original;
  });

  const server = http.createServer(createApp({ includeEstate: false }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const result = await request(server, {});

  assert.equal(result.status, 500);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.contract, "ixi-financial-dashboard");
  assert.equal(
    result.body.errors[0].code,
    "IXI_FINANCIAL_AUTHENTICATED_ESTATE_REQUIRED"
  );
});
