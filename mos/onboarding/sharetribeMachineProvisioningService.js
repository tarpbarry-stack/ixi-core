"use strict";

const {
  findPassportBySource,
  bindPassportSource
} = require("../../passport/passportRegistry");

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
  });

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
  provisionSharetribeMachine
};
