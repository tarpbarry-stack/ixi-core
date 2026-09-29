"use strict";

const crypto = require("node:crypto");
const { MosError } = require("../mos/errors/MosError");
const { getObject, listObjects } = require("../mos/objects/objectService");
const { MOS_OBJECT_TYPES, MOS_OBJECT_STATUS } = require("../mos/constants");
const { readJsonFile, writeJsonFileAtomic } = require("../mos/storage/jsonStore");
const { MOS_PATHS } = require("../mos/storage/mosPaths");
const { resolveCanonicalObjectIdentity, normalizedPassportIds } = require("../mos/identity/canonicalObjectAdmissionService");
const { resolveMosMembershipPrincipal } = require("../mos/security/mosMembershipAuthorityService");
const { resolveEntityPassport } = require("../identity/IXIPassportIdentityBridge");
const { IXI_FINANCIAL_ROLES } = require("../financial/IXIFinancialPermissionEngine");
const repo = require("./IXIWorkforceAccessRepository");

const clean = value => String(value ?? "").trim();
const unique = values => [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
const ASSET_OBJECT_TYPES = new Set([
  MOS_OBJECT_TYPES.MACHINE,
  MOS_OBJECT_TYPES.EQUIPMENT,
  MOS_OBJECT_TYPES.VEHICLE,
  MOS_OBJECT_TYPES.TRAILER,
  MOS_OBJECT_TYPES.TOOL
]);
const FINANCIAL_ROLES = new Set(["none", ...Object.values(IXI_FINANCIAL_ROLES)]);

function fail(code, message, details = null, status = 400) {
  throw new MosError(code, message, details, status);
}

function requireOwner(context) {
  if (!context?.authenticated || !clean(context.principalId) || !clean(context.entityId)) {
    fail("WORKFORCE_ACCESS_AUTH_REQUIRED", "Sign in to manage System Access.", null, 401);
  }
  const resolved = resolveMosMembershipPrincipal({
    principalId: context.principalId,
    entityId: context.entityId,
    strictAuthorization: true
  });
  const owner = clean(resolved.membership.role) === "owner" &&
    clean(resolved.account.ownerUserId) === clean(context.principalId) &&
    clean(resolved.account.primaryEntityId) === clean(context.entityId);
  if (!owner) {
    fail(
      "WORKFORCE_ACCESS_OWNER_REQUIRED",
      "Only the Entity owner can manage Workforce System Access.",
      null,
      403
    );
  }
  return {
    entityId: clean(context.entityId),
    actorId: clean(context.principalId),
    account: resolved.account,
    membership: resolved.membership
  };
}

function resolvePerson(entityId, personObjectId) {
  const person = getObject(clean(personObjectId));
  if (!person || clean(person.entityId) !== clean(entityId) ||
      clean(person.objectType) !== MOS_OBJECT_TYPES.PERSON ||
      clean(person.status) !== MOS_OBJECT_STATUS.ACTIVE) {
    fail(
      "WORKFORCE_ACCESS_PERSON_INVALID",
      "Choose an active Person belonging to this Entity.",
      { personObjectId: clean(personObjectId) },
      404
    );
  }
  const identity = resolveCanonicalObjectIdentity({ entityId, objectId: person.objectId });
  return { person, identity };
}

function ownerPersonObjectId(actor) {
  return clean(actor.membership.personObjectId);
}

function defaultProfile({ entityId, person, identity }) {
  return {
    schema: "ixi-workforce-access-profile-v1",
    entityId,
    personObjectId: person.objectId,
    personPassportId: identity.passportId,
    revision: 0,
    configured: false,
    accessEnabled: false,
    templateId: "custom",
    machineScope: { mode: "none", passportIds: [] },
    environments: {
      aos: "none",
      launch: "none",
      salesDesk: { enabled: false, role: "sales", scope: "assigned" },
      calendar: "none",
      transact: "none"
    },
    financialRole: "none",
    status: "not-configured",
    createdAt: null,
    createdBy: null,
    updatedAt: null,
    updatedBy: null
  };
}

function ownerProfile({ entityId, person, identity }) {
  return {
    ...defaultProfile({ entityId, person, identity }),
    configured: true,
    accessEnabled: true,
    templateId: "owner",
    machineScope: { mode: "all", passportIds: [] },
    environments: {
      aos: "manage",
      launch: "manage",
      salesDesk: { enabled: true, role: "owner", scope: "company" },
      calendar: "manage",
      transact: "manage"
    },
    financialRole: IXI_FINANCIAL_ROLES.ADMIN,
    status: "active",
    protectedOwner: true,
    revision: 0
  };
}

function assertEnum(value, values, code, message) {
  const normalized = clean(value);
  if (!values.includes(normalized)) fail(code, message, { value: normalized }, 400);
  return normalized;
}

function resolveSelectedAssetPassports(entityId, values) {
  const requested = unique(values);
  if (!requested.length) return [];
  const assets = listObjects({ entityId, status: MOS_OBJECT_STATUS.ACTIVE })
    .filter(object => ASSET_OBJECT_TYPES.has(clean(object.objectType)));
  const available = new Set(assets.flatMap(normalizedPassportIds));
  const invalid = requested.filter(passportId => !available.has(passportId));
  if (invalid.length) {
    fail(
      "WORKFORCE_ACCESS_MACHINE_SCOPE_INVALID",
      "One or more selected machine Passports do not belong to this Entity.",
      { invalidPassportIds: invalid },
      400
    );
  }
  return requested;
}

function normalizeProfile(entityId, input = {}) {
  const mode = assertEnum(input?.machineScope?.mode, ["none", "selected", "all"],
    "WORKFORCE_ACCESS_MACHINE_MODE_INVALID", "Choose no machines, selected machines, or all machines.");
  const selected = mode === "selected"
    ? resolveSelectedAssetPassports(entityId, input?.machineScope?.passportIds)
    : [];
  const salesRole = assertEnum(input?.environments?.salesDesk?.role || "sales", ["manager", "sales", "viewer"],
    "WORKFORCE_ACCESS_SALES_ROLE_INVALID", "Choose a valid Sales Desk role.");
  const salesScope = assertEnum(input?.environments?.salesDesk?.scope || "assigned", ["assigned", "company"],
    "WORKFORCE_ACCESS_SALES_SCOPE_INVALID", "Choose assigned or company Sales Desk records.");
  const financialRole = clean(input.financialRole || "none");
  if (!FINANCIAL_ROLES.has(financialRole)) {
    fail("WORKFORCE_ACCESS_FINANCIAL_ROLE_INVALID", "Choose a valid Financial access level.", null, 400);
  }

  return {
    schema: "ixi-workforce-access-profile-v1",
    configured: true,
    accessEnabled: input.accessEnabled === true,
    templateId: clean(input.templateId) || "custom",
    machineScope: { mode, passportIds: selected },
    environments: {
      aos: assertEnum(input?.environments?.aos || "none", ["none", "view", "edit", "manage"],
        "WORKFORCE_ACCESS_AOS_LEVEL_INVALID", "Choose a valid AOS access level."),
      launch: assertEnum(input?.environments?.launch || "none", ["none", "upload", "manage"],
        "WORKFORCE_ACCESS_LAUNCH_LEVEL_INVALID", "Choose a valid Launch access level."),
      salesDesk: {
        enabled: input?.environments?.salesDesk?.enabled === true,
        role: salesRole,
        scope: salesRole === "manager" ? "company" : salesScope
      },
      calendar: assertEnum(input?.environments?.calendar || "none", ["none", "own", "team", "manage"],
        "WORKFORCE_ACCESS_CALENDAR_LEVEL_INVALID", "Choose a valid Calendar access level."),
      transact: assertEnum(input?.environments?.transact || "none", ["none", "use", "manage"],
        "WORKFORCE_ACCESS_TRANSACT_LEVEL_INVALID", "Choose a valid TRAN$ACT access level.")
    },
    financialRole,
    status: input.accessEnabled === true ? "configured" : "suspended"
  };
}

function membershipAccess(profile) {
  const grants = new Set();
  const aos = profile.environments.aos;
  const launch = profile.environments.launch;
  if (aos !== "none" || launch !== "none") {
    ["aos.discover", "aos.view", "aos.console.open"].forEach(value => grants.add(value));
  }
  if (["edit", "manage"].includes(aos) || launch !== "none") grants.add("aos.edit");
  if (aos === "manage") {
    ["aos.create", "aos.import", "aos.move", "aos.relationship.create", "aos.relationship.end",
      "aos.relationship.order", "aos.workspace.session.open", "aos.workspace.placement.write"]
      .forEach(value => grants.add(value));
  }
  if (profile.environments.transact !== "none") {
    ["transact.open", "transact.work-order.view", "transact.work-order.create",
      "transact.work-order.edit", "transact.time.create", "transact.material.create"]
      .forEach(value => grants.add(value));
  }
  if (profile.environments.transact === "manage") {
    ["transact.work-order.complete", "transact.freight.view", "transact.freight.create", "transact.freight.manage"]
      .forEach(value => grants.add(value));
  }
  if (profile.environments.calendar !== "none") grants.add("calendar.access");
  return {
    grants: [...grants],
    roles: profile.financialRole === "none" ? ["member"] : ["member", profile.financialRole],
    machineScope: profile.machineScope,
    salesDesk: {
      ...profile.environments.salesDesk,
      revision: 1
    },
    calendar: { level: profile.environments.calendar },
    financialRole: profile.financialRole
  };
}

function policyShape(profile) {
  return {
    schema: profile?.schema,
    configured: profile?.configured === true,
    accessEnabled: profile?.accessEnabled === true,
    templateId: clean(profile?.templateId),
    machineScope: profile?.machineScope,
    environments: profile?.environments,
    financialRole: clean(profile?.financialRole)
  };
}

function membershipsForPerson(entityId, personObjectId) {
  return Object.values(readJsonFile(MOS_PATHS.memberships, {})).filter(membership =>
    clean(membership.entityId) === clean(entityId) &&
    clean(membership.personObjectId) === clean(personObjectId) &&
    clean(membership.role) !== "owner"
  );
}

function syncExistingMembership(actor, profile) {
  const memberships = readJsonFile(MOS_PATHS.memberships, {});
  const matches = Object.values(memberships).filter(membership =>
    clean(membership.entityId) === actor.entityId &&
    clean(membership.personObjectId) === profile.personObjectId &&
    clean(membership.role) !== "owner"
  );
  if (matches.length > 1) {
    fail("WORKFORCE_ACCESS_MEMBERSHIP_CONFLICT", "This Person has multiple company memberships.", null, 409);
  }
  if (!matches.length) return null;
  const current = matches[0];
  const access = membershipAccess(profile);
  if (Number(current.accessProfileRevision || 0) === Number(profile.revision || 0) &&
      clean(current.status) === (profile.accessEnabled ? "active" : "suspended")) {
    return current;
  }
  const updated = {
    ...current,
    status: profile.accessEnabled ? "active" : "suspended",
    permissions: access.grants,
    directGrants: access.grants,
    directDenies: [],
    roleIds: access.roles,
    machineScope: access.machineScope,
    financialRole: access.financialRole,
    calendar: access.calendar,
    salesDesk: {
      ...(current.salesDesk || {}),
      ...access.salesDesk,
      revision: Number(current.salesDesk?.revision || 0) + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.actorId
    },
    accessProfileRevision: profile.revision,
    updatedAt: new Date().toISOString()
  };
  memberships[updated.membershipId] = updated;
  writeJsonFileAtomic(MOS_PATHS.memberships, memberships);
  return updated;
}

function scrubInvitation(invitation) {
  if (!invitation) return null;
  const { tokenHash, payloadHash, ...safe } = invitation;
  return safe;
}

function accessStatus(actor, personObjectId, profile, invitations) {
  if (personObjectId === ownerPersonObjectId(actor)) return "active";
  const memberships = membershipsForPerson(actor.entityId, personObjectId);
  if (memberships.some(item => clean(item.status) === "active")) return "active";
  if (memberships.some(item => clean(item.status) === "suspended")) return "suspended";
  if (invitations.some(item => item.status === "pending" && Date.parse(item.expiresAt) >= Date.now())) return "invited";
  return profile.configured ? (profile.accessEnabled ? "ready-to-invite" : "suspended") : "not-configured";
}

function getPersonAccess(context, personObjectId) {
  const actor = requireOwner(context);
  const { person, identity } = resolvePerson(actor.entityId, personObjectId);
  const protectedOwner = person.objectId === ownerPersonObjectId(actor);
  const persisted = protectedOwner ? null : repo.getProfile(actor.entityId, person.objectId);
  const invitations = protectedOwner ? [] : repo.listInvitations(actor.entityId, person.objectId).map(scrubInvitation);
  const profile = protectedOwner
    ? ownerProfile({ entityId: actor.entityId, person, identity })
    : persisted || defaultProfile({ entityId: actor.entityId, person, identity });
  return {
    person: { objectId: person.objectId, passportId: identity.passportId, displayName: person.displayName },
    profile: { ...profile, status: accessStatus(actor, person.objectId, profile, invitations) },
    invitations,
    protectedOwner
  };
}

function savePersonAccess(context, personObjectId, input = {}) {
  const actor = requireOwner(context);
  const { person, identity } = resolvePerson(actor.entityId, personObjectId);
  if (person.objectId === ownerPersonObjectId(actor)) {
    fail("WORKFORCE_ACCESS_OWNER_PROTECTED", "Owner access is permanent and cannot be reduced.", null, 409);
  }
  const normalized = normalizeProfile(actor.entityId, input);
  let saved;
  try {
    saved = repo.saveProfile({
      entityId: actor.entityId,
      personObjectId: person.objectId,
      personPassportId: identity.passportId,
      actorId: actor.actorId,
      expectedRevision: input.revision,
      profile: normalized
    });
  } catch (error) {
    const current = error?.code === "WORKFORCE_ACCESS_REVISION_CONFLICT"
      ? repo.getProfile(actor.entityId, person.objectId)
      : null;
    if (!current || JSON.stringify(policyShape(current)) !== JSON.stringify(policyShape(normalized))) {
      throw error;
    }
    // A lost response or interrupted membership sync may safely resume from
    // the already-committed profile revision without manufacturing a change.
    saved = current;
  }
  syncExistingMembership(actor, saved);
  return getPersonAccess(context, person.objectId);
}

function invitationSecret() {
  const secret = clean(process.env.IXI_WORKFORCE_INVITATION_SECRET || process.env.IXI_MOS_INTERNAL_SECRET);
  if (!secret || secret.length < 24) {
    fail("WORKFORCE_INVITATION_SECRET_REQUIRED", "Workforce invitation signing is not configured.", null, 503);
  }
  return secret;
}

function invitationToken({ entityId, personObjectId, commandId }) {
  return crypto.createHmac("sha256", invitationSecret())
    .update([entityId, personObjectId, commandId].join("\n"))
    .digest("base64url");
}

function createInvitation(context, personObjectId, input = {}) {
  const actor = requireOwner(context);
  const { person } = resolvePerson(actor.entityId, personObjectId);
  if (person.objectId === ownerPersonObjectId(actor)) {
    fail("WORKFORCE_ACCESS_OWNER_PROTECTED", "The owner already has permanent access.", null, 409);
  }
  const profile = repo.getProfile(actor.entityId, person.objectId);
  if (!profile?.configured || profile.accessEnabled !== true) {
    fail("WORKFORCE_ACCESS_PROFILE_REQUIRED", "Save and enable this Person's access before inviting them.", null, 409);
  }
  if (membershipsForPerson(actor.entityId, person.objectId).length) {
    fail("WORKFORCE_MEMBERSHIP_EXISTS", "This Person already has a connected company login.", null, 409);
  }
  const email = clean(input.email).toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail("WORKFORCE_INVITATION_EMAIL_INVALID", "Enter the invitee's official email address.", null, 400);
  }
  const commandId = clean(input.commandId);
  if (!commandId || commandId.length > 160) {
    fail("WORKFORCE_INVITATION_COMMAND_REQUIRED", "A stable invitation save identifier is required.", null, 400);
  }
  const payloadHash = crypto.createHash("sha256").update(JSON.stringify({ personObjectId: person.objectId, email })).digest("hex");
  const token = invitationToken({ entityId: actor.entityId, personObjectId: person.objectId, commandId });
  const id = `wfi-${crypto.createHash("sha256").update(`${actor.entityId}\n${commandId}`).digest("hex").slice(0, 24)}`;
  const record = repo.createInvitation({
    entityId: actor.entityId,
    actorId: actor.actorId,
    commandId,
    payloadHash,
    invitation: {
      id,
      personObjectId: person.objectId,
      personName: clean(person.displayName),
      email,
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      profileRevision: profile.revision,
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      status: "pending"
    }
  });
  return { invitation: scrubInvitation(record), token };
}

