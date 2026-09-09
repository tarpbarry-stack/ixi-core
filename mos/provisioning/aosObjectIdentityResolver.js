"use strict";

const { cleanText } = require("../util/normalize");
const { MosError } = require("../errors/MosError");
const {
  normalizedPassportIds,
  resolveCanonicalObjectIdentity
} = require("../identity/canonicalObjectAdmissionService");

const PASSPORT_IDENTITY_TYPE = "ixi-passport";
const AOS_OBJECT_SOURCE_TYPE = "aos-object";

function passportIdentity(object = {}) {
  const passportId = normalizedPassportIds(object)[0] || "";
  if (!passportId) return null;

  return (Array.isArray(object.identities) ? object.identities : [])
    .find(identity =>
      cleanText(identity?.identityType || identity?.type).toLowerCase() ===
        PASSPORT_IDENTITY_TYPE &&
      cleanText(identity?.passportId || identity?.value || identity?.id) ===
        passportId
    ) || { identityType: PASSPORT_IDENTITY_TYPE, passportId };
}

/*
 * Compatibility export for existing callers. Resolution never provisions.
 * Freight creation is a transaction boundary, not an Object-birth boundary.
 */
function resolveOrProvisionAosObjectForPassport({
  passportId = "",
  objectId = "",
  entityId = "",
  source = {},
  provisionIfMissing = false
} = {}) {
  if (provisionIfMissing) {
    throw new MosError(
      "CANONICAL_CREATION_BOUNDARY_REQUIRED",
      "This operation cannot create an Object or Passport while resolving identity.",
      {
        passportId: cleanText(passportId) || null,
        objectId: cleanText(objectId) || null,
        sourceType: cleanText(source?.sourceType || source?.type) || null,
        sourceId: cleanText(source?.sourceId || source?.id) || null
      },
      409
    );
  }

  const admitted = resolveCanonicalObjectIdentity({
    passportId,
    objectId,
    entityId,
    sourceType: source?.sourceType || source?.type,
    sourceId: source?.sourceId || source?.id
  });

  return admitted.object;
}

module.exports = {
  PASSPORT_IDENTITY_TYPE,
  AOS_OBJECT_SOURCE_TYPE,
  passportIdentity,
  resolveOrProvisionAosObjectForPassport
};
