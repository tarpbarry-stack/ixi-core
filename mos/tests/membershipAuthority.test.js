"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-membership-authority-"));
process.env.IXI_MOS_DATA_ROOT = path.join(testRoot, "mos");
process.env.IXI_PASSPORT_DATA_FILE = path.join(testRoot, "passports.json");

const { ensureAosAccount } = require("../accounts/aosAccountService");
const { provisionAosObject } = require("../provisioning/aosObjectProvisioningService");
const { MOS_PATHS } = require("../storage/mosPaths");
const { readJsonFile, writeJsonFileAtomic } = require("../storage/jsonStore");
const {
  resolveMosMembershipPrincipal
} = require("../security/mosMembershipAuthorityService");
const authorityStore = require("../../authority/IXIAuthorityDynamoStore");
authorityStore.getCurrentPolicyRecord = async () => null;
const {
  evaluateMosObjectAuthority,
  buildMosObjectActorAuthority
} = require("../../authority/IXIAuthorityMosBridge");

test.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

const bootstrap = ensureAosAccount({
  ownerUserId: "owner-1",
  displayName: "Star and Sons"
});
const provisioned = provisionAosObject({
  commandId: "membership-authority-object",
  entityId: bootstrap.entity.entityId,
  objectType: "customer-defined",
  displayName: "Whatever Customer Calls It",
  actorId: "owner-1"
});
const secondProvisioned = provisionAosObject({
  commandId: "membership-authority-object-2",
  entityId: bootstrap.entity.entityId,
  objectType: "customer-defined",
  displayName: "Another Customer Object",
  actorId: "owner-1"
});

function updateMembership(patch) {
  const records = readJsonFile(MOS_PATHS.memberships, {});
  records[bootstrap.membership.membershipId] = {
    ...records[bootstrap.membership.membershipId],
    ...patch
  };
  writeJsonFileAtomic(MOS_PATHS.memberships, records);
}

test("signed principal resolves through exactly one active same-tenant membership", () => {
  const resolved = resolveMosMembershipPrincipal({
    principalId: "owner-1",
    entityId: bootstrap.entity.entityId
  });
  assert.equal(resolved.principal.authenticated, true);
  assert.equal(resolved.principal.strictAuthorization, true);
  assert.deepEqual(resolved.principal.directGrants, ["*"]);
  assert.equal(resolved.principal.tenantId, bootstrap.account.tenantId);
});

test("missing and cross-tenant membership fail closed", () => {
  assert.throws(
    () => resolveMosMembershipPrincipal({
      principalId: "missing-user",
      entityId: bootstrap.entity.entityId
    }),
    error => error.code === "IXI_AUTHORITY_MEMBERSHIP_REQUIRED"
  );
  assert.throws(
    () => resolveMosMembershipPrincipal({
      principalId: "owner-1",
      entityId: "entity-other"
    }),
    error => error.code === "IXI_AUTHORITY_ENTITY_MISMATCH"
  );
});

test("inactive and cross-tenant account membership fail closed", () => {
  updateMembership({ status: "inactive" });
  assert.throws(
    () => resolveMosMembershipPrincipal({
      principalId: "owner-1",
      entityId: bootstrap.entity.entityId
    }),
    error => error.code === "IXI_AUTHORITY_MEMBERSHIP_REQUIRED"
  );
  updateMembership({ status: "active", tenantId: "tenant-other" });
  assert.throws(
    () => resolveMosMembershipPrincipal({
      principalId: "owner-1",
      entityId: bootstrap.entity.entityId
    }),
    error => error.code === "IXI_AUTHORITY_TENANT_CONFLICT"
  );
  updateMembership({ tenantId: bootstrap.account.tenantId });
});

test("duplicate active membership fails closed", () => {
  const records = readJsonFile(MOS_PATHS.memberships, {});
  records.duplicate = {
    ...records[bootstrap.membership.membershipId],
    membershipId: "duplicate"
  };
  writeJsonFileAtomic(MOS_PATHS.memberships, records);
  assert.throws(
    () => resolveMosMembershipPrincipal({
      principalId: "owner-1",
      entityId: bootstrap.entity.entityId
    }),
    error => error.code === "IXI_AUTHORITY_MEMBERSHIP_CONFLICT"
  );
  delete records.duplicate;
  writeJsonFileAtomic(MOS_PATHS.memberships, records);
});