function revokeInvitation(context, invitationId, input = {}) {
  const actor = requireOwner(context);
  const invitation = repo.getInvitation(actor.entityId, clean(invitationId));
  if (!invitation || invitation.status !== "pending") {
    fail("WORKFORCE_INVITATION_UNAVAILABLE", "This invitation is no longer pending.", null, 409);
  }
  return {
    invitation: scrubInvitation(repo.updateInvitation({
      entityId: actor.entityId,
      invitationId: invitation.id,
      actorId: actor.actorId,
      expectedRevision: Number(input.revision || invitation.revision),
      patch: { status: "revoked", revokedAt: new Date().toISOString() },
      action: "invitation-revoked"
    }))
  };
}

function acceptInvitation(context, input = {}) {
  if (!context?.authenticated || !clean(context.principalId) || input.verifiedEmail !== true) {
    fail("WORKFORCE_VERIFIED_EMAIL_REQUIRED", "Sign in with the verified invited email address.", null, 401);
  }
  const entityId = clean(input.entityId);
  const invitationId = clean(input.id);
  const token = clean(input.token);
  const invitation = repo.getInvitation(entityId, invitationId);
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const email = clean(input.email).toLowerCase();
  if (!invitation || !token || tokenHash !== invitation.tokenHash || invitation.email !== email ||
      invitation.status === "revoked" || Date.parse(invitation.expiresAt) < Date.now() ||
      (invitation.acceptedBy && invitation.acceptedBy !== clean(context.principalId))) {
    fail("WORKFORCE_INVITATION_UNAVAILABLE", "This invitation is invalid, expired, revoked, or belongs to another email.", null, 403);
  }

  const accounts = readJsonFile(MOS_PATHS.accounts, {});
  const account = Object.values(accounts).find(item => clean(item.primaryEntityId) === entityId && clean(item.status) === "active");
  if (!account) fail("WORKFORCE_INVITATION_UNAVAILABLE", "This Entity is unavailable.", null, 403);
  const { person, identity } = resolvePerson(entityId, invitation.personObjectId);
  const profile = repo.getProfile(entityId, person.objectId);
  if (!profile?.configured || profile.accessEnabled !== true) {
    fail("WORKFORCE_INVITATION_DISABLED", "The owner has not enabled this Person's System Access.", null, 403);
  }

  const memberships = readJsonFile(MOS_PATHS.memberships, {});
  const membershipId = `workforce-${invitationId}`;
  const conflicts = Object.values(memberships).filter(item =>
    clean(item.entityId) === entityId &&
    (clean(item.principalId) === clean(context.principalId) || clean(item.personObjectId) === person.objectId) &&
    clean(item.membershipId) !== membershipId
  );
  if (conflicts.length) {
    fail("WORKFORCE_MEMBERSHIP_EXISTS", "This login or Person is already bound to an Entity membership.", null, 409);
  }

  const access = membershipAccess(profile);
  if (!memberships[membershipId]) {
    const now = new Date().toISOString();
    memberships[membershipId] = {
      membershipId,
      accountId: account.accountId,
      tenantId: account.tenantId,
      entityId,
      principalType: "sharetribe-user",
      principalId: clean(context.principalId),
      role: "member",
      roleIds: access.roles,
      status: "active",
      permissions: access.grants,
      directGrants: access.grants,
      directDenies: [],
      personObjectId: person.objectId,
      personPassportId: identity.passportId,
      entityPassportId: resolveEntityPassport(entityId).entityPassportId,
      machineScope: access.machineScope,
      financialRole: access.financialRole,
      calendar: access.calendar,
      salesDesk: {
        ...access.salesDesk,
        name: clean(person.displayName),
        invitationId,
        updatedBy: account.ownerUserId,
        updatedAt: now
      },
      accessProfileRevision: profile.revision,
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    };
    writeJsonFileAtomic(MOS_PATHS.memberships, memberships);
  }

  if (invitation.status !== "accepted") {
    repo.updateInvitation({
      entityId,
      invitationId,
      actorId: clean(context.principalId),
      expectedRevision: invitation.revision,
      patch: { status: "accepted", acceptedBy: clean(context.principalId), acceptedAt: new Date().toISOString() },
      action: "invitation-accepted"
    });
  }
  return { entityId, personObjectId: person.objectId, personPassportId: identity.passportId };
}

module.exports = {
  ASSET_OBJECT_TYPES,
  requireOwner,
  defaultProfile,
  ownerProfile,
  normalizeProfile,
  membershipAccess,
  getPersonAccess,
  savePersonAccess,
  createInvitation,
  revokeInvitation,
  acceptInvitation
};
