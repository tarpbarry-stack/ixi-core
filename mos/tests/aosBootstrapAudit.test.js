"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "ixi-aos-bootstrap-audit-")
);

process.env.IXI_MOS_DATA_ROOT = path.join(testRoot, "mos");
process.env.IXI_MOS_SQLITE_PATH = path.join(
  testRoot,
  "mos",
  "ixi-aos.sqlite"
);
process.env.IXI_MOS_STORAGE_PROVIDER = "sqlite";
process.env.IXI_PASSPORT_DATA_FILE = path.join(testRoot, "passports.json");

const {
  ensureCommercialOnboarding
} = require("../onboarding/aosCommercialOnboardingService");
const {
  loadAosEnvironment
} = require("../accounts/aosEnvironmentService");
const {
  createObject
} = require("../objects/objectService");
const {
  getMosSqliteStore
} = require("../storage/sqliteStore");
const { MOS_PATHS } = require("../storage/mosPaths");

const store = getMosSqliteStore();

test.after(() => {
  store.close();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test("repeated AOS bootstrap does not manufacture membership or projection revisions", async () => {
  const principalId = "sharetribe-bootstrap-audit-owner";
  const firstOnboarding = ensureCommercialOnboarding({
    ownerUserId: principalId,
    entityDisplayName: "Bootstrap Audit Equipment",
    person: { displayName: "Audit Owner" }
  });

  const membershipBefore = store.inspect(MOS_PATHS.memberships);

  const secondOnboarding = ensureCommercialOnboarding({
    ownerUserId: principalId,
    entityDisplayName: "Bootstrap Audit Equipment",
    person: { displayName: "Audit Owner" }
  });

  const membershipAfter = store.inspect(MOS_PATHS.memberships);
  assert.equal(
    secondOnboarding.membership.membershipId,
    firstOnboarding.membership.membershipId
  );
  assert.equal(membershipAfter.version, membershipBefore.version);
  assert.equal(membershipAfter.updatedAt, membershipBefore.updatedAt);

  createObject({
    entityId: firstOnboarding.entity.entityId,
    objectType: "job",
    displayName: "Projection Audit Container",
    actorId: principalId
  });

  await loadAosEnvironment({
    ownerUserId: principalId,
    displayName: "Bootstrap Audit Equipment"
  });

  const projectionBefore = store.inspect(MOS_PATHS.projections);

  await loadAosEnvironment({
    ownerUserId: principalId,
    displayName: "Bootstrap Audit Equipment"
  });

  const projectionAfter = store.inspect(MOS_PATHS.projections);
  assert.equal(projectionAfter.version, projectionBefore.version);
  assert.equal(projectionAfter.updatedAt, projectionBefore.updatedAt);
});
