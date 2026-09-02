const {
  readJsonFile,
  writeJsonFileAtomic
} = require("../storage/jsonStore");

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  createMosId
} = require("./objectIdEngine");

const {
  MosError
} = require("../errors/MosError");

const {
  cleanText,
  normalizeKey,
  nowIso
} = require("../util/normalize");

const {
  getCardTemplate
} = require("../cards/cardTemplateService");

const {
  getEntity
} = require("../entities/entityService");



function assertEntityExists(entityId) {
  const normalizedEntityId =
    cleanText(entityId);

  if (!normalizedEntityId) {
    throw new MosError(
      "CUSTOMER_OBJECT_TYPE_ENTITY_REQUIRED",
      "entityId is required.",
      null,
      400
    );
  }

  /*
   * getEntity() is the canonical MOS Entity existence check.
   * Never allow customer definitions to be attached to an
   * invented, mistyped, or stale Entity identifier.
   */
  getEntity(
    normalizedEntityId
  );

  return normalizedEntityId;
}


function readCustomerObjectTypes() {
  const stored = readJsonFile(
    MOS_PATHS.customerObjectTypes,
    {}
  );

  if (
    !stored ||
    typeof stored !== "object" ||
    Array.isArray(stored)
  ) {
    throw new MosError(
      "CUSTOMER_OBJECT_TYPE_STORE_INVALID",
      "Customer Object Type store must contain an object.",
      null,
      500
    );
  }

  return stored;
}


function writeCustomerObjectTypes(store) {
  writeJsonFileAtomic(
    MOS_PATHS.customerObjectTypes,
    store
  );
}


function normalizeFieldSchema(fieldSchema) {
  if (
    fieldSchema === undefined ||
    fieldSchema === null
  ) {
    return [];
  }

  if (!Array.isArray(fieldSchema)) {
    throw new MosError(
      "CUSTOMER_OBJECT_TYPE_FIELD_SCHEMA_INVALID",
      "fieldSchema must be an array.",
      null,
      400
    );
  }

  return fieldSchema.map((rawField, index) => {
    if (
      !rawField ||
      typeof rawField !== "object" ||
      Array.isArray(rawField)
    ) {
      throw new MosError(
        "CUSTOMER_OBJECT_TYPE_FIELD_INVALID",
        `fieldSchema[${index}] must be an object.`,
        {
          index
        },
        400
      );
    }

    const field =
      cleanText(
        rawField.field ||
        rawField.fieldId ||
        rawField.key
      );

    const label =
      cleanText(
        rawField.label ||
        rawField.displayLabel ||
        field
      );

    if (!field) {
      throw new MosError(
        "CUSTOMER_OBJECT_TYPE_FIELD_ID_REQUIRED",
        `fieldSchema[${index}] requires a stable field identifier.`,
        {
          index
        },
        400
      );
    }

    if (!label) {
      throw new MosError(
        "CUSTOMER_OBJECT_TYPE_FIELD_LABEL_REQUIRED",
        `fieldSchema[${index}] requires a display label.`,
        {
          index,
          field
        },
        400
      );
    }

    return {
      ...rawField,

      field,
      label,

      type:
        cleanText(
          rawField.type
        ) || "text",

      required:
        rawField.required === true,

      editable:
        rawField.editable !== false,

      importable:
        rawField.importable !== false,

      exportable:
        rawField.exportable !== false,

      apiAddressable:
        rawField.apiAddressable !== false
    };
  });
}


function normalizeBusinessIdentifierSchema(
  rawSchema
) {
  if (
    rawSchema === undefined ||
    rawSchema === null
  ) {
    return {
      enabled: true,
      required: false,
      multiple: false,
      defaultLabel: "ID",
      uniqueWithinEntity: true,
      allowManual: true,
      allowImport: true,
      allowGenerated: false,
      metadata: {}
    };
  }

  if (
    typeof rawSchema !== "object" ||
    Array.isArray(rawSchema)
  ) {
    throw new MosError(
      "CUSTOMER_OBJECT_TYPE_IDENTIFIER_SCHEMA_INVALID",
      "businessIdentifierSchema must be an object.",
      null,
      400
    );
  }

  return {
    enabled:
      rawSchema.enabled !== false,

    required:
      rawSchema.required === true,

    multiple:
      rawSchema.multiple === true,

    defaultLabel:
      cleanText(
        rawSchema.defaultLabel
      ) || "ID",

    uniqueWithinEntity:
      rawSchema.uniqueWithinEntity !== false,

    allowManual:
      rawSchema.allowManual !== false,

    allowImport:
      rawSchema.allowImport !== false,

    allowGenerated:
      rawSchema.allowGenerated === true,

    metadata:
      rawSchema.metadata &&
      typeof rawSchema.metadata === "object" &&
      !Array.isArray(rawSchema.metadata)
        ? {
            ...rawSchema.metadata
          }
        : {}
  };
}


