const {
  readJsonFile
} = require("../storage/jsonStore");

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  cleanText,
  nowIso
} = require("../util/normalize");

const {
  getObjectRelationships
} = require("./faceRelationshipDataService");

const {
  getObjectContainerData
} = require("./faceContainerDataService");


function cleanArray(value) {
  return Array.isArray(value)
    ? [...new Set(
        value
          .map(cleanText)
          .filter(Boolean)
      )]
    : [];
}


function readCustomerDefinitions() {
  return readJsonFile(
    MOS_PATHS.customerObjectTypes,
    {}
  );
}


function findDefinitionForObject(object) {
  if (!object) {
    return null;
  }

  const definitionId =
    cleanText(
      object.definitionId ||
      object.objectDefinitionId ||
      object.customerObjectTypeId
    );

  if (!definitionId) {
    return null;
  }

  const definitions =
    readCustomerDefinitions();

  const direct =
    definitions[definitionId];

  if (
    direct &&
    direct.entityId ===
      object.entityId
  ) {
    return direct;
  }

  return (
    Object.values(definitions)
      .find(
        definition =>
          definition?.definitionId ===
            definitionId &&
          definition?.entityId ===
            object.entityId
      ) ||
    null
  );
}


function normalizeFieldDefinition(
  rawField
) {
  if (
    !rawField ||
    typeof rawField !== "object" ||
    Array.isArray(rawField)
  ) {
    return null;
  }

  const fieldId =
    cleanText(
      rawField.field ||
      rawField.fieldId ||
      rawField.key
    );

  if (!fieldId) {
    return null;
  }

  return {
    capabilityId:
      `field:${fieldId}`,

    kind:
      "field",

    fieldId,

    label:
      cleanText(
        rawField.label ||
        rawField.displayLabel ||
        fieldId
      ),

    dataType:
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
      rawField.apiAddressable !== false,

    source:
      "customer-object-definition"
  };
}


function buildDefinitionFields(
  definition
) {
  if (!definition) {
    return [];
  }

  return (
    Array.isArray(
      definition.fieldSchema
    )
      ? definition.fieldSchema
      : []
  )
    .map(
      normalizeFieldDefinition
    )
    .filter(Boolean);
}


function buildPersistedObjectFields(
  object,
  knownFieldIds
) {
  const fields =
    object?.fields &&
    typeof object.fields ===
      "object" &&
    !Array.isArray(
      object.fields
    )
      ? object.fields
      : {};

  return Object.entries(fields)
    .filter(
      ([fieldId]) =>
        !knownFieldIds.has(
          fieldId
        )
    )
    .map(
      ([fieldId, value]) => ({
        capabilityId:
          `field:${fieldId}`,

        kind:
          "field",

        fieldId,

        /*
         * Preserve persisted customer key.
         * Do not infer business meaning.
         */
        label:
          fieldId,

        dataType:
          Array.isArray(value)
            ? "array"
            : value === null
              ? "unknown"
              : typeof value,

        required: false,
        editable: true,
        importable: true,
        exportable: true,
        apiAddressable: true,

        source:
          "persisted-object-field"
      })
    );
}


function buildBusinessIdentifier(
  object,
  definition
) {
  const schema =
    definition
      ?.businessIdentifierSchema;

  const directValue =
    cleanText(
      object.businessIdentifier ||
      object.customerAssetId ||
      object.customerIdentifier ||
      object.identifier
    );

  const identities =
    Array.isArray(
      object.identities
    )
      ? object.identities
      : [];

  const persistedIdentity =
    identities.find(
      item =>
        item &&
        typeof item === "object" &&
        cleanText(
          item.type ||
          item.identifierType
        )
    ) || null;

  const enabled =
    schema
      ? schema.enabled !== false
      : Boolean(
          directValue ||
          persistedIdentity
        );

  if (!enabled) {
    return null;
  }

  const value =
    directValue ||
    cleanText(
      persistedIdentity
        ?.value ||
      persistedIdentity
        ?.identifierValue
    ) ||
    null;

  return {
    capabilityId:
      "identity:businessIdentifier",

    kind:
      "business-identifier",

    fieldId:
      "businessIdentifier",

    label:
      cleanText(
        schema?.defaultLabel ||
        persistedIdentity?.label ||
        persistedIdentity
          ?.identifierType
      ) || "ID",

    value,

    dataType:
      "identifier",

    required:
      schema?.required === true,

    editable:
      schema
        ? schema.allowManual !== false
        : true,

    importable:
      schema
        ? schema.allowImport !== false
        : true,

    exportable: true,
    apiAddressable: true,

    multiple:
      schema?.multiple === true,

    uniqueWithinEntity:
      schema
        ? schema
            .uniqueWithinEntity !==
          false
        : null,

    allowGenerated:
      schema?.allowGenerated ===
        true,

    source:
      schema
        ? "business-identifier-schema"
        : "persisted-object-identity"
  };
}


