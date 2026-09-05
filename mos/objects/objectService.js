const {
  readJsonFile,
  writeJsonFileAtomic
} = require("../storage/jsonStore");

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  MOS_OBJECT_STATUS,
  MOS_OBJECT_TYPES
} = require("../constants");

const {
  createMosId
} = require("./objectIdEngine");

const {
  getObjectTemplate
} = require("./objectTemplates");

const {
  resolveCustomerObjectType
} = require("./customerObjectTypeService");

const {
  MosError
} = require("../errors/MosError");

const {
  cleanText,
  normalizeKey,
  normalizeObjectType,
  normalizeMoney,
  nowIso
} = require("../util/normalize");

const {
  appendEvent
} = require("../events/eventService");


function readObjects() {
  return readJsonFile(
    MOS_PATHS.objects,
    {}
  );
}


function writeObjects(objects) {
  writeJsonFileAtomic(
    MOS_PATHS.objects,
    objects
  );
}


function normalizePlainObject(
  value,
  fallback = {}
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {
      ...fallback
    };
  }

  return {
    ...value
  };
}


function normalizeBusinessIdentifiers(
  value
) {
  if (
    value === undefined ||
    value === null
  ) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new MosError(
      "OBJECT_BUSINESS_IDENTIFIERS_INVALID",
      "businessIdentifiers must be an array.",
      null,
      400
    );
  }

  return value
    .map((raw, index) => {
      if (
        !raw ||
        typeof raw !== "object" ||
        Array.isArray(raw)
      ) {
        throw new MosError(
          "OBJECT_BUSINESS_IDENTIFIER_INVALID",
          `businessIdentifiers[${index}] must be an object.`,
          {
            index
          },
          400
        );
      }

      const label =
        cleanText(
          raw.label ||
          raw.type ||
          raw.name
        ) || "ID";

      const valueText =
        cleanText(
          raw.value
        );

      if (!valueText) {
        return null;
      }

      return {
        ...raw,
        label,
        value:
          valueText,
        normalizedValue:
          normalizeKey(
            valueText
          )
      };
    })
    .filter(Boolean);
}


function validateBusinessIdentifiersAgainstDefinition({
  objects,
  entityId,
  objectId = null,
  definition,
  businessIdentifiers
}) {
  const schema =
    definition?.businessIdentifierSchema ||
    {};

  if (schema.enabled === false) {
    return [];
  }

  if (
    schema.required === true &&
    businessIdentifiers.length === 0
  ) {
    throw new MosError(
      "OBJECT_BUSINESS_IDENTIFIER_REQUIRED",
      "At least one business identifier is required by this customer object definition.",
      {
        definitionId:
          definition?.definitionId || null
      },
      400
    );
  }

  if (
    schema.multiple !== true &&
    businessIdentifiers.length > 1
  ) {
    throw new MosError(
      "OBJECT_BUSINESS_IDENTIFIER_MULTIPLE_FORBIDDEN",
      "This customer object definition allows only one business identifier.",
      {
        definitionId:
          definition?.definitionId || null
      },
      400
    );
  }

  if (
    schema.uniqueWithinEntity !== false
  ) {
    businessIdentifiers.forEach(
      identifier => {
        const duplicate =
          Object.values(objects).find(
            existing =>
              existing?.objectId !==
                objectId &&
              existing?.entityId ===
                entityId &&
              existing?.status ===
                MOS_OBJECT_STATUS.ACTIVE &&
              Array.isArray(
                existing?.businessIdentifiers
              ) &&
              existing.businessIdentifiers
                .some(existingIdentifier =>
                  normalizeKey(
                    existingIdentifier?.value
                  ) ===
                    normalizeKey(
                      identifier.value
                    )
                )
          );

        if (duplicate) {
          throw new MosError(
            "OBJECT_BUSINESS_IDENTIFIER_CONFLICT",
            "Business identifier already exists within this Entity.",
            {
              identifier:
                identifier.value,
              conflictingObjectId:
                duplicate.objectId
            },
            409
          );
        }
      }
    );
  }

  return businessIdentifiers;
}


function validateFieldsAgainstDefinition({
  definition,
  fields
}) {
  const normalizedFields =
    normalizePlainObject(
      fields,
      {}
    );

  const schema =
    Array.isArray(
      definition?.fieldSchema
    )
      ? definition.fieldSchema
      : [];

  schema.forEach(fieldDefinition => {
    const fieldId =
      cleanText(
        fieldDefinition?.field
      );

    if (!fieldId) {
      return;
    }

    if (
      fieldDefinition.required === true
    ) {
      const value =
        normalizedFields[fieldId];

      const empty =
        value === undefined ||
        value === null ||
        (
          typeof value === "string" &&
          !value.trim()
        );

      if (empty) {
        throw new MosError(
          "OBJECT_REQUIRED_FIELD_MISSING",
          `Required field is missing: ${fieldDefinition.label || fieldId}`,
          {
            field:
              fieldId,
            label:
              fieldDefinition.label ||
              fieldId,
            definitionId:
              definition?.definitionId ||
              null
          },
          400
        );
      }
    }
  });

  return normalizedFields;
}