function normalizeCapabilities(
  capabilities
) {
  if (
    capabilities === undefined ||
    capabilities === null
  ) {
    return {};
  }

  if (
    typeof capabilities !== "object" ||
    Array.isArray(capabilities)
  ) {
    throw new MosError(
      "CUSTOMER_OBJECT_TYPE_CAPABILITIES_INVALID",
      "capabilities must be an object.",
      null,
      400
    );
  }

  return {
    ...capabilities
  };
}


function validateDefinition({
  entityId,
  label,
  definitionKey = null,
  capabilities = {},
  fieldSchema = [],
  businessIdentifierSchema = null,
  cardTemplateSlug = null,
  cardTemplateVersion = null,
  metadata = {}
}) {
  const normalizedEntityId =
    assertEntityExists(
      entityId
    );

  const normalizedLabel =
    cleanText(label);

  if (!normalizedLabel) {
    throw new MosError(
      "CUSTOMER_OBJECT_TYPE_LABEL_REQUIRED",
      "label is required.",
      null,
      400
    );
  }

  const normalizedDefinitionKey =
    cleanText(definitionKey) ||
    normalizeKey(normalizedLabel);

  if (!normalizedDefinitionKey) {
    throw new MosError(
      "CUSTOMER_OBJECT_TYPE_KEY_REQUIRED",
      "A stable definitionKey could not be resolved.",
      null,
      400
    );
  }

  const normalizedTemplateSlug =
    cleanText(cardTemplateSlug) || null;

  let resolvedTemplate = null;

  if (normalizedTemplateSlug) {
    resolvedTemplate =
      getCardTemplate({
        templateSlug:
          normalizedTemplateSlug,

        version:
          cardTemplateVersion,

        entityId:
          normalizedEntityId
      });
  }

  const normalizedMetadata =
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata)
      ? {
          ...metadata
        }
      : {};

  return {
    entityId:
      normalizedEntityId,

    label:
      normalizedLabel,

    definitionKey:
      normalizedDefinitionKey,

    capabilities:
      normalizeCapabilities(
        capabilities
      ),

    fieldSchema:
      normalizeFieldSchema(
        fieldSchema
      ),

    businessIdentifierSchema:
      normalizeBusinessIdentifierSchema(
        businessIdentifierSchema
      ),

    cardTemplateSlug:
      resolvedTemplate
        ? resolvedTemplate.templateSlug
        : null,

    cardTemplateVersion:
      resolvedTemplate
        ? resolvedTemplate.version
        : null,

    metadata:
      normalizedMetadata
  };
}


