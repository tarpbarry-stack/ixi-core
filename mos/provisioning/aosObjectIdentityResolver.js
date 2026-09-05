"use strict";

const {
  findPassportById,
  passportSources,
  bindPassportSource
} = require("../../passport/passportRegistry");

const {
  createObject,
  getObject,
  listObjects,
  updateObject
} = require("../objects/objectService");

const { MosError } = require("../errors/MosError");
const { cleanText } = require("../util/normalize");

const PASSPORT_IDENTITY_TYPE = "ixi-passport";
const AOS_OBJECT_SOURCE_TYPE = "aos-object";

function passportIdentity(object = {}) {
  return (Array.isArray(object.identities) ? object.identities : [])
    .find(identity =>
      cleanText(identity?.identityType || identity?.type) === PASSPORT_IDENTITY_TYPE
    ) || null;
}

function throwIdentityError(code, message, details = null, status = 409) {
  const error = new MosError(code, message, details, status);
  error.status = status;
  throw error;
}

function assertEntity(value, entityId, details = {}) {
  const actualEntityId = cleanText(value?.entityId);
  if (actualEntityId && actualEntityId !== entityId) {
    throwIdentityError(
      "OBJECT_ENTITY_MISMATCH",
      "Resolved asset does not belong to the authenticated Entity.",
      { ...details, expectedEntityId: entityId, actualEntityId },
      403
    );
  }
}

function findBoundObject(passportId) {
  const matches = listObjects({ status: null })
    .filter(object => cleanText(passportIdentity(object)?.passportId) === passportId);

  if (matches.length > 1) {
    throwIdentityError(
      "PASSPORT_OBJECT_CONFLICT",
      "IXI Passport is bound to more than one MOS Object.",
      { passportId, objectIds: matches.map(object => object.objectId) },
      409
    );
  }

  return matches[0] || null;
}

function sourceMatchesPassport(passport, source = {}) {
  const sourceType = cleanText(source.sourceType || source.type);
  const sourceId = cleanText(source.sourceId || source.id);
  if (!sourceType || !sourceId) return false;

  return passportSources(passport).some(candidate =>
    candidate.sourceType === sourceType && candidate.sourceId === sourceId
  );
}

function bindObjectPassport({ object, passport, entityId, actorId }) {
  const existingIdentity = passportIdentity(object);

  if (
    existingIdentity?.passportId &&
    cleanText(existingIdentity.passportId) !== passport.passportId
  ) {
    throwIdentityError(
      "PASSPORT_OBJECT_MISMATCH",
      "MOS Object is already bound to a different IXI Passport.",
      {
        objectId: object.objectId,
        passportId: passport.passportId,
        boundPassportId: cleanText(existingIdentity.passportId)
      },
      409
    );
  }

  let resolvedObject = object;
  if (!existingIdentity) {
    resolvedObject = updateObject({
      objectId: object.objectId,
      actorId,
      identities: [
        ...(Array.isArray(object.identities) ? object.identities : []),
        {
          identityType: PASSPORT_IDENTITY_TYPE,
          passportId: passport.passportId,
          entityId,
          sourceType: AOS_OBJECT_SOURCE_TYPE,
          sourceId: object.objectId
        }
      ]
    });
  }

  bindPassportSource({
    passportId: passport.passportId,
    sourceType: AOS_OBJECT_SOURCE_TYPE,
    sourceId: object.objectId,
    entityId
  });

  return resolvedObject;
}