function resolveDefinitionForCreate({
  entityId,
  definitionId = null,
  definitionKey = null
}) {
  if (
    !cleanText(definitionId) &&
    !cleanText(definitionKey)
  ) {
    return null;
  }

  return resolveCustomerObjectType({
    entityId,
    definitionId,
    definitionKey
  });
}


function createObject({
  entityId,

  definitionId = null,
  definitionKey = null,

  objectType =
    MOS_OBJECT_TYPES.GENERIC,

  displayName,

  businessIdentifiers = [],

  customerCategory = null,
  customerAssetId = null,
  factualTitle = null,

  value = null,
  currency = "USD",

  fields = {},
  identities = [],
  media = [],

  cardTemplateSlug = null,
  cardTemplateVersion = null,

  source = "manual",
  actorId = null,
  metadata = {}
}) {
  const normalizedEntityId =
    cleanText(entityId);

  const name =
    cleanText(displayName);

  if (!normalizedEntityId) {
    throw new MosError(
      "OBJECT_ENTITY_REQUIRED",
      "entityId is required.",
      null,
      400
    );
  }

  if (!name) {
    throw new MosError(
      "OBJECT_NAME_REQUIRED",
      "Object displayName is required.",
      null,
      400
    );
  }

  const objects =
    readObjects();

  const definition =
    resolveDefinitionForCreate({
      entityId:
        normalizedEntityId,
      definitionId,
      definitionKey
    });

  let normalizedType = null;
  let legacyTemplate = null;

  if (!definition) {
    normalizedType =
      normalizeObjectType(
        objectType
      ) ||
      MOS_OBJECT_TYPES.GENERIC;

    legacyTemplate =
      getObjectTemplate(
        normalizedType
      );
  }

  const normalizedBusinessIdentifiers =
    normalizeBusinessIdentifiers(
      businessIdentifiers
    );

  const validatedBusinessIdentifiers =
    definition
      ? validateBusinessIdentifiersAgainstDefinition({
          objects,
          entityId:
            normalizedEntityId,
          definition,
          businessIdentifiers:
            normalizedBusinessIdentifiers
        })
      : normalizedBusinessIdentifiers;

  const validatedFields =
    definition
      ? validateFieldsAgainstDefinition({
          definition,
          fields
        })
      : normalizePlainObject(
          fields,
          {}
        );

  const objectId =
    createMosId("object");

  const timestamp =
    nowIso();

  const effectiveCapabilities =
    definition
      ? {
          ...normalizePlainObject(
            definition.capabilities,
            {}
          )
        }
      : {
          ...normalizePlainObject(
            legacyTemplate?.capabilities,
            {}
          )
        };

  const effectiveCardTemplateSlug =
    cleanText(
      cardTemplateSlug
    ) ||
    cleanText(
      definition?.cardTemplateSlug
    ) ||
    null;

  const effectiveCardTemplateVersion =
    cardTemplateVersion !== null &&
    cardTemplateVersion !== undefined &&
    cardTemplateVersion !== ""
      ? Number(
          cardTemplateVersion
        )
      : (
          definition?.cardTemplateVersion ||
          null
        );

  const object = {
    objectId,

    entityId:
      normalizedEntityId,

    definitionId:
      definition?.definitionId ||
      null,

    definitionKey:
      definition?.definitionKey ||
      null,

    definitionLabel:
      definition?.label ||
      null,

    objectType:
      definition
        ? MOS_OBJECT_TYPES.GENERIC
        : legacyTemplate.objectType,

    templateType:
      definition
        ? null
        : normalizedType,

    displayName:
      name,

    normalizedName:
      normalizeKey(name),

    businessIdentifiers:
      validatedBusinessIdentifiers,

    customerCategory:
      cleanText(
        customerCategory
      ) || null,

    customerCategoryKey:
      normalizeKey(
        customerCategory
      ) || null,

    customerAssetId:
      cleanText(
        customerAssetId
      ) || null,

    factualTitle:
      cleanText(
        factualTitle
      ) || null,

    status:
      MOS_OBJECT_STATUS.ACTIVE,

    capabilities:
      effectiveCapabilities,

    value:
      normalizeMoney(value),

    currency:
      cleanText(currency) ||
      "USD",

    identities:
      Array.isArray(identities)
        ? [...identities]
        : [],

    fields:
      validatedFields,

    media:
      Array.isArray(media)
        ? [...media]
        : [],

    cardTemplateSlug:
      effectiveCardTemplateSlug,

    cardTemplateVersion:
      effectiveCardTemplateVersion,

    directContainerId:
      null,

    source:
      cleanText(source) ||
      "manual",

    metadata:
      normalizePlainObject(
        metadata,
        {}
      ),

    createdAt:
      timestamp,

    updatedAt:
      timestamp,

    archivedAt:
      null,

    softDeletedAt:
      null,

    /*
     * Durable optimistic-concurrency token. Existing legacy objects that
     * predate this contract are treated as revision 0 on their first write.
     */
    revision:
      1
  };

  objects[objectId] =
    object;

  writeObjects(
    objects
  );

  appendEvent({
    entityId:
      object.entityId,

    eventType:
      "object.created",

    objectId,

    actorId,

    payload: {
      definitionId:
        object.definitionId,

      definitionKey:
        object.definitionKey,

      definitionLabel:
        object.definitionLabel,

      objectType:
        object.objectType,

      displayName:
        object.displayName,

      source:
        object.source
    }
  });

  return object;
}


