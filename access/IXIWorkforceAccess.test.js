"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-workforce-access-"));
process.env.IXI_MOS_STORAGE_PROVIDER = "sqlite";
process.env.IXI_MOS_DATA_ROOT = path.join(root, "mos");
process.env.IXI_PASSPORT_DATA_FILE = path.join(root, "passports.json");
process.env.IXI_MOS_INTERNAL_SECRET = "test-workforce-invitation-secret-that-is-long";

const { ensureCommercialOnboarding } = require("../mos/onboarding/aosCommercialOnboardingService");
const { provisionAosObject } = require("../mos/provisioning/aosObjectProvisioningService");
const { listObjects, updateObject } = require("../mos/objects/objectService");
const { listRelationships } = require("../mos/relationships/relationshipService");
const { readPassportRecords } = require("../passport/passportRegistry");
const { readJsonFile } = require("../mos/storage/jsonStore");
const { MOS_PATHS } = require("../mos/storage/mosPaths");
const { getAosMembershipContextForPrincipal } = require("../mos/accounts/aosAccountService");
const { resolveMosMembershipPrincipal } = require("../mos/security/mosMembershipAuthorityService");
const authorityStore = require("../authority/IXIAuthorityDynamoStore");
authorityStore.getCurrentPolicyRecord = async () => null;
authorityStore.getCurrentPolicyRecords = ids => Promise.all(ids.map(id => authorityStore.getCurrentPolicyRecord(id)));
const { evaluateMosObjectAuthority } = require("../authority/IXIAuthorityMosBridge");
const access = require("./IXIWorkforceAccessService");

const onboarding = ensureCommercialOnboarding({
  ownerUserId: "workforce-owner",
  entityDisplayName: "User Named Entity",
  person: { displayName: "Owner Person", email: "owner@example.test" }
});
const entityId = onboarding.entity.entityId;
const ownerContext = { authenticated: true, principalId: "workforce-owner", entityId };
const provision = (objectType, displayName) => provisionAosObject({
  commandId: crypto.randomUUID(), entityId, objectType, displayName, actorId: "workforce-owner"
});
const employee = provision("person", "Field Person");
const selectedMachine = provision("machine", "Selected Loader");
const hiddenMachine = provision("machine", "Hidden Excavator");

function census() {
  return {
    objects: listObjects({ entityId, status: null }).length,
    passports: readPassportRecords().length,
    relationships: listRelationships({ entityId, status: null }).length
  };
}

function selectedProfile(revision = 0) {
  return {
    revision,
    accessEnabled: true,
    templateId: "service",
    machineScope: { mode: "selected", passportIds: [selectedMachine.identity.passportId] },
    environments: {
      aos: "view",
      launch: "upload",
      salesDesk: { enabled: false, role: "viewer", scope: "assigned" },
      calendar: "own",
      transact: "use"
    },
    financialRole: "none"
  };
}

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("every existing Person has a safe virtual face and owner access cannot be reduced", () => {
  const before = census();
  const initial = access.getPersonAccess(ownerContext, employee.identity.objectId);
  assert.equal(initial.profile.configured, false);
  assert.equal(initial.profile.machineScope.mode, "none");
  assert.equal(initial.profile.financialRole, "none");
  assert.equal(initial.profile.accessEnabled, false);
  assert.deepEqual(census(), before);

  const owner = access.getPersonAccess(ownerContext, onboarding.person.objectId);
  assert.equal(owner.protectedOwner, true);
  assert.equal(owner.profile.machineScope.mode, "all");
  assert.equal(owner.profile.financialRole, "financial-admin");
  assert.throws(
    () => access.savePersonAccess(ownerContext, onboarding.person.objectId, selectedProfile()),
    error => error.code === "WORKFORCE_ACCESS_OWNER_PROTECTED"
  );
});

test("profile save is revision locked and never mutates Object, Passport, or relationship identity", () => {
  const before = census();
  const saved = access.savePersonAccess(ownerContext, employee.identity.objectId, selectedProfile());
  assert.equal(saved.profile.revision, 1);
  assert.equal(saved.profile.machineScope.passportIds[0], selectedMachine.identity.passportId);
  assert.deepEqual(census(), before);
  assert.equal(
    access.savePersonAccess(ownerContext, employee.identity.objectId, selectedProfile()).profile.revision,
    1,
    "a lost-response retry resumes the committed revision"
  );
  assert.throws(
    () => access.savePersonAccess(ownerContext, employee.identity.objectId, {
      ...selectedProfile(),
      financialRole: "financial-controller"
    }),
    error => error.code === "WORKFORCE_ACCESS_REVISION_CONFLICT"
  );
});

