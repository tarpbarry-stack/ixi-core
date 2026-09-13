"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  ticketAuthenticatedRequest
} = require("./routes/ticketAuthenticatedRequest");

const {
  requireTicketPermission
} = require("./routes/ticketAuthorization");

function trustedOwnerRequest() {
  return {
    ixiAuthorityPrincipal: {
      authenticated: true,
      principalType: "sharetribe-user",
      principalId: "sharetribe-user-1",
      actorPassportId: "PASS-PERSON-1",
      entityId: "ent_aos_1",
      entityPassportId: "PASS-ENTITY-1",
      roleIds: ["owner"]
    },
    ixiInternalAuth: {
      authenticated: true,
      principalId: "sharetribe-user-1",
      entityId: "ent_aos_1",
      requestId: "request-1"
    }
  };
}

test("trusted internal principal becomes a complete Ticket context", () => {
  const req = trustedOwnerRequest();
  let nextCalled = false;
  const res = {
    status() {
      throw new Error("Trusted internal Ticket context must not be rejected.");
    }
  };

  ticketAuthenticatedRequest(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.deepEqual(req.ixiTicketContext, {
    authenticated: true,
    actorPassportId: "PASS-PERSON-1",
    entityPassportId: "PASS-ENTITY-1",
    aosEntityId: "ent_aos_1",
    identityEntityId: "ent_aos_1",
    principal: req.ixiAuthorityPrincipal
  });
});

test("trusted owner role ID authorizes Ticket commands", () => {
  assert.equal(
    requireTicketPermission(trustedOwnerRequest(), "tickets.create"),
    true
  );
});

test("Ticket mount verifies signed internal requests before Ticket authentication", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.match(
    source,
    /"\/tickets\/v1",\s*ixiInternalFinancialRequest,\s*ixiAuthenticatedFinancialRequest,\s*ticketAuthenticatedRequest,/u
  );
});