function getObject(objectId) {
  const objects =
    readObjects();

  const object =
    objects[objectId];

  if (!object) {
    throw new MosError(
      "OBJECT_NOT_FOUND",
      `Object not found: ${objectId}`,
      {
        objectId
      },
      404
    );
  }

  return object;
}


function listObjects({
  entityId,
  objectType = null,
  definitionId = null,
  definitionKey = null,
  status =
    MOS_OBJECT_STATUS.ACTIVE
} = {}) {
  const objects =
    readObjects();

  return Object.values(
    objects
  ).filter(object => {
    if (
      entityId &&
      object.entityId !== entityId
    ) {
      return false;
    }

    if (
      objectType &&
      object.objectType !== objectType
    ) {
      return false;
    }

    if (
      definitionId &&
      object.definitionId !==
        definitionId
    ) {
      return false;
    }

    if (
      definitionKey &&
      object.definitionKey !==
        definitionKey
    ) {
      return false;
    }

    if (
      status &&
      object.status !== status
    ) {
      return false;
    }

    return true;
  });
}


function updateObject({
  objectId,

  expectedRevision = undefined,
  commandId = null,

  displayName = undefined,
  businessIdentifiers = undefined,

  value = undefined,
  currency = undefined,

  fields = undefined,
  identities = undefined,
  media = undefined,

  cardTemplateSlug = undefined,
  cardTemplateVersion = undefined,

  metadata = undefined,

  actorId = null
}) {
  const objects =
    readObjects();

  const current =
    objects[objectId];

  if (!current) {
    throw new MosError(
      "OBJECT_NOT_FOUND",
      `Object not found: ${objectId}`,
      {
        objectId
      },
      404
    );
  }

  if (
    current.status !==
    MOS_OBJECT_STATUS.ACTIVE
  ) {
    throw new MosError(
      "OBJECT_NOT_ACTIVE",
      "Only active objects can be updated.",
      {
        objectId,
        status:
          current.status
      },
      409
    );
  }

  const currentRevision =
    Number.isInteger(
      Number(current.revision)
    ) &&
    Number(current.revision) >= 0
      ? Number(current.revision)
      : 0;

  if (
    expectedRevision !== undefined &&
    expectedRevision !== null
  ) {
    const normalizedExpectedRevision =
      Number(expectedRevision);

    if (
      !Number.isInteger(
        normalizedExpectedRevision
      ) ||
      normalizedExpectedRevision < 0
    ) {
      throw new MosError(
        "OBJECT_REVISION_REQUIRED",
        "expectedRevision must be a non-negative integer.",
        {
          objectId,
          expectedRevision
        },
        428
      );
    }

    if (
      normalizedExpectedRevision !==
        currentRevision
    ) {
      throw new MosError(
        "OBJECT_REVISION_CONFLICT",
        "The Object changed after this edit session began.",
        {
          objectId,
          expectedRevision:
            normalizedExpectedRevision,
          currentRevision
        },
        412
      );
    }
  }

  let definition = null;

  if (current.definitionId) {
    definition =
      resolveCustomerObjectType({
        entityId:
          current.entityId,

        definitionId:
          current.definitionId
      });
  }

  const nextDisplayName =
    displayName === undefined
      ? current.displayName
      : cleanText(
          displayName
        );

  if (!nextDisplayName) {
    throw new MosError(
      "OBJECT_NAME_REQUIRED",
      "Object displayName cannot be empty.",
      null,
      400
    );
  }

  const nextBusinessIdentifiers =
    businessIdentifiers === undefined
      ? (
          Array.isArray(
            current.businessIdentifiers
          )
            ? [
                ...current.businessIdentifiers
              ]
            : []
        )
      : normalizeBusinessIdentifiers(
          businessIdentifiers
        );

  const validatedBusinessIdentifiers =
    definition
      ? validateBusinessIdentifiersAgainstDefinition({
          objects,
          entityId:
            current.entityId,
          objectId:
            current.objectId,
          definition,
          businessIdentifiers:
            nextBusinessIdentifiers
        })
      : nextBusinessIdentifiers;

  const nextFields =
    fields === undefined
      ? normalizePlainObject(
          current.fields,
          {}
        )
      : normalizePlainObject(
          fields,
          {}
        );

  const validatedFields =
    definition
      ? validateFieldsAgainstDefinition({
          definition,
          fields:
            nextFields
        })
      : nextFields;

  const nextMetadata =
    metadata === undefined
      ? normalizePlainObject(
          current.metadata,
          {}
        )
      : {
          ...normalizePlainObject(
            current.metadata,
            {}
          ),
          ...normalizePlainObject(
            metadata,
            {}
          )
        };

  const timestamp =
    nowIso();

  const updated = {
    ...current,

    displayName:
      nextDisplayName,

    normalizedName:
      normalizeKey(
        nextDisplayName
      ),

    businessIdentifiers:
      validatedBusinessIdentifiers,

    value:
      value === undefined
        ? current.value
        : normalizeMoney(value),

    currency:
      currency === undefined
        ? current.currency
        : (
            cleanText(currency) ||
            current.currency ||
            "USD"
          ),

    fields:
      validatedFields,

    identities:
      identities === undefined
        ? (
            Array.isArray(
              current.identities
            )
              ? [
                  ...current.identities
                ]
              : []
          )
        : (
            Array.isArray(identities)
              ? [...identities]
              : []
          ),

    media:
      media === undefined
        ? (
            Array.isArray(
              current.media
            )
              ? [...current.media]
              : []
          )
        : (
            Array.isArray(media)
              ? [...media]
              : []
          ),

    cardTemplateSlug:
      cardTemplateSlug === undefined
        ? current.cardTemplateSlug
        : (
            cleanText(
              cardTemplateSlug
            ) || null
          ),

    cardTemplateVersion:
      cardTemplateVersion === undefined
        ? current.cardTemplateVersion
        : (
            cardTemplateVersion === null ||
            cardTemplateVersion === ""
              ? null
              : Number(
                  cardTemplateVersion
                )
          ),

    metadata:
      nextMetadata,

    revision:
      currentRevision + 1,

    updatedAt:
      timestamp
  };

  objects[objectId] =
    updated;

  writeObjects(
    objects
  );

  appendEvent({
    entityId:
      updated.entityId,

    eventType:
      "object.updated",

    objectId:
      updated.objectId,

    actorId,

    commandId,

    payload: {
      displayName:
        updated.displayName,

      definitionId:
        updated.definitionId,

      definitionKey:
        updated.definitionKey,

      previousRevision:
        currentRevision,

      revision:
        updated.revision
    }
  });

  return updated;
}


