const {
  MosError
} = require("../errors/MosError");

const {
  cleanText
} = require("../util/normalize");


function plainObject(
  value,
  fieldName
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new MosError(
      "FACE_DEFINITION_INVALID",
      `${fieldName} must be an object.`,
      {
        fieldName
      },
      400
    );
  }

  return value;
}


function stringArray(
  value,
  fieldName
) {
  if (
    value === undefined ||
    value === null
  ) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new MosError(
      "FACE_DEFINITION_INVALID",
      `${fieldName} must be an array.`,
      {
        fieldName
      },
      400
    );
  }

  return [
    ...new Set(
      value
        .map(cleanText)
        .filter(Boolean)
    )
  ];
}


function normalizeFaceSlug(
  value
) {
  return cleanText(value)
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      ""
    );
}


function validateFaceDefinition(
  rawDefinition
) {
  const definition =
    plainObject(
      rawDefinition,
      "definition"
    );

  const faceSlug =
    normalizeFaceSlug(
      definition.faceSlug ||
      definition.slug
    );

  if (!faceSlug) {
    throw new MosError(
      "FACE_SLUG_REQUIRED",
      "faceSlug is required.",
      null,
      400
    );
  }


  const label =
    cleanText(
      definition.label ||
      definition.name
    );

  if (!label) {
    throw new MosError(
      "FACE_LABEL_REQUIRED",
      "label is required.",
      null,
      400
    );
  }


  const faceNumber =
    Number(
      definition.faceNumber
    );

  if (
    !Number.isInteger(
      faceNumber
    ) ||
    faceNumber < 2
  ) {
    throw new MosError(
      "FACE_NUMBER_INVALID",
      "Face Apps must use faceNumber 2 or greater.",
      {
        faceNumber:
          definition.faceNumber
      },
      400
    );
  }


  const implementationType =
    cleanText(
      definition
        .implementationType ||
      "declarative"
    ).toLowerCase();

  if (
    ![
      "declarative",
      "trusted-hardcoded"
    ].includes(
      implementationType
    )
  ) {
    throw new MosError(
      "FACE_IMPLEMENTATION_INVALID",
      "implementationType must be declarative or trusted-hardcoded.",
      {
        implementationType
      },
      400
    );
  }


  const rendererSlug =
    cleanText(
      definition.rendererSlug
    );

  if (
    implementationType ===
      "trusted-hardcoded" &&
    !rendererSlug
  ) {
    throw new MosError(
      "FACE_RENDERER_REQUIRED",
      "trusted-hardcoded Face Apps require rendererSlug.",
      null,
      400
    );
  }


  const layout =
    definition.layout ===
      undefined ||
    definition.layout ===
      null
      ? {}
      : plainObject(
          definition.layout,
          "layout"
        );


  const configuration =
    definition.configuration ===
      undefined ||
    definition.configuration ===
      null
      ? {}
      : plainObject(
          definition.configuration,
          "configuration"
        );


  const metadata =
    definition.metadata &&
    typeof definition.metadata ===
      "object" &&
    !Array.isArray(
      definition.metadata
    )
      ? {
          ...definition.metadata
        }
      : {};


  return {
    faceSlug,
    label,
    faceNumber,

    implementationType,

    rendererSlug:
      rendererSlug || null,

    dataCapabilities:
      stringArray(
        definition
          .dataCapabilities,
        "dataCapabilities"
      ),

    requiredCapabilities:
      stringArray(
        definition
          .requiredCapabilities,
        "requiredCapabilities"
      ),

    optionalCapabilities:
      stringArray(
        definition
          .optionalCapabilities,
        "optionalCapabilities"
      ),

    permissionScopes:
      stringArray(
        definition
          .permissionScopes,
        "permissionScopes"
      ),

    compatibleObjectCapabilities:
      stringArray(
        definition
          .compatibleObjectCapabilities,
        "compatibleObjectCapabilities"
      ),

    compatibleObjectDefinitionIds:
      stringArray(
        definition
          .compatibleObjectDefinitionIds,
        "compatibleObjectDefinitionIds"
      ),

    layout: {
      ...layout
    },

    configuration: {
      ...configuration
    },

    metadata
  };
}


module.exports = {
  normalizeFaceSlug,
  validateFaceDefinition
};
