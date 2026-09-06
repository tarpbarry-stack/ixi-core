"use strict";

const {
  ensureAosAccount,
  bindOwnerMembershipIdentity
} = require("../accounts/aosAccountService");

const {
  getObject,
  listObjects,
  updateObject,
  restoreObject
} = require("../objects/objectService");

const {
  provisionAosObject
} = require("../provisioning/aosObjectProvisioningService");

const {
  ensureEntityPassport,
  ensurePersonPassport
} = require("../../identity/IXIPassportIdentityBridge");

const {
  bindPassportSource
} = require("../../passport/passportRegistry");

const {
  cleanText
} = require("../util/normalize");

const {
  MosError
} = require("../errors/MosError");

const CONTRACT = "ixi-commercial-onboarding-v1";

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function findPersonForPrincipal({ entityId, principalId }) {
  return listObjects({ entityId, status: "active" }).find(object =>
    cleanText(object?.objectType) === "person" &&
    (Array.isArray(object?.identities) ? object.identities : []).some(identity =>
      cleanText(identity?.sourceType) === "sharetribe-user" &&
      cleanText(identity?.sourceId) === principalId
    )
  ) || null;
}

function ensureOwnerPerson({
  entityId,
  principalId,
  membership,
  displayName,
  firstName,
  lastName,
  email,
  phone
}) {
  const directlyLinked = findPersonForPrincipal({ entityId, principalId });
  const explicitObjectId = cleanText(membership?.personObjectId);
  let existing = directlyLinked;

  if (!existing && explicitObjectId) {
    let explicit = getObject(explicitObjectId);
    if (
      cleanText(explicit?.entityId) !== entityId ||
      cleanText(explicit?.objectType) !== "person"
    ) {
      throw new MosError(
        "IXI_ONBOARDING_OWNER_PERSON_INVALID",
        "The owner membership references an invalid Person.",
        { entityId, personObjectId: explicitObjectId },
        409
      );
    }

    const belongsToPrincipal =
      explicit?.metadata?.onboarding?.principalId === principalId ||
      (Array.isArray(explicit?.identities) && explicit.identities.some(identity =>
        cleanText(identity?.sourceType) === "sharetribe-user" &&
        cleanText(identity?.sourceId) === principalId
      ));

    if (!belongsToPrincipal) {
      throw new MosError(
        "IXI_ONBOARDING_OWNER_PERSON_AUTHORITY_MISMATCH",
        "The owner membership Person is not bound to the authenticated principal.",
        { entityId, personObjectId: explicitObjectId },
        403
      );
    }

    if (explicit.status === "soft-deleted") {
      explicit = restoreObject({
        objectId: explicitObjectId,
        actorId: principalId,
        reason: "canonical-owner-onboarding-recovery"
      });
    }

    existing = explicit;
  }

  if (!existing && !explicitObjectId) {
    const people = listObjects({ entityId, status: "active" })
      .filter(object => cleanText(object?.objectType) === "person");
    if (people.length === 1) existing = people[0];
  }

  if (existing) {
    const identities = Array.isArray(existing.identities)
      ? [...existing.identities]
      : [];

    const hasPrincipalIdentity = identities.some(identity =>
      cleanText(identity?.sourceType) === "sharetribe-user" &&
      cleanText(identity?.sourceId) === principalId
    );

    const isDeclaredOwner =
      existing?.metadata?.onboarding?.relationship === "owner";

    if (!hasPrincipalIdentity) {
      identities.push({
        identityType: "external-principal",
        sourceType: "sharetribe-user",
        sourceId: principalId
      });
    }

    if (!hasPrincipalIdentity || !isDeclaredOwner) {
      existing = updateObject({
        objectId: existing.objectId,
        identities,
        actorId: principalId,
        metadata: {
          ...safeObject(existing.metadata),
          onboarding: {
            contract: CONTRACT,
            principalType: "sharetribe-user",
            principalId,
            relationship: "owner",
            adoptedExistingPerson: !directlyLinked
          }
        }
      });
    }

    const personIdentity = ensurePersonPassport({
      objectId: existing.objectId,
      expectedEntityId: entityId
    });

    bindPassportSource({
      passportId: personIdentity.actorPassportId,
      sourceType: "sharetribe-user",
      sourceId: principalId,
      entityId
    });

    return {
      created: false,
      object: existing,
      passport: personIdentity.passport,
      identity: {
        objectId: existing.objectId,
        passportId: personIdentity.actorPassportId
      }
    };
  }

  const personName =
    cleanText(displayName) ||
    cleanText(`${cleanText(firstName)} ${cleanText(lastName)}`) ||
    "IXI Owner";

  const result = provisionAosObject({
    contractVersion: "ixi-aos-object-provision-v1",
    commandId: `onboarding:person:${principalId}`,
    entityId,
    objectType: "person",
    displayName: personName,
    source: "sharetribe-onboarding",
    actorId: principalId,
    fields: {
      firstName: cleanText(firstName),
      lastName: cleanText(lastName),
      email: cleanText(email),
      phone: cleanText(phone),
      role: "OWNER"
    },
    identities: [{
      identityType: "external-principal",
      sourceType: "sharetribe-user",
      sourceId: principalId
    }],
    metadata: {
      onboarding: {
        contract: CONTRACT,
        principalType: "sharetribe-user",
        principalId,
        relationship: "owner"
      }
    }
  });

  const personIdentity = ensurePersonPassport({
    objectId: result.object.objectId,
    expectedEntityId: entityId
  });

  bindPassportSource({
    passportId: personIdentity.actorPassportId,
    sourceType: "sharetribe-user",
    sourceId: principalId,
    entityId
  });

  return {
    created: result.replayed !== true,
    object: result.object,
    passport: personIdentity.passport,
    identity: {
      objectId: result.object.objectId,
      passportId: personIdentity.actorPassportId
    }
  };
}