function softDeleteObject({
  objectId,
  actorId = null
}) {
  const objects =
    readObjects();

  const current =
    objects[objectId];

  if (!current) {
    throw new MosError(
      "OBJECT_NOT_FOUND",
      `Object not found: ${objectId}`,
      {
        objectId
      },
      404
    );
  }

  if (
    current.status ===
    MOS_OBJECT_STATUS.SOFT_DELETED
  ) {
    return current;
  }

  const activeChildren =
    Object.values(objects)
      .filter(
        object =>
          object.status ===
            MOS_OBJECT_STATUS.ACTIVE &&
          object.directContainerId ===
            current.objectId
      );

  if (activeChildren.length) {
    throw new MosError(
      "OBJECT_DELETE_NON_EMPTY_CONTAINER",
      "An object with active direct children cannot be deleted.",
      {
        objectId,
        activeChildCount:
          activeChildren.length
      },
      409
    );
  }

  const timestamp =
    nowIso();

  const deleted = {
    ...current,

    status:
      MOS_OBJECT_STATUS.SOFT_DELETED,

    softDeletedAt:
      timestamp,

    updatedAt:
      timestamp
  };

  objects[objectId] =
    deleted;

  writeObjects(
    objects
  );

  appendEvent({
    entityId:
      deleted.entityId,

    eventType:
      "object.soft-deleted",

    objectId:
      deleted.objectId,

    actorId,

    payload: {
      definitionId:
        deleted.definitionId ||
        null,

      definitionKey:
        deleted.definitionKey ||
        null,

      previousContainerId:
        deleted.directContainerId ||
        null
    }
  });

  return deleted;
}


module.exports = {
  createObject,
  getObject,
  listObjects,
  updateObject,
  softDeleteObject
};