function createCustomerObjectType({
  entityId,
  label,
  definitionKey = null,
  capabilities = {},
  fieldSchema = [],
  businessIdentifierSchema = null,
  cardTemplateSlug = null,
  cardTemplateVersion = null,
  metadata = {},
  actorId = null
}) {
  const validated =
    validateDefinition({
      entityId,
      label,
      definitionKey,
      capabilities,
      fieldSchema,
      businessIdentifierSchema,
      cardTemplateSlug,
      cardTemplateVersion,
      metadata
    });

  const store =
    readCustomerObjectTypes();

  const duplicate =
    Object.values(store).find(
      definition =>
        definition?.entityId ===
          validated.entityId &&
        (
          definition?.definitionKey ===
            validated.definitionKey ||
          normalizeKey(
            definition?.label
          ) ===
            normalizeKey(
              validated.label
            )
        ) &&
        definition?.status !== "archived"
    );

  if (duplicate) {
    throw new MosError(
      "CUSTOMER_OBJECT_TYPE_CONFLICT",
      "An active customer object definition already uses this label or definitionKey.",
      {
        entityId:
          validated.entityId,

        definitionId:
          duplicate.definitionId,

        definitionKey:
          duplicate.definitionKey,

        label:
          duplicate.label
      },
      409
    );
  }

  const definitionId =
    createMosId("definition");

  const timestamp =
    nowIso();

  const definition = {
    definitionId,

    entityId:
      validated.entityId,

    label:
      validated.label,

    normalizedLabel:
      normalizeKey(
        validated.label
      ),

    definitionKey:
      validated.definitionKey,

    capabilities: {
      ...validated.capabilities
    },

    fieldSchema:
      [...validated.fieldSchema],

    businessIdentifierSchema: {
      ...validated.businessIdentifierSchema
    },

    cardTemplateSlug:
      validated.cardTemplateSlug,

    cardTemplateVersion:
      validated.cardTemplateVersion,

    status:
      "active",

    metadata: {
      ...validated.metadata
    },

    createdBy:
      cleanText(actorId) || null,

    updatedBy:
      cleanText(actorId) || null,

    createdAt:
      timestamp,

    updatedAt:
      timestamp,

    archivedAt:
      null
  };

  store[definitionId] =
    definition;

  writeCustomerObjectTypes(
    store
  );

  return definition;
}


function getCustomerObjectType({
  definitionId,
  entityId = null
}) {
  const normalizedDefinitionId =
    cleanText(definitionId);

  if (!normalizedDefinitionId) {
    throw new MosError(
      "CUSTOMER_OBJECT_TYPE_ID_REQUIRED",
      "definitionId is required.",
      null,
      400
    );
  }

  const store =
    readCustomerObjectTypes();

  const definition =
    store[normalizedDefinitionId];

  if (!definition) {
    throw new MosError(
      "CUSTOMER_OBJECT_TYPE_NOT_FOUND",
      `Customer Object Type not found: ${normalizedDefinitionId}`,
      {
        definitionId:
          normalizedDefinitionId
      },
      404
    );
  }

  const normalizedEntityId =
    cleanText(entityId);

  if (
    normalizedEntityId &&
    definition.entityId !==
      normalizedEntityId
  ) {
    throw new MosError(
      "CUSTOMER_OBJECT_TYPE_NOT_FOUND",
      `Customer Object Type not found: ${normalizedDefinitionId}`,
      {
        definitionId:
          normalizedDefinitionId,
        entityId:
          normalizedEntityId
      },
      404
    );
  }

  return definition;
}


function listCustomerObjectTypes({
  entityId,
  status = "active"
} = {}) {
  const normalizedEntityId =
    assertEntityExists(
      entityId
    );

  return Object.values(
    readCustomerObjectTypes()
  )
    .filter(definition => {
      if (
        definition?.entityId !==
        normalizedEntityId
      ) {
        return false;
      }

      if (
        status &&
        definition?.status !== status
      ) {
        return false;
      }

      return true;
    })
    .sort((a, b) =>
      String(
        a?.label || ""
      ).localeCompare(
        String(
          b?.label || ""
        )
      )
    );
}


