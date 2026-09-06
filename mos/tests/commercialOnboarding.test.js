"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "ixi-commercial-onboarding-")
);

process.env.IXI_MOS_DATA_ROOT = path.join(testRoot, "mos");
process.env.IXI_PASSPORT_DATA_FILE = path.join(testRoot, "passports.json");

const {
  ensureCommercialOnboarding
} = require("../onboarding/aosCommercialOnboardingService");

const {
  getAosAccountForUser
} = require("../accounts/aosAccountService");

const {
  createObject,
  listObjects
} = require("../objects/objectService");

const {
  readPassportRecords
} = require("../../passport/passportRegistry");

test.after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test("commercial onboarding creates one Entity, one owner Person, two Passports, and an empty TRAN$ACT foundation", () => {
  const first = ensureCommercialOnboarding({
    ownerUserId: "sharetribe-user-001",
    entityDisplayName: "Star and Sons",
    person: {
      displayName: "Barry Smith",
      firstName: "Barry",
      lastName: "Smith",
      email: "barry@example.com",
      phone: "555-0100"
    }
  });

  assert.equal(first.ok, true);
  assert.equal(first.entity.displayName, "Star and Sons");
  assert.equal(first.person.objectType, "person");
  assert.equal(first.person.displayName, "Barry Smith");
  assert.equal(first.membership.role, "owner");
  assert.equal(first.membership.personObjectId, first.person.objectId);
  assert.equal(
    first.membership.personPassportId,
    first.passports.personPassportId
  );
  assert.equal(
    first.membership.entityPassportId,
    first.passports.entityPassportId
  );
  assert.equal(first.transact.ready, true);
  assert.equal(first.transact.recordsCreated, 0);
  assert.equal(first.root.rootScopeId, first.entity.entityId);
  assert.notEqual(
    first.passports.entityPassportId,
    first.passports.personPassportId
  );

  const people = listObjects({
    entityId: first.entity.entityId,
    status: "active"
  }).filter(object => object.objectType === "person");

  assert.equal(people.length, 1);
  assert.equal(readPassportRecords().length, 2);
});

test("replaying onboarding returns the same durable identities without duplicate cards or Passports", () => {
  const first = ensureCommercialOnboarding({
    ownerUserId: "sharetribe-user-002",
    entityDisplayName: "Iron Test Company",
    person: { displayName: "Alex Owner" }
  });

  const second = ensureCommercialOnboarding({
    ownerUserId: "sharetribe-user-002",
    entityDisplayName: "Iron Test Company",
    person: { displayName: "Alex Owner" }
  });

  assert.equal(second.account.accountId, first.account.accountId);
  assert.equal(second.entity.entityId, first.entity.entityId);
  assert.equal(second.person.objectId, first.person.objectId);
  assert.equal(
    second.passports.entityPassportId,
    first.passports.entityPassportId
  );
  assert.equal(
    second.passports.personPassportId,
    first.passports.personPassportId
  );
  assert.equal(second.created.account, false);
  assert.equal(second.created.entity, false);
  assert.equal(second.created.membership, false);
  assert.equal(second.created.person, false);

  const account = getAosAccountForUser("sharetribe-user-002");
  assert.equal(account.membership.personObjectId, first.person.objectId);
});

test("existing accounts adopt their sole legacy Person instead of creating a duplicate", () => {
  const legacyAccount = require("../accounts/aosAccountService").ensureAosAccount({
    ownerUserId: "sharetribe-legacy-owner",
    displayName: "Legacy Equipment"
  });

  const legacyPerson = createObject({
    entityId: legacyAccount.entity.entityId,
    objectType: "person",
    displayName: "Legacy Owner",
    actorId: "sharetribe-legacy-owner"
  });

  const result = ensureCommercialOnboarding({
    ownerUserId: "sharetribe-legacy-owner",
    entityDisplayName: "Legacy Equipment",
    person: { displayName: "Legacy Owner" }
  });

  assert.equal(result.person.objectId, legacyPerson.objectId);
  assert.equal(result.person.metadata.onboarding.adoptedExistingPerson, true);
  assert.equal(
    listObjects({ entityId: result.entity.entityId, status: "active" })
      .filter(object => object.objectType === "person").length,
    1
  );
});