test("invitation is replay-safe, verified-email bound, and reuses the exact Person and Passport", () => {
  const before = census();
  const commandId = crypto.randomUUID();
  const first = access.createInvitation(ownerContext, employee.identity.objectId, {
    commandId,
    email: "field@example.test"
  });
  const replay = access.createInvitation(ownerContext, employee.identity.objectId, {
    commandId,
    email: "field@example.test"
  });
  assert.equal(replay.invitation.id, first.invitation.id);
  assert.equal(replay.token, first.token);
  assert.equal(first.invitation.tokenHash, undefined);
  assert.throws(
    () => access.createInvitation(ownerContext, employee.identity.objectId, { commandId, email: "other@example.test" }),
    error => error.code === "WORKFORCE_INVITATION_COMMAND_CONFLICT"
  );
  assert.throws(
    () => access.acceptInvitation({ authenticated: true, principalId: "field-login" }, {
      entityId, id: first.invitation.id, token: first.token,
      email: "wrong@example.test", verifiedEmail: true
    }),
    error => error.code === "WORKFORCE_INVITATION_UNAVAILABLE"
  );

  const accepted = access.acceptInvitation({ authenticated: true, principalId: "field-login" }, {
    entityId, id: first.invitation.id, token: first.token,
    email: "field@example.test", verifiedEmail: true
  });
  access.acceptInvitation({ authenticated: true, principalId: "field-login" }, {
    entityId, id: first.invitation.id, token: first.token,
    email: "field@example.test", verifiedEmail: true
  });
  assert.equal(accepted.personObjectId, employee.identity.objectId);
  assert.equal(accepted.personPassportId, employee.identity.passportId);
  assert.deepEqual(census(), before);
  const memberships = Object.values(readJsonFile(MOS_PATHS.memberships, {}))
    .filter(item => item.principalId === "field-login");
  assert.equal(memberships.length, 1);
  assert.equal(memberships[0].personObjectId, employee.identity.objectId);
  assert.equal(memberships[0].personPassportId, employee.identity.passportId);
  assert.equal(memberships[0].entityPassportId, onboarding.passports.entityPassportId);
});

test("selected, all-current-and-future, and none machine scope enforce from canonical Passports", async () => {
  let resolved = resolveMosMembershipPrincipal({ principalId: "field-login", entityId }).principal;
  assert.equal((await evaluateMosObjectAuthority({ principal: resolved, object: selectedMachine.object, capability: "aos.view" })).allowed, true);
  const hidden = await evaluateMosObjectAuthority({ principal: resolved, object: hiddenMachine.object, capability: "aos.view" });
  assert.equal(hidden.allowed, false);
  assert.equal(hidden.reason, "workforce-machine-scope");

  let current = access.getPersonAccess(ownerContext, employee.identity.objectId).profile;
  access.savePersonAccess(ownerContext, employee.identity.objectId, {
    ...current,
    machineScope: { mode: "all", passportIds: [] }
  });
  const futureMachine = provision("machine", "Future Grader");
  resolved = resolveMosMembershipPrincipal({ principalId: "field-login", entityId }).principal;
  assert.equal((await evaluateMosObjectAuthority({ principal: resolved, object: futureMachine.object, capability: "aos.view" })).allowed, true);

  current = access.getPersonAccess(ownerContext, employee.identity.objectId).profile;
  access.savePersonAccess(ownerContext, employee.identity.objectId, {
    ...current,
    machineScope: { mode: "none", passportIds: [] }
  });
  resolved = resolveMosMembershipPrincipal({ principalId: "field-login", entityId }).principal;
  assert.equal((await evaluateMosObjectAuthority({ principal: resolved, object: selectedMachine.object, capability: "aos.view" })).allowed, false);
});

test("renaming a Person cannot change access and cross-Entity Person IDs are rejected", () => {
  const current = access.getPersonAccess(ownerContext, employee.identity.objectId).profile;
  updateObject({
    objectId: employee.identity.objectId,
    expectedRevision: employee.object.revision,
    displayName: "Renamed By The User",
    actorId: "workforce-owner"
  });
  const renamed = access.getPersonAccess(ownerContext, employee.identity.objectId);
  assert.equal(renamed.person.displayName, "Renamed By The User");
  assert.equal(renamed.profile.personPassportId, employee.identity.passportId);
  assert.equal(renamed.profile.revision, current.revision);

  const other = ensureCommercialOnboarding({
    ownerUserId: "other-owner",
    entityDisplayName: "Other User Named Entity",
    person: { displayName: "Other Owner" }
  });
  assert.throws(
    () => access.getPersonAccess(ownerContext, other.person.objectId),
    error => error.code === "WORKFORCE_ACCESS_PERSON_INVALID"
  );
});