test("owner wildcard is governed and direct deny wins", async () => {
  let principal = resolveMosMembershipPrincipal({
    principalId: "owner-1",
    entityId: bootstrap.entity.entityId
  }).principal;
  let decision = await evaluateMosObjectAuthority({
    principal,
    object: provisioned.object,
    capability: "aos.edit"
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, "principal-direct-grant");

  updateMembership({ directDenies: ["aos.edit"] });
  principal = resolveMosMembershipPrincipal({
    principalId: "owner-1",
    entityId: bootstrap.entity.entityId
  }).principal;
  decision = await evaluateMosObjectAuthority({
    principal,
    object: provisioned.object,
    capability: "aos.edit"
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "principal-direct-deny");
});

test("a registered direct allow grants only its named capability", async () => {
  updateMembership({ directGrants: ["aos.edit"], permissions: [], directDenies: [] });
  const principal = resolveMosMembershipPrincipal({
    principalId: "owner-1",
    entityId: bootstrap.entity.entityId
  }).principal;
  const edit = await evaluateMosObjectAuthority({
    principal,
    object: provisioned.object,
    capability: "aos.edit"
  });
  const remove = await evaluateMosObjectAuthority({
    principal,
    object: provisioned.object,
    capability: "aos.delete"
  });
  assert.equal(edit.allowed, true);
  assert.equal(edit.reason, "principal-direct-grant");
  assert.equal(remove.allowed, false);
  assert.equal(remove.reason, "default-deny");
  updateMembership({ directGrants: ["*"], permissions: ["*"] });
});

test("effective authority is object-specific and an Object policy deny wins", async () => {
  const blockedPassportId = provisioned.object.identities.find(
    identity => identity.identityType === "ixi-passport"
  ).passportId;
  authorityStore.getCurrentPolicyRecord = async passportId => passportId === blockedPassportId
    ? {
        revision: 1,
        policy: {
          policyId: "policy-object-specific-deny",
          target: { passportId: blockedPassportId, objectId: provisioned.object.objectId },
          rules: [{
            ruleId: "deny-delete",
            effect: "deny",
            subject: { type: "all-authenticated" },
            capabilities: ["aos.delete"],
            scope: { type: "target", passportId: blockedPassportId }
          }]
        }
      }
    : null;
  const principal = resolveMosMembershipPrincipal({
    principalId: "owner-1",
    entityId: bootstrap.entity.entityId
  }).principal;
  const blocked = await evaluateMosObjectAuthority({
    principal,
    object: provisioned.object,
    capability: "aos.delete"
  });
  const allowed = await evaluateMosObjectAuthority({
    principal,
    object: secondProvisioned.object,
    capability: "aos.delete"
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "explicit-deny");
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reason, "principal-direct-grant");
  authorityStore.getCurrentPolicyRecord = async () => null;
});

test("server emits object-specific effective actor authority without persisting it", async () => {
  updateMembership({ directDenies: ["aos.delete", "transact.open"] });
  const principal = resolveMosMembershipPrincipal({
    principalId: "owner-1",
    entityId: bootstrap.entity.entityId
  }).principal;
  const envelope = await buildMosObjectActorAuthority({
    principal,
    object: provisioned.object
  });
  assert.equal(envelope.actorAuthority.canEdit, true);
  assert.equal(envelope.actorAuthority.canDelete, false);
  assert.equal(envelope.actorAuthority.canTransact, false);
  const persisted = readJsonFile(MOS_PATHS.objects, {})[provisioned.object.objectId];
  assert.equal(persisted.actorAuthority, undefined);
  updateMembership({ directDenies: [] });
});

test("strict authorization denies missing evidence instead of using compatibility allow", async () => {
  updateMembership({ permissions: [], directGrants: [], directDenies: [] });
  const principal = resolveMosMembershipPrincipal({
    principalId: "owner-1",
    entityId: bootstrap.entity.entityId
  }).principal;
  const decision = await evaluateMosObjectAuthority({
    principal,
    object: provisioned.object,
    capability: "aos.edit"
  });
  assert.equal(decision.enforced, true);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "default-deny");
});
