"use strict";

const {
  listObjects,
  updateObject
} = require("../objects/objectService");

const {
  provisionAosObject
} = require("./aosObjectProvisioningService");

const {
  ensurePassportForAosObject,
  verifyAosObjectPassport
} = require("./aosObjectPassportService");

const {
  findPassportBySource
} = require("../../passport/passportRegistry");

const {
  cleanText
} = require("../util/normalize");

const {
  MosError
} = require("../errors/MosError");

const SYSTEM_INDEXES = Object.freeze([
  Object.freeze({
    key: "equipment",
    displayName: "EQUIPMENT",
    adapterId: "ixi-owned-equipment"
  }),
  Object.freeze({
    key: "for-sale",
    displayName: "FOR SALE",
    adapterId: "ixi-for-sale"
  })
]);

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function passportIdentities(object) {
  return (Array.isArray(object?.identities) ? object.identities : [])
    .filter(identity => cleanText(identity?.identityType) === "ixi-passport");
}

function findSystemIndex(objects, definition) {
  return objects.find(object =>
    cleanText(object?.objectType) === "system-index" &&
    (
      cleanText(object?.metadata?.adapterId) === definition.adapterId ||
      cleanText(object?.metadata?.systemIndexKey) === definition.key
    )
  ) || null;
}

function ensureCanonicalSystemIndexes({ entityId, actorId }) {
  const existing = listObjects({ entityId, status: "active" });

  return SYSTEM_INDEXES.map(definition => {
    const found = findSystemIndex(existing, definition);

    if (found) {
      const metadata = safeObject(found.metadata);
      const isCanonical =
        cleanText(metadata.adapterId) === definition.adapterId &&
        cleanText(metadata.systemIndexKey) === definition.key &&
        metadata.systemIndex === true &&
        metadata.systemAdapter === true &&
        metadata.systemIndexPresentation === true;

      return isCanonical
        ? found
        : updateObject({
            objectId: found.objectId,
            actorId,
            metadata: {
              ...metadata,
              systemIndex: true,
              systemAdapter: true,
              systemIndexKey: definition.key,
              adapterId: definition.adapterId,
              systemIndexPresentation: true,
              canonicalMosContainer: false
            }
          });
    }

    return provisionAosObject({
      contractVersion: "ixi-aos-object-provision-v1",
      commandId: `onboarding:system-index:${definition.key}:${entityId}`,
      entityId,
      objectType: "system-index",
      displayName: definition.displayName,
      source: "ixi-system-index-bootstrap",
      actorId,
      metadata: {
        systemIndex: true,
        systemAdapter: true,
        systemIndexKey: definition.key,
        adapterId: definition.adapterId,
        systemIndexPresentation: true,
        canonicalMosContainer: false
      }
    }).object;
  });
}

function ensureCanonicalObjectPassport({ object, actorId }) {
  const identities = passportIdentities(object);
  const distinctPassportIds = [...new Set(
    identities.map(identity => cleanText(identity?.passportId)).filter(Boolean)
  )];

  if (distinctPassportIds.length > 1) {
    throw new MosError(
      "AOS_OBJECT_MULTIPLE_PASSPORTS",
      "A canonical AOS record cannot reference multiple IXI Passports.",
      { objectId: object.objectId, passportIds: distinctPassportIds },
      409
    );
  }

  const personPassport = cleanText(object.objectType) === "person"
    ? findPassportBySource("mos-person", object.objectId)
    : null;

  const trustedPassportId =
    distinctPassportIds[0] || cleanText(personPassport?.passportId);

  const result = ensurePassportForAosObject({
    objectId: object.objectId,
    entityId: object.entityId,
    trustedPassportId
  });

  if (
    trustedPassportId &&
    cleanText(result?.passport?.passportId) !== trustedPassportId
  ) {
    throw new MosError(
      "AOS_OBJECT_PASSPORT_CONFLICT",
      "The AOS Object and Passport registry disagree about canonical identity.",
      {
        objectId: object.objectId,
        expectedPassportId: trustedPassportId,
        actualPassportId: cleanText(result?.passport?.passportId) || null
      },
      409
    );
  }

  let current = object;

  const currentPassportIdentities = passportIdentities(current);
  const expected = result.identity;
  const identityIsCanonical =
    currentPassportIdentities.length === 1 &&
    cleanText(currentPassportIdentities[0]?.passportId) === expected.passportId &&
    cleanText(currentPassportIdentities[0]?.entityId) === expected.entityId &&
    cleanText(currentPassportIdentities[0]?.sourceType) === expected.sourceType &&
    cleanText(currentPassportIdentities[0]?.sourceId) === expected.sourceId;

  const metadataIsCanonical =
    current?.metadata?.transactEligible === true &&
    current?.metadata?.passportIdentity?.state === "complete" &&
    cleanText(current?.metadata?.passportIdentity?.passportId) ===
      cleanText(result?.passport?.passportId) &&
    current?.metadata?.passportIdentity?.verified === true;

  if (!identityIsCanonical || !metadataIsCanonical) {
    current = updateObject({
      objectId: current.objectId,
      actorId,
      identities: [
        ...(Array.isArray(current.identities) ? current.identities : [])
          .filter(identity => cleanText(identity?.identityType) !== "ixi-passport"),
        expected
      ],
      metadata: {
        ...safeObject(current.metadata),
        transactEligible: true,
        passportIdentity: {
          state: "complete",
          passportId: result.passport.passportId,
          verified: true
        }
      }
    });
  }

  verifyAosObjectPassport({
    objectId: current.objectId,
    passportId: result.passport.passportId,
    entityId: current.entityId
  });

  return current;
}

function enforceEntityPassportIntegrity({ entityId, actorId }) {
  const systemIndexes = ensureCanonicalSystemIndexes({ entityId, actorId });
  const activeObjects = listObjects({ entityId, status: "active" });
  const repaired = activeObjects.map(object =>
    ensureCanonicalObjectPassport({ object, actorId })
  );

  return {
    ok: true,
    entityId,
    activeObjectCount: repaired.length,
    systemIndexObjectIds: systemIndexes.map(object => object.objectId),
    objects: repaired
  };
}

module.exports = {
  SYSTEM_INDEXES,
  ensureCanonicalSystemIndexes,
  ensureCanonicalObjectPassport,
  enforceEntityPassportIntegrity
};
