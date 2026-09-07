"use strict";

const {
  findPassportBySource,
  bindPassportSource,
  passportSources
} = require("../../passport/passportRegistry");

const {
  getObject
} = require("../objects/objectService");

const {
  provisionAosObject
} = require("../provisioning/aosObjectProvisioningService");

const {
  cleanText
} = require("../util/normalize");

const {
  MosError
} = require("../errors/MosError");

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function reusableAosObjectId({ passport, entityId }) {
  if (!passport) return "";

  const candidates = passportSources(passport)
    .filter(source => source.sourceType === "aos-object")
    .map(source => {
      try {
        return getObject(source.sourceId);
      } catch (error) {
        if (error?.code === "OBJECT_NOT_FOUND") return null;
        throw error;
      }
    })
    .filter(object =>
      object &&
      object.status === "active" &&
      cleanText(object.entityId) === cleanText(entityId)
    );

  if (candidates.length > 1) {
    throw new MosError(
      "IXI_MACHINE_PASSPORT_MULTIPLE_ACTIVE_OBJECTS",
      "The listing Passport is already linked to multiple active AOS Objects.",
      {
        passportId: passport.passportId,
        objectIds: candidates.map(object => object.objectId)
      },
      409
    );
  }

  return candidates[0]?.objectId || "";
}

function provisionSharetribeMachine({
  entityId,
  principalId,
  listing = {}
} = {}) {
  const ownerEntityId = cleanText(entityId);
  const actorId = cleanText(principalId);
  const listingId = cleanText(listing.listingId);
  const displayName = cleanText(listing.displayName);

  if (!ownerEntityId || !actorId || !listingId || !displayName) {
    throw new MosError(
      "IXI_MACHINE_PROVISIONING_CONTEXT_REQUIRED",
      "Entity, authenticated principal, listing ID, and machine name are required.",
      null,
      400
    );
  }

  const legacyPassport = findPassportBySource(
    "sharetribe-listing",
    listingId
  );

  const adoptObjectId = reusableAosObjectId({
    passport: legacyPassport,
    entityId: ownerEntityId
  });

  const result = provisionAosObject({
    contractVersion: "ixi-aos-object-provision-v1",
    commandId: `sharetribe-listing:${listingId}`,
    entityId: ownerEntityId,
    objectType: "machine",
    displayName,
    value: listing.value ?? null,
    currency: cleanText(listing.currency) || "USD",
    source: "sharetribe-listing",
    actorId,
    trustedPassportId: cleanText(legacyPassport?.passportId) || null,
    fields: safeObject(listing.fields),
    media: Array.isArray(listing.media) ? listing.media : [],
    identities: [{
      identityType: "external-record",
      sourceType: "sharetribe-listing",
      sourceId: listingId
    }],
    metadata: {
      channel: cleanText(listing.channel) || "private",
      sourceListingId: listingId,
      sourceListingState: cleanText(listing.state) || null,
      authority: {
        principalType: "sharetribe-user",
        principalId: actorId,
        relationship: "uploaded-by",
        ownershipInferred: false
      }
    }
  }, { adoptObjectId });

  const passport = bindPassportSource({
    passportId: result.passport.passportId,
    sourceType: "sharetribe-listing",
    sourceId: listingId,
    entityId: ownerEntityId
  });

  return {
    ...result,
    passport,
    relationship: {
      principalType: "sharetribe-user",
      principalId: actorId,
      objectId: result.object.objectId,
      passportId: passport.passportId,
      role: "uploaded-by",
      ownershipInferred: false
    }
  };
}

module.exports = {
  provisionSharetribeMachine,
  reusableAosObjectId
};