function resolveOrProvisionAosObjectForPassport({
  passportId = "",
  objectId = "",
  entityId = "",
  actorId = "",
  source = {},
  asset = {},
  provisionIfMissing = false
} = {}) {
  const resolvedPassportId = cleanText(passportId);
  const resolvedObjectId = cleanText(objectId);
  const resolvedEntityId = cleanText(entityId);

  if (!resolvedPassportId) {
    throwIdentityError("PASSPORT_REQUIRED", "Machine IXI Passport is required.", null, 400);
  }
  if (!resolvedEntityId) {
    throwIdentityError("OBJECT_ENTITY_REQUIRED", "Authenticated Entity is required.", null, 401);
  }

  const passport = findPassportById(resolvedPassportId);
  if (!passport) {
    throwIdentityError(
      "PASSPORT_NOT_FOUND",
      "Machine IXI Passport was not found.",
      { passportId: resolvedPassportId },
      404
    );
  }

  assertEntity(passport, resolvedEntityId, { passportId: resolvedPassportId });

  let boundObject = findBoundObject(resolvedPassportId);

  if (boundObject) {
    assertEntity(boundObject, resolvedEntityId, {
      passportId: resolvedPassportId,
      objectId: boundObject.objectId
    });

    if (resolvedObjectId && boundObject.objectId !== resolvedObjectId) {
      throwIdentityError(
        "PASSPORT_OBJECT_MISMATCH",
        "Supplied MOS Object ID does not match the IXI Passport binding.",
        {
          passportId: resolvedPassportId,
          suppliedObjectId: resolvedObjectId,
          resolvedObjectId: boundObject.objectId
        },
        409
      );
    }

    return bindObjectPassport({
      object: boundObject,
      passport,
      entityId: resolvedEntityId,
      actorId
    });
  }

  if (resolvedObjectId) {
    let suppliedObject;
    try {
      suppliedObject = getObject(resolvedObjectId);
    } catch (error) {
      throwIdentityError(
        "PASSPORT_OBJECT_MISMATCH",
        "Supplied Object ID is not a canonical MOS Object for this IXI Passport.",
        { passportId: resolvedPassportId, suppliedObjectId: resolvedObjectId },
        409
      );
    }

    assertEntity(suppliedObject, resolvedEntityId, {
      passportId: resolvedPassportId,
      objectId: suppliedObject.objectId
    });

    const suppliedIdentity = passportIdentity(suppliedObject);
    throwIdentityError(
      "PASSPORT_OBJECT_MISMATCH",
      suppliedIdentity?.passportId
        ? "Supplied MOS Object is bound to a different IXI Passport."
        : "Supplied MOS Object has no verified binding to this IXI Passport.",
      {
        passportId: resolvedPassportId,
        suppliedObjectId: suppliedObject.objectId,
        boundPassportId: cleanText(suppliedIdentity?.passportId) || null
      },
      409
    );
  }

  if (!provisionIfMissing || !sourceMatchesPassport(passport, source)) {
    throwIdentityError(
      "PASSPORT_NOT_PROVISIONED",
      "Machine IXI Passport is not provisioned into MOS.",
      { passportId: resolvedPassportId },
      409
    );
  }

  const sourceType = cleanText(source.sourceType || source.type);
  const sourceId = cleanText(source.sourceId || source.id);
  const label = cleanText(asset.label) || `IXI MACHINE ${resolvedPassportId}`;

  const created = createObject({
    entityId: resolvedEntityId,
    objectType: cleanText(asset.objectType) || "machine",
    displayName: label,
    fields: {
      year: cleanText(asset.year),
      make: cleanText(asset.make),
      model: cleanText(asset.model),
      serialNumber: cleanText(asset.serialNumber),
      weight: Number(asset.weight || 0)
    },
    identities: [{
      identityType: PASSPORT_IDENTITY_TYPE,
      passportId: resolvedPassportId,
      entityId: resolvedEntityId,
      sourceType: AOS_OBJECT_SOURCE_TYPE,
      sourceId: "pending"
    }],
    source: sourceType,
    actorId,
    metadata: {
      sourceReference: sourceId,
      identityProvisioning: {
        mode: "passport-first",
        sourceType,
        sourceId,
        passportId: resolvedPassportId
      }
    }
  });

  const identities = (created.identities || []).map(identity =>
    cleanText(identity?.passportId) === resolvedPassportId
      ? { ...identity, sourceId: created.objectId }
      : identity
  );

  const completed = updateObject({
    objectId: created.objectId,
    actorId,
    identities
  });

  return bindObjectPassport({
    object: completed,
    passport,
    entityId: resolvedEntityId,
    actorId
  });
}

module.exports = {
  PASSPORT_IDENTITY_TYPE,
  AOS_OBJECT_SOURCE_TYPE,
  passportIdentity,
  resolveOrProvisionAosObjectForPassport
};