function ensureCommercialOnboarding({
  ownerUserId,
  entityDisplayName,
  person = {},
  metadata = {}
} = {}) {
  const principalId = cleanText(ownerUserId);

  if (!principalId) {
    throw new MosError(
      "IXI_ONBOARDING_PRINCIPAL_REQUIRED",
      "Authenticated Sharetribe user identity is required.",
      null,
      401
    );
  }

  const accountResult = ensureAosAccount({
    ownerUserId: principalId,
    displayName: cleanText(entityDisplayName) || "IXI Entity",
    metadata: {
      ...safeObject(metadata),
      onboardingContract: CONTRACT,
      authenticatedThrough: "sharetribe"
    }
  });

  const entityIdentity = ensureEntityPassport(
    accountResult.entity.entityId
  );

  bindPassportSource({
    passportId: entityIdentity.entityPassportId,
    sourceType: "sharetribe-entity-owner",
    sourceId: `${principalId}:${accountResult.entity.entityId}`,
    entityId: accountResult.entity.entityId
  });

  const ownerPerson = ensureOwnerPerson({
    entityId: accountResult.entity.entityId,
    principalId,
    membership: accountResult.membership,
    displayName: person.displayName,
    firstName: person.firstName,
    lastName: person.lastName,
    email: person.email,
    phone: person.phone
  });

  const membership = bindOwnerMembershipIdentity({
    accountId: accountResult.account.accountId,
    ownerUserId: principalId,
    personObjectId: ownerPerson.identity.objectId,
    personPassportId: ownerPerson.identity.passportId,
    entityPassportId: entityIdentity.entityPassportId
  });

  return {
    ok: true,
    contract: CONTRACT,
    account: accountResult.account,
    entity: accountResult.entity,
    person: ownerPerson.object,
    membership,
    passports: {
      entityPassportId: entityIdentity.entityPassportId,
      personPassportId: ownerPerson.identity.passportId
    },
    root: {
      rootScopeId: accountResult.entity.entityId,
      kind: "entity"
    },
    transact: {
      eligible: true,
      ready: true,
      entityPassportId: entityIdentity.entityPassportId,
      actorPassportId: ownerPerson.identity.passportId,
      defaultCurrency:
        accountResult.account?.settings?.defaultCurrency || "USD",
      recordsCreated: 0
    },
    created: {
      ...accountResult.created,
      person: ownerPerson.created
    }
  };
}

module.exports = {
  CONTRACT,
  findPersonForPrincipal,
  ensureCommercialOnboarding
};