test("suspension takes effect immediately and the non-owner context resolves exactly one membership", () => {
  const context = getAosMembershipContextForPrincipal({ principalId: "field-login" });
  assert.equal(context.entity.entityId, entityId);
  let current = access.getPersonAccess(ownerContext, employee.identity.objectId).profile;
  access.savePersonAccess(ownerContext, employee.identity.objectId, { ...current, accessEnabled: false });
  assert.throws(
    () => getAosMembershipContextForPrincipal({ principalId: "field-login", entityId }),
    error => error.code === "AOS_ACCOUNT_NOT_FOUND"
  );
  current = access.getPersonAccess(ownerContext, employee.identity.objectId).profile;
  access.savePersonAccess(ownerContext, employee.identity.objectId, { ...current, accessEnabled: true });
  assert.equal(getAosMembershipContextForPrincipal({ principalId: "field-login" }).membership.status, "active");
});

test("signed HTTP boundary permits only owner-scoped management and unscoped verified acceptance", async () => {
  process.env.IXI_MOS_INTERNAL_AUTH_ENFORCE = "true";
  const express = require("express");
  const { createInternalAuthMiddleware, buildCanonicalRequest } = require("../mos/security/internalRequestAuthService");
  const { createInternalTenantBoundaryMiddleware } = require("../mos/security/internalTenantBoundaryService");
  const { createMosMembershipAuthorityMiddleware } = require("../mos/security/mosMembershipAuthorityService");
  const app = express();
  const router = express.Router();
  app.use(express.json());
  router.use(createInternalAuthMiddleware(), createInternalTenantBoundaryMiddleware(), createMosMembershipAuthorityMiddleware());
  router.use("/workforce-access", require("./IXIWorkforceAccessRoutes"));
  app.use("/mos/v1", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));

  const call = async (method, suffix, { principalId = "workforce-owner", entity = entityId, body = null } = {}) => {
    const targetPath = `/mos/v1/workforce-access${suffix}`;
    const timestamp = String(Date.now());
    const requestId = crypto.randomUUID();
    const bodyString = body ? JSON.stringify(body) : "";
    const signature = crypto.createHmac("sha256", process.env.IXI_MOS_INTERNAL_SECRET)
      .update(buildCanonicalRequest({ timestamp, requestId, method, targetPath, principalId, entityId: entity, bodyString }))
      .digest("hex");
    return fetch(`http://127.0.0.1:${server.address().port}${targetPath}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-IXI-Internal-Signature-Version": "v1",
        "X-IXI-Internal-Timestamp": timestamp,
        "X-IXI-Internal-Request-Id": requestId,
        "X-IXI-Internal-Principal-Id": principalId,
        "X-IXI-Internal-Entity-Id": entity,
        "X-IXI-Internal-Signature": signature
      },
      ...(body ? { body: bodyString } : {})
    });
  };

  try {
    assert.equal((await call("GET", `/people/${employee.identity.objectId}`)).status, 200);
    assert.equal((await call("GET", `/people/${employee.identity.objectId}`, { principalId: "field-login" })).status, 403);
    assert.equal((await call("GET", `/people/${employee.identity.objectId}`, { entity: onboarding.entity.entityId + "-wrong" })).status, 403);

    const gatewayPerson = provision("person", "Gateway Person");
    const saved = access.savePersonAccess(ownerContext, gatewayPerson.identity.objectId, selectedProfile());
    const created = access.createInvitation(ownerContext, gatewayPerson.identity.objectId, {
      commandId: crypto.randomUUID(), email: "gateway-workforce@example.test"
    });
    const accepted = await call("POST", "/invitations/accept", {
      principalId: "gateway-workforce-login",
      entity: "",
      body: {
        entityId,
        id: created.invitation.id,
        token: created.token,
        email: "gateway-workforce@example.test",
        verifiedEmail: true,
        profileRevision: saved.profile.revision
      }
    });
    assert.equal(accepted.status, 200);
    assert.equal(getAosMembershipContextForPrincipal({ principalId: "gateway-workforce-login" }).membership.personObjectId, gatewayPerson.identity.objectId);
  } finally {
    await new Promise(resolve => server.close(resolve));
    delete process.env.IXI_MOS_INTERNAL_AUTH_ENFORCE;
  }
});
