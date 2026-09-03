"use strict";

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const TEST_ROOT = path.join("/tmp", `ixi-internal-financial-${process.pid}`);
process.env.IXI_MOS_DATA_ROOT = TEST_ROOT;
fs.rmSync(TEST_ROOT, { recursive: true, force: true });

const { ensureAosAccount } = require("../mos/accounts/aosAccountService");
const { createObject } = require("../mos/objects/objectService");
const { resolveOwnerPerson } = require("../identity/IXIInternalFinancialRequest");

test("internal Financial owner identity is deterministic and rejects ambiguity", () => {
  const bootstrap = ensureAosAccount({
    ownerUserId: "sharetribe-owner-test",
    displayName: "Owner Identity Test"
  });

  assert.throws(
    () => resolveOwnerPerson({
      membership: bootstrap.membership,
      entityId: bootstrap.entity.entityId
    }),
    error => error.code === "IXI_FINANCIAL_OWNER_PERSON_REQUIRED" &&
      error.details.activePersonCount === 0
  );

  const owner = createObject({
    entityId: bootstrap.entity.entityId,
    objectType: "person",
    displayName: "Account Owner",
    actorId: bootstrap.membership.principalId
  });

  assert.equal(
    resolveOwnerPerson({
      membership: bootstrap.membership,
      entityId: bootstrap.entity.entityId
    }).objectId,
    owner.objectId
  );

  createObject({
    entityId: bootstrap.entity.entityId,
    objectType: "person",
    displayName: "Second Person",
    actorId: bootstrap.membership.principalId
  });

  assert.throws(
    () => resolveOwnerPerson({
      membership: bootstrap.membership,
      entityId: bootstrap.entity.entityId
    }),
    error => error.code === "IXI_FINANCIAL_OWNER_PERSON_REQUIRED" &&
      error.details.activePersonCount === 2
  );

  assert.equal(
    resolveOwnerPerson({
      membership: {
        ...bootstrap.membership,
        personObjectId: owner.objectId
      },
      entityId: bootstrap.entity.entityId
    }).objectId,
    owner.objectId
  );
});
