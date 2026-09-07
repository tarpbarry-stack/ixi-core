"use strict";

const {
  readJsonFile,
  writeJsonFileAtomic
} = require("../storage/jsonStore");

const { MOS_PATHS } = require("../storage/mosPaths");
const { getObject, updateObject } = require("../objects/objectService");
const {
  readPassportRecords,
  writePassportRecords,
  findPassportById,
  reassignPassportId
} = require("../../passport/passportRegistry");
const {
  isValidPassportId,
  normalizePassportId
} = require("../../passport/passportSnEngine");
const { cleanText } = require("../util/normalize");
const { MosError } = require("../errors/MosError");

function listOwnerPassportCandidates() {
  const memberships = readJsonFile(MOS_PATHS.memberships, {});
  return Object.values(memberships)
    .filter(membership => membership?.status === "active" && membership?.role === "owner")
    .map(membership => {
      let person = null;
      try {
        person = membership.personObjectId ? getObject(membership.personObjectId) : null;
      } catch {
        person = null;
      }
      return {
        membershipId: membership.membershipId,
        principalId: membership.principalId,
        entityId: membership.entityId,
        personObjectId: membership.personObjectId || null,
        personName: person?.displayName || null,
        currentPassportId: membership.personPassportId || null
      };
    });
}

function claimOwnerPassport({ principalId, requestedPassportId, actorId = "ixi-maintenance" }) {
  const normalizedPrincipalId = cleanText(principalId);
  const requestedId = normalizePassportId(requestedPassportId);
  if (!normalizedPrincipalId || !isValidPassportId(requestedId)) {
    throw new MosError(
      "AOS_OWNER_PASSPORT_CLAIM_INVALID",
      "An exact owner principal and valid requested IXI Passport are required.",
      null,
      400
    );
  }

  const memberships = readJsonFile(MOS_PATHS.memberships, {});
  const matches = Object.values(memberships).filter(membership =>
    membership?.status === "active" &&
    membership?.role === "owner" &&
    cleanText(membership?.principalId) === normalizedPrincipalId
  );
  if (matches.length !== 1) {
    throw new MosError(
      "AOS_OWNER_PASSPORT_CLAIM_AMBIGUOUS",
      "The owner principal must resolve to exactly one active owner membership.",
      { principalId: normalizedPrincipalId, matches: matches.length },
      409
    );
  }

  const membership = matches[0];
  const person = getObject(membership.personObjectId);
  if (
    cleanText(person?.entityId) !== cleanText(membership.entityId) ||
    cleanText(person?.objectType) !== "person" ||
    person?.status !== "active" ||
    !(Array.isArray(person?.identities) ? person.identities : []).some(identity =>
      cleanText(identity?.sourceType) === "sharetribe-user" &&
      cleanText(identity?.sourceId) === normalizedPrincipalId
    )
  ) {
    throw new MosError(
      "AOS_OWNER_PASSPORT_PERSON_INVALID",
      "The selected owner membership is not bound to one active canonical Person.",
      {
        membershipId: membership.membershipId,
        personObjectId: membership.personObjectId || null
      },
      409
    );
  }

  const currentId = normalizePassportId(membership.personPassportId);
  if (!isValidPassportId(currentId)) {
    throw new MosError(
      "AOS_OWNER_CURRENT_PASSPORT_INVALID",
      "The owner membership does not contain a valid current IXI Passport.",
      { membershipId: membership.membershipId },
      409
    );
  }

  const collision = findPassportById(requestedId);
  if (collision && collision.passportId !== currentId) {
    throw new MosError(
      "AOS_OWNER_REQUESTED_PASSPORT_CONFLICT",
      "The requested IXI Passport is already assigned.",
      { requestedPassportId: requestedId },
      409
    );
  }

  const passportSnapshot = readPassportRecords();
  const membershipSnapshot = { ...membership };
  const objectsSnapshot = readJsonFile(MOS_PATHS.objects, {});

  try {
    const reassigned = reassignPassportId({
      currentPassportId: currentId,
      requestedPassportId: requestedId,
      expectedEntityId: membership.entityId
    });

    const identities = [
      ...(Array.isArray(person.identities) ? person.identities : []).filter(identity =>
        cleanText(identity?.identityType) !== "ixi-passport"
      ),
      {
        identityType: "ixi-passport",
        passportId: requestedId,
        entityId: membership.entityId,
        sourceType: "aos-object",
        sourceId: person.objectId
      }
    ];
    updateObject({
      objectId: person.objectId,
      identities,
      actorId,
      metadata: {
        ...(person.metadata || {}),
        passportIdentity: {
          state: "complete",
          passportId: requestedId,
          verified: true,
          reassignedFrom: currentId
        }
      }
    });

    memberships[membership.membershipId] = {
      ...membership,
      personPassportId: requestedId,
      updatedAt: new Date().toISOString()
    };
    writeJsonFileAtomic(MOS_PATHS.memberships, memberships);

    return {
      ok: true,
      changed: reassigned.changed,
      principalId: normalizedPrincipalId,
      personObjectId: person.objectId,
      previousPassportId: currentId,
      passportId: requestedId
    };
  } catch (error) {
    writePassportRecords(passportSnapshot);
    writeJsonFileAtomic(MOS_PATHS.objects, objectsSnapshot);
    const rollbackMemberships = readJsonFile(MOS_PATHS.memberships, {});
    rollbackMemberships[membershipSnapshot.membershipId] = membershipSnapshot;
    writeJsonFileAtomic(MOS_PATHS.memberships, rollbackMemberships);
    throw error;
  }
}

module.exports = {
  listOwnerPassportCandidates,
  claimOwnerPassport
};