function updateCustomerObjectType({
  definitionId,
  entityId,
  label = undefined,
  capabilities = undefined,
  fieldSchema = undefined,
  businessIdentifierSchema = undefined,
  cardTemplateSlug = undefined,
  cardTemplateVersion = undefined,
  metadata = undefined,
  actorId = null
}) {
  const current =
    getCustomerObjectType({
      definitionId,
      entityId
    });

  const nextLabel =
    label === undefined
      ? current.label
      : cleanText(label);

  if (!nextLabel) {
    throw new MosError(
      "CUSTOMER_OBJECT_TYPE_LABEL_REQUIRED",
      "label cannot be empty.",
      null,
      400
    );
  }

  const validated =
    validateDefinition({
      entityId:
        current.entityId,

      label:
        nextLabel,

      definitionKey:
        current.definitionKey,

      capabilities:
        capabilities === undefined
          ? current.capabilities
          : capabilities,

      fieldSchema:
        fieldSchema === undefined
          ? current.fieldSchema
          : fieldSchema,

      businessIdentifierSchema:
        businessIdentifierSchema === undefined
          ? current.businessIdentifierSchema
          : businessIdentifierSchema,

      cardTemplateSlug:
        cardTemplateSlug === undefined
          ? current.cardTemplateSlug
          : cardTemplateSlug,

      cardTemplateVersion:
        cardTemplateVersion === undefined
          ? current.cardTemplateVersion
          : cardTemplateVersion,

      metadata:
        metadata === undefined
          ? current.metadata
          : metadata
    });

  const store =
    readCustomerObjectTypes();

  const duplicate =
    Object.values(store).find(
      definition =>
        definition?.definitionId !==
          current.definitionId &&
        definition?.entityId ===
          current.entityId &&
        definition?.status !==
          "archived" &&
        normalizeKey(
          definition?.label
        ) ===
          normalizeKey(
            nextLabel
          )
    );

  if (duplicate) {
    throw new MosError(
      "CUSTOMER_OBJECT_TYPE_CONFLICT",
      "Another active customer object definition already uses this label.",
      {
        entityId:
          current.entityId,

        conflictingDefinitionId:
          duplicate.definitionId,

        label:
          nextLabel
      },
      409
    );
  }

  const updated = {
    ...current,

    label:
      validated.label,

    normalizedLabel:
      normalizeKey(
        validated.label
      ),

    capabilities: {
      ...validated.capabilities
    },

    fieldSchema:
      [...validated.fieldSchema],

    businessIdentifierSchema: {
      ...validated.businessIdentifierSchema
    },

    cardTemplateSlug:
      validated.cardTemplateSlug,

    cardTemplateVersion:
      validated.cardTemplateVersion,

    metadata: {
      ...validated.metadata
    },

    updatedBy:
      cleanText(actorId) || null,

    updatedAt:
      nowIso()
  };

  store[current.definitionId] =
    updated;

  writeCustomerObjectTypes(
    store
  );

  return updated;
}


function archiveCustomerObjectType({
  definitionId,
  entityId,
  actorId = null
}) {
  const current =
    getCustomerObjectType({
      definitionId,
      entityId
    });

  if (
    current.status ===
    "archived"
  ) {
    return current;
  }

  const timestamp =
    nowIso();

  const archived = {
    ...current,

    status:
      "archived",

    archivedAt:
      timestamp,

    updatedAt:
      timestamp,

    updatedBy:
      cleanText(actorId) || null
  };

  const store =
    readCustomerObjectTypes();

  store[current.definitionId] =
    archived;

  writeCustomerObjectTypes(
    store
  );

  return archived;
}


function resolveCustomerObjectType({
  entityId,
  definitionId = null,
  definitionKey = null,
  label = null
}) {
  const normalizedEntityId =
    assertEntityExists(
      entityId
    );

  if (cleanText(definitionId)) {
    return getCustomerObjectType({
      definitionId:
        cleanText(definitionId),

      entityId:
        normalizedEntityId
    });
  }

  const normalizedDefinitionKey =
    cleanText(definitionKey);

  const normalizedLabel =
    normalizeKey(label);

  const match =
    listCustomerObjectTypes({
      entityId:
        normalizedEntityId
    }).find(definition => {
      if (
        normalizedDefinitionKey &&
        definition.definitionKey ===
          normalizedDefinitionKey
      ) {
        return true;
      }

      if (
        normalizedLabel &&
        definition.normalizedLabel ===
          normalizedLabel
      ) {
        return true;
      }

      return false;
    });

  if (!match) {
    throw new MosError(
      "CUSTOMER_OBJECT_TYPE_NOT_FOUND",
      "No active customer object definition matched the supplied identifier.",
      {
        entityId:
          normalizedEntityId,

        definitionId:
          cleanText(definitionId) || null,

        definitionKey:
          normalizedDefinitionKey || null,

        label:
          cleanText(label) || null
      },
      404
    );
  }

  return match;
}


module.exports = {
  readCustomerObjectTypes,
  createCustomerObjectType,
  getCustomerObjectType,
  listCustomerObjectTypes,
  updateCustomerObjectType,
  archiveCustomerObjectType,
  resolveCustomerObjectType
};
