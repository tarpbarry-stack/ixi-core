"use strict";

const {
  readPassportRecords,
  passportSources
} = require("../../passport/passportRegistry");

const {
  listObjects
} = require("../objects/objectService");

const { MosError } = require("../errors/MosError");
const { cleanText } = require("../util/normalize");

const PASSPORT_IDENTITY_TYPES = new Set([
  "ixi-passport",
  "passport"
]);

function fail(code, message, details = null, status = 409) {
  throw new MosError(code, message, details, status);
}

function normalizedPassportIds(value = {}) {
  const identities = Array.isArray(value?.identities)
    ? value.identities
    : [];

  return [...new Set([
    value?.passportId,
    value?.ixiPassportId,
    value?.passportIdentity?.passportId,
    value?.passport?.passportId,
    value?.metadata?.passportIdentity?.passportId,
    ...identities
      .filter(identity => PASSPORT_IDENTITY_TYPES.has(
        cleanText(identity?.identityType || identity?.type || identity?.kind)
          .toLowerCase()
      ))
      .map(identity => identity?.passportId || identity?.value || identity?.id)
  ].map(cleanText).filter(Boolean))];
}

function normalizedAliases(value = {}) {
  const metadata = value?.metadata && typeof value.metadata === "object"
    ? value.metadata
    : {};
  const provisioning = metadata?.provisioning && typeof metadata.provisioning === "object"
    ? metadata.provisioning
    : value?.provisioning && typeof value.provisioning === "object"
      ? value.provisioning
      : {};
  const identities = Array.isArray(value?.identities)
    ? value.identities
    : [];
  const aliases = Array.isArray(value?.aliases)
    ? value.aliases
    : [];
  const sourceBindings = [
    ...(Array.isArray(value?.sourceBindings) ? value.sourceBindings : []),
    ...(Array.isArray(metadata?.sourceBindings) ? metadata.sourceBindings : []),
    ...(Array.isArray(provisioning?.sourceBindings) ? provisioning.sourceBindings : []),
    ...(Array.isArray(value?.historicalSourceBindings)
      ? value.historicalSourceBindings
      : []),
    ...(Array.isArray(metadata?.historicalSourceBindings)
      ? metadata.historicalSourceBindings
      : [])
  ];

  const candidates = [
    ...identities,
    ...aliases,
    ...sourceBindings,
    value?.sourceType || value?.sourceId
      ? { sourceType: value.sourceType, sourceId: value.sourceId }
      : null,
    value?.sourceListingId
      ? { sourceType: "sharetribe-listing", sourceId: value.sourceListingId }
      : null,
    metadata?.sourceListingId
      ? { sourceType: "sharetribe-listing", sourceId: metadata.sourceListingId }
      : null,
    provisioning?.sourceListingId
      ? { sourceType: "sharetribe-listing", sourceId: provisioning.sourceListingId }
      : null
  ].filter(Boolean).map(identity => ({
    sourceType: cleanText(
      identity?.sourceType ||
      identity?.identityType ||
      identity?.type ||
      identity?.kind
    ),
    sourceId: cleanText(
      identity?.sourceId ||
      identity?.identityId ||
      identity?.externalId ||
      identity?.value ||
      identity?.id
    )
  }));
  const seen = new Set();

  return candidates.filter(alias => {
    if (!alias.sourceType || !alias.sourceId) return false;
    const key = `${alias.sourceType}\u0000${alias.sourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function requestedAliases(input = {}) {
  const candidates = [
    ...(Array.isArray(input.aliases) ? input.aliases : []),
    input.sourceType || input.sourceId
      ? { sourceType: input.sourceType, sourceId: input.sourceId }
      : null
  ].filter(Boolean).map(alias => ({
    sourceType: cleanText(alias?.sourceType || alias?.type),
    sourceId: cleanText(alias?.sourceId || alias?.id)
  }));

  for (const alias of candidates) {
    if (!alias.sourceType || !alias.sourceId) {
      fail(
        "CANONICAL_ALIAS_INVALID",
        "Canonical identity aliases require both sourceType and sourceId.",
        { alias },
        400
      );
    }
  }

  const seen = new Set();
  return candidates.filter(alias => {
    const key = `${alias.sourceType}\u0000${alias.sourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function passportMatchesId(passport, passportId) {
  return cleanText(passport?.passportId) === passportId ||
    (Array.isArray(passport?.previousPassportIds)
      ? passport.previousPassportIds.map(cleanText).includes(passportId)
      : false);
}

function aliasKey(alias) {
  return `${alias.sourceType}\u0000${alias.sourceId}`;
}

function resolveCanonicalObjectIdentity(input = {}) {
  const entityId = cleanText(input.entityId);
  const objectId = cleanText(input.objectId);
  const passportId = cleanText(input.passportId);
  const aliases = requestedAliases(input);

  if (!entityId) {
    fail(
      "CANONICAL_ENTITY_REQUIRED",
      "Canonical identity admission requires an authenticated Entity.",
      null,
      401
    );
  }

  if (!objectId && !passportId && !aliases.length) {
    fail(
      "CANONICAL_IDENTITY_REQUIRED",
      "Canonical identity admission requires an Object ID, Passport, or typed alias.",
      null,
      400
    );
  }

  const objects = listObjects({ status: null });
  const passports = readPassportRecords();
  const objectsById = new Map(objects.map(object => [cleanText(object.objectId), object]));
  const objectPassportIds = new Map(objects.map(object => [
    cleanText(object.objectId),
    normalizedPassportIds(object)
  ]));
  const objectAliases = new Map(objects.map(object => [
    cleanText(object.objectId),
    new Set(normalizedAliases(object).map(aliasKey))
  ]));

  const matchedPassportIds = new Set();
  const matchedObjectIds = new Set();
  const evidence = [];

  if (objectId) {
    if (!objectsById.has(objectId)) {
      fail(
        "CANONICAL_OBJECT_NOT_FOUND",
        "The supplied Object ID is not a canonical IX-Core object.",
        { objectId },
        404
      );
    }
    matchedObjectIds.add(objectId);
    evidence.push({ kind: "object-id", value: objectId, objectIds: [objectId] });
  }

  if (passportId) {
    const passportMatches = passports.filter(passport =>
      passportMatchesId(passport, passportId)
    );
    if (!passportMatches.length) {
      fail(
        "CANONICAL_PASSPORT_NOT_FOUND",
        "The supplied Passport does not resolve in the IX-Core registry.",
        { passportId },
        404
      );
    }
    if (passportMatches.length > 1) {
      fail(
        "CANONICAL_PASSPORT_CONFLICT",
        "The supplied Passport resolves to multiple registry records.",
        { passportId, passportIds: passportMatches.map(item => item.passportId) }
      );
    }
    matchedPassportIds.add(passportMatches[0].passportId);
    evidence.push({
      kind: passportMatches[0].passportId === passportId
        ? "passport-id"
        : "historical-passport-id",
      value: passportId,
      passportIds: [passportMatches[0].passportId]
    });
  }

  for (const alias of aliases) {
    const key = aliasKey(alias);
    const passportMatches = passports.filter(passport =>
      passportSources(passport).some(source => aliasKey(source) === key)
    );
    const objectMatches = objects.filter(object =>
      objectAliases.get(object.objectId)?.has(key)
    );

    if (!passportMatches.length && !objectMatches.length) {
      fail(
        "CANONICAL_ALIAS_NOT_FOUND",
        "The supplied alias does not resolve to an IX-Core identity.",
        { alias },
        404
      );
    }
    if (passportMatches.length > 1) {
      fail(
        "CANONICAL_ALIAS_CONFLICT",
        "The supplied alias is bound to multiple Passports.",
        { alias, passportIds: passportMatches.map(item => item.passportId) }
      );
    }

    passportMatches.forEach(passport => matchedPassportIds.add(passport.passportId));
    objectMatches.forEach(object => matchedObjectIds.add(object.objectId));
    evidence.push({
      kind: "typed-alias",
      value: alias,
      passportIds: passportMatches.map(item => item.passportId),
      objectIds: objectMatches.map(item => item.objectId)
    });
  }

  for (const matchedPassportId of [...matchedPassportIds]) {
    for (const passport of passports.filter(item => item.passportId === matchedPassportId)) {
      passportSources(passport)
        .filter(source => source.sourceType === "aos-object")
        .forEach(source => matchedObjectIds.add(source.sourceId));
    }
    for (const [candidateObjectId, ids] of objectPassportIds.entries()) {
      if (ids.includes(matchedPassportId)) matchedObjectIds.add(candidateObjectId);
    }
  }

  for (const matchedObjectId of [...matchedObjectIds]) {
    for (const id of objectPassportIds.get(matchedObjectId) || []) {
      const passportMatches = passports.filter(passport => passportMatchesId(passport, id));
      if (passportMatches.length > 1) {
        fail(
          "CANONICAL_PASSPORT_CONFLICT",
          "An Object Passport resolves to multiple registry records.",
          { objectId: matchedObjectId, passportId: id }
        );
      }
      passportMatches.forEach(passport => matchedPassportIds.add(passport.passportId));
    }
    for (const passport of passports) {
      if (passportSources(passport).some(source =>
        source.sourceType === "aos-object" && source.sourceId === matchedObjectId
      )) {
        matchedPassportIds.add(passport.passportId);
      }
    }
  }

  const candidateObjects = [...matchedObjectIds]
    .map(id => objectsById.get(id))
    .filter(Boolean);
  const missingObjectIds = [...matchedObjectIds].filter(id => !objectsById.has(id));

  if (missingObjectIds.length) {
    fail(
      "CANONICAL_IDENTITY_REPAIR_REQUIRED",
      "A Passport references an Object that is missing from IX-Core.",
      { missingObjectIds, passportIds: [...matchedPassportIds] }
    );
  }

  const activeObjects = candidateObjects.filter(object => object.status === "active");
  const foreignCandidateObjects = candidateObjects.filter(object =>
    cleanText(object.entityId) !== entityId
  );

  if (foreignCandidateObjects.length) {
    fail(
      "CANONICAL_ENTITY_MISMATCH",
      "Identity lineage includes an Object from a different Entity.",
      {
        expectedEntityId: entityId,
        objectIds: candidateObjects.map(object => object.objectId),
        foreignObjectIds: foreignCandidateObjects.map(object => object.objectId),
        passportIds: [...matchedPassportIds],
        evidence
      },
      403
    );
  }

  if (activeObjects.length !== 1) {
    fail(
      activeObjects.length > 1
        ? "CANONICAL_IDENTITY_CONFLICT"
        : "CANONICAL_IDENTITY_REPAIR_REQUIRED",
      activeObjects.length > 1
        ? "Identity references resolve to multiple canonical Objects."
        : "Identity references do not resolve to one active canonical Object.",
      {
        objectIds: candidateObjects.map(object => object.objectId),
        activeObjectIds: activeObjects.map(object => object.objectId),
        passportIds: [...matchedPassportIds],
        evidence
      }
    );
  }

  const object = activeObjects[0];
  if (objectId && object.objectId !== objectId) {
    fail(
      "CANONICAL_IDENTITY_CONFLICT",
      "The supplied Object ID is historical and does not identify the active canonical Object.",
      {
        suppliedObjectId: objectId,
        activeObjectId: object.objectId,
        objectIds: candidateObjects.map(candidate => candidate.objectId),
        passportIds: [...matchedPassportIds],
        evidence
      }
    );
  }

  if (cleanText(object.entityId) !== entityId) {
    fail(
      "CANONICAL_ENTITY_MISMATCH",
      "The resolved Object belongs to a different Entity.",
      { objectId: object.objectId, expectedEntityId: entityId, actualEntityId: object.entityId },
      403
    );
  }

  const canonicalPassports = passports.filter(passport =>
    matchedPassportIds.has(passport.passportId) ||
    passportSources(passport).some(source =>
      source.sourceType === "aos-object" && source.sourceId === object.objectId
    ) ||
    normalizedPassportIds(object).some(id => passportMatchesId(passport, id))
  );
  const distinctPassportIds = [...new Set(canonicalPassports.map(item => item.passportId))];

  if (distinctPassportIds.length !== 1) {
    fail(
      distinctPassportIds.length > 1
        ? "CANONICAL_IDENTITY_CONFLICT"
        : "CANONICAL_IDENTITY_REPAIR_REQUIRED",
      distinctPassportIds.length > 1
        ? "The canonical Object resolves to multiple permanent Passports."
        : "The canonical Object has no verified permanent Passport.",
      { objectId: object.objectId, passportIds: distinctPassportIds, evidence }
    );
  }

  const passport = canonicalPassports.find(item => item.passportId === distinctPassportIds[0]);
  const passportEntityId = cleanText(passport?.entityId);
  if (passportEntityId && passportEntityId !== entityId) {
    fail(
      "CANONICAL_ENTITY_MISMATCH",
      "The resolved Passport belongs to a different Entity.",
      {
        objectId: object.objectId,
        passportId: passport.passportId,
        expectedEntityId: entityId,
        actualEntityId: passportEntityId
      },
      403
    );
  }

  const objectSidePassportIds = normalizedPassportIds(object);
  const hasObjectSource = passportSources(passport).some(source =>
    source.sourceType === "aos-object" && source.sourceId === object.objectId
  );
  if (
    objectSidePassportIds.length !== 1 ||
    objectSidePassportIds[0] !== passport.passportId ||
    !hasObjectSource
  ) {
    fail(
      "CANONICAL_IDENTITY_REPAIR_REQUIRED",
      "Object and Passport identity bindings are incomplete or inconsistent.",
      {
        objectId: object.objectId,
        passportId: passport.passportId,
        objectSidePassportIds,
        hasObjectSource
      }
    );
  }

  return {
    ok: true,
    objectId: object.objectId,
    passportId: passport.passportId,
    entityId,
    object,
    passport,
    aliases: normalizedAliases({
      identities: [
        ...passportSources(passport),
        ...normalizedAliases(object)
      ]
    }),
    evidence
  };
}

module.exports = {
  normalizedPassportIds,
  normalizedAliases,
  resolveCanonicalObjectIdentity
};
