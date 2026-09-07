"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-owner-passport-claim-"));
process.env.IXI_MOS_DATA_ROOT = path.join(testRoot, "mos");
process.env.IXI_PASSPORT_DATA_FILE = path.join(testRoot, "passports.json");

const { ensureCommercialOnboarding } = require("../onboarding/aosCommercialOnboardingService");
const { getAosAccountForUser } = require("../accounts/aosAccountService");
const { getObject } = require("../objects/objectService");
const {
  listOwnerPassportCandidates,
  claimOwnerPassport
} = require("../provisioning/aosOwnerPassportClaimService");
const {
  findPassportById,
  findPassportBySource
} = require("../../passport/passportRegistry");

test.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

test("an exact owner can claim an available all-sevens Passport without breaking identity bindings", () => {
  const principalId = "sharetribe-owner-seven";
  const onboarded = ensureCommercialOnboarding({
    ownerUserId: principalId,
    entityDisplayName: "Seven Equipment",
    person: { displayName: "IXI DADDY" }
  });
  const oldPassportId = onboarded.passports.personPassportId;

  const candidates = listOwnerPassportCandidates();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].principalId, principalId);

  const claimed = claimOwnerPassport({
    principalId,
    requestedPassportId: "IXI-7777777"
  });
  assert.equal(claimed.passportId, "IXI7777777");
  assert.equal(claimed.previousPassportId, oldPassportId);
  assert.equal(findPassportById(oldPassportId), null);

  const passport = findPassportById("IXI7777777");
  assert.ok(passport.previousPassportIds.includes(oldPassportId));
  assert.equal(
    findPassportBySource("aos-object", onboarded.person.objectId).passportId,
    "IXI7777777"
  );
  assert.equal(
    findPassportBySource("sharetribe-user", principalId).passportId,
    "IXI7777777"
  );

  const person = getObject(onboarded.person.objectId);
  assert.equal(
    person.identities.find(identity => identity.identityType === "ixi-passport").passportId,
    "IXI7777777"
  );
  assert.equal(
    getAosAccountForUser(principalId).membership.personPassportId,
    "IXI7777777"
  );
});

test("a claimed Passport cannot be stolen from another owner", () => {
  const first = ensureCommercialOnboarding({
    ownerUserId: "sharetribe-owner-first",
    entityDisplayName: "First Entity",
    person: { displayName: "First Owner" }
  });
  ensureCommercialOnboarding({
    ownerUserId: "sharetribe-owner-second",
    entityDisplayName: "Second Entity",
    person: { displayName: "Second Owner" }
  });

  assert.throws(
    () => claimOwnerPassport({
      principalId: "sharetribe-owner-second",
      requestedPassportId: first.passports.personPassportId
    }),
    error => error?.code === "AOS_OWNER_REQUESTED_PASSPORT_CONFLICT"
  );
});
