"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  freightAuthenticatedRequest
} = require("./routes/freightAuthenticatedRequest");

test("trusted internal Financial identity becomes a complete Freight context", () => {
  const req = {
    ixiAuthorityPrincipal: {
      authenticated: true,
      principalId: "sharetribe-user-1",
      actorPassportId: "PASS-PERSON-1",
      entityId: "ent_aos_1",
      entityPassportId: "PASS-ENTITY-1"
    },
    ixiInternalAuth: {
      authenticated: true,
      principalId: "sharetribe-user-1",
      entityId: "ent_aos_1",
      requestId: "request-1"
    }
  };
  let nextCalled = false;
  const res = {
    status() {
      throw new Error("Trusted internal Freight context must not be rejected.");
    }
  };

  freightAuthenticatedRequest(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.deepEqual(req.ixiFreightContext, {
    authenticated: true,
    actorPassportId: "PASS-PERSON-1",
    entityPassportId: "PASS-ENTITY-1",
    aosEntityId: "ent_aos_1",
    identityEntityId: "ent_aos_1",
    principal: req.ixiAuthorityPrincipal
  });
});

test("Freight mount authenticates signed internal requests before adapting context", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.match(
    source,
    /"\/freight\/v1",\s*ixiInternalFinancialRequest,\s*ixiAuthenticatedFinancialRequest,\s*freightAuthenticatedRequest,/u
  );
});