function buildObjectCapabilities(
  object,
  definition
) {
  const merged = {
    ...(
      definition?.capabilities &&
      typeof definition.capabilities ===
        "object"
        ? definition.capabilities
        : {}
    ),

    ...(
      object?.capabilities &&
      typeof object.capabilities ===
        "object"
        ? object.capabilities
        : {}
    )
  };

  return Object.entries(merged)
    .filter(
      ([, enabled]) =>
        enabled === true
    )
    .map(
      ([capability]) => ({
        capabilityId:
          `capability:${capability}`,

        capability,

        kind:
          "object-capability",

        source:
          object?.capabilities?.[
            capability
          ] === true
            ? "persisted-object"
            : "customer-object-definition"
      })
    );
}


function createAuthorizedFaceDataManifest({
  entityId,
  principalId,
  object,
  permissionScopes = []
}) {
  const normalizedEntityId =
    cleanText(entityId);

  if (
    !object ||
    object.entityId !==
      normalizedEntityId
  ) {
    return {
      authorized: false,
      reason:
        "object-entity-mismatch",
      entityId:
        normalizedEntityId,
      principalId:
        cleanText(principalId),
      objectId:
        cleanText(
          object?.objectId
        ) || null,
      generatedAt:
        nowIso(),
      identity: null,
      fields: [],
      objectCapabilities: [],
      capabilities: [],
      permissionScopes: []
    };
  }

  const definition =
    findDefinitionForObject(
      object
    );

  const displayName =
    cleanText(
      object.displayName
    );

  /*
   * A Face is not meaningful until the
   * customer has actually named the object.
   */
  if (!displayName) {
    return {
      authorized: false,
      reason:
        "customer-object-name-required",
      entityId:
        normalizedEntityId,
      principalId:
        cleanText(principalId),
      objectId:
        cleanText(
          object.objectId
        ),
      generatedAt:
        nowIso(),
      identity: null,
      fields: [],
      objectCapabilities: [],
      capabilities: [],
      permissionScopes:
        cleanArray(
          permissionScopes
        )
    };
  }

  const definitionFields =
    buildDefinitionFields(
      definition
    );

  const knownFieldIds =
    new Set(
      definitionFields.map(
        field => field.fieldId
      )
    );

  const persistedFields =
    buildPersistedObjectFields(
      object,
      knownFieldIds
    );

  const businessIdentifier =
    buildBusinessIdentifier(
      object,
      definition
    );

  const fields = [
    ...definitionFields,
    ...persistedFields
  ];

  const objectCapabilities =
    buildObjectCapabilities(
      object,
      definition
    );

  const relationships =
    getObjectRelationships({
      entityId:
        normalizedEntityId,

      objectId:
        object.objectId
    });

  const container =
    getObjectContainerData(
      object
    );

  const capabilityIds = [
    "identity:displayName",

    ...(businessIdentifier
      ? [
          "identity:businessIdentifier"
        ]
      : []),

    ...fields.map(
      field =>
        field.capabilityId
    ),

    ...objectCapabilities.map(
      capability =>
        capability.capabilityId
    ),

    ...(relationships.count > 0
      ? [
          "relationships:read"
        ]
      : []),

    ...(container
      ? [
          "container:directChildren",
          "container:projection",
          "container:branchSummary"
        ]
      : [])
  ];

  return {
    authorized: true,

    entityId:
      normalizedEntityId,

    principalId:
      cleanText(principalId),

    objectId:
      cleanText(
        object.objectId
      ),

    definitionId:
      cleanText(
        definition?.definitionId
      ) || null,

    definitionStatus:
      cleanText(
        definition?.status
      ) || null,

    /*
     * Business meaning comes from
     * customer-defined/persisted nomenclature.
     */
    identity: {
      displayName,

      objectLabel:
        cleanText(
          definition?.label ||
          object.customerCategory ||
          object.objectType
        ) || null,

      businessIdentifier
    },

    fields,

    relationships,

    container,

    objectCapabilities,

    capabilities:
      [...new Set(
        capabilityIds
      )],

    permissionScopes:
      cleanArray(
        permissionScopes
      ),

    generatedAt:
      nowIso()
  };
}


module.exports = {
  findDefinitionForObject,
  createAuthorizedFaceDataManifest
};
