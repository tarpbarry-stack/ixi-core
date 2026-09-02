"use strict";

const crypto =
  require("crypto");

const {
  cleanText
} = require("../util/normalize");

const {
  MosError
} = require("../errors/MosError");


const PROVISIONING_CONTRACT =
  "ixi-aos-object-provision-v1";

const PROVISIONING_COMMAND_TYPE =
  "aos-object-provision";


function stableObject(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(
      stableObject
    );
  }

  if (
    typeof value === "object"
  ) {
    return Object.keys(value)
      .sort()
      .reduce(
        (result, key) => {
          result[key] =
            stableObject(
              value[key]
            );

          return result;
        },
        {}
      );
  }

  return value;
}


function createPayloadHash(
  value
) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        stableObject(value)
      )
    )
    .digest("hex");
}


function normalizeArray(value) {
  return Array.isArray(value)
    ? [...value]
    : [];
}


function normalizeObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? { ...value }
    : {};
}


function validateProvisioningInput(
  input = {}
) {
  const contractVersion =
    cleanText(
      input.contractVersion
    ) ||
    PROVISIONING_CONTRACT;

  if (
    contractVersion !==
    PROVISIONING_CONTRACT
  ) {
    throw new MosError(
      "AOS_PROVISION_CONTRACT_UNSUPPORTED",
      `Unsupported provisioning contract: ${contractVersion}`,
      {
        contractVersion,
        expected:
          PROVISIONING_CONTRACT
      },
      400
    );
  }

  const entityId =
    cleanText(
      input.entityId
    );

  if (!entityId) {
    throw new MosError(
      "AOS_PROVISION_ENTITY_REQUIRED",
      "entityId is required.",
      null,
      400
    );
  }

  const displayName =
    cleanText(
      input.displayName
    );

  /*
   * A draft may exist without a customer name.
   * A durable AOS Object may not.
   */
  if (!displayName) {
    throw new MosError(
      "AOS_PROVISION_NAME_REQUIRED",
      "A customer-provided displayName is required before permanent object creation.",
      null,
      400
    );
  }

  const commandId =
    cleanText(
      input.commandId ||
      input.idempotencyKey
    );

  if (!commandId) {
    throw new MosError(
      "AOS_PROVISION_COMMAND_ID_REQUIRED",
      "A stable provisioning commandId is required.",
      null,
      400
    );
  }

  const normalized = {
    contractVersion:
      PROVISIONING_CONTRACT,

    commandId,
    entityId,

    definitionId:
      cleanText(
        input.definitionId
      ) || null,

    definitionKey:
      cleanText(
        input.definitionKey
      ) || null,

    /*
     * Technical legacy fallback only.
     * Never interpreted as customer
     * business meaning.
     */
    objectType:
      cleanText(
        input.objectType
      ) || null,

    displayName,

    businessIdentifiers:
      normalizeArray(
        input.businessIdentifiers
      ),

    customerCategory:
      input.customerCategory ??
      null,

    customerAssetId:
      input.customerAssetId ??
      null,

    factualTitle:
      input.factualTitle ??
      null,

    value:
      input.value ??
      null,

    currency:
      cleanText(
        input.currency
      ) || "USD",

    fields:
      normalizeObject(
        input.fields
      ),

    identities:
      normalizeArray(
        input.identities
      ),

    media:
      normalizeArray(
        input.media
      ),

    cardTemplateSlug:
      cleanText(
        input.cardTemplateSlug
      ) || null,

    cardTemplateVersion:
      input.cardTemplateVersion ??
      null,

    source:
      cleanText(
        input.source
      ) || "manual",

    actorId:
      cleanText(
        input.actorId
      ) || null,

    metadata:
      normalizeObject(
        input.metadata
      )
  };

  const payloadHash =
    createPayloadHash({
      ...normalized,

      /*
       * commandId identifies the request;
       * it does not participate in payload
       * equivalence.
       */
      commandId: undefined
    });

  return {
    normalized,
    payloadHash
  };
}


module.exports = {
  PROVISIONING_CONTRACT,
  PROVISIONING_COMMAND_TYPE,
  createPayloadHash,
  validateProvisioningInput
};
