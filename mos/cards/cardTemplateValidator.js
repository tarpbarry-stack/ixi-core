const {
  MosError
} = require("../errors/MosError");


function cleanText(value) {
  return String(
    value ?? ""
  ).trim();
}


function normalizeSlug(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}


function requirePlainObject(
  value,
  fieldName
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new MosError(
      "CARD_TEMPLATE_INVALID",
      `${fieldName} must be an object.`,
      {
        fieldName
      },
      400
    );
  }

  return value;
}


function normalizeStringArray(
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
      "CARD_TEMPLATE_INVALID",
      `${fieldName} must be an array.`,
      {
        fieldName
      },
      400
    );
  }

  return value
    .map(cleanText)
    .filter(Boolean);
}


function validateCardTemplate(
  rawTemplate
) {
  const template =
    requirePlainObject(
      rawTemplate,
      "template"
    );


  const templateSlug =
    normalizeSlug(
      template.templateSlug
    );

  if (!templateSlug) {
    throw new MosError(
      "CARD_TEMPLATE_SLUG_REQUIRED",
      "templateSlug is required.",
      null,
      400
    );
  }


  const version =
    Number(
      template.version ?? 1
    );

  if (
    !Number.isInteger(version) ||
    version < 1
  ) {
    throw new MosError(
      "CARD_TEMPLATE_VERSION_INVALID",
      "version must be a positive integer.",
      {
        version:
          template.version
      },
      400
    );
  }


  const templateNumber =
    template.templateNumber ===
      undefined ||
    template.templateNumber ===
      null ||
    template.templateNumber ===
      ""
      ? null
      : Number(
          template.templateNumber
        );

  if (
    templateNumber !== null &&
    (
      !Number.isInteger(
        templateNumber
      ) ||
      templateNumber < 1
    )
  ) {
    throw new MosError(
      "CARD_TEMPLATE_NUMBER_INVALID",
      "templateNumber must be a positive integer when provided.",
      {
        templateNumber:
          template.templateNumber
      },
      400
    );
  }


  const baseObjectType =
    cleanText(
      template.baseObjectType
    ).toLowerCase();

  if (!baseObjectType) {
    throw new MosError(
      "CARD_TEMPLATE_OBJECT_TYPE_REQUIRED",
      "baseObjectType is required.",
      null,
      400
    );
  }


  const label =
    cleanText(
      template.label
    );

  if (!label) {
    throw new MosError(
      "CARD_TEMPLATE_LABEL_REQUIRED",
      "label is required.",
      null,
      400
    );
  }


  const librarySection =
    cleanText(
      template.librarySection
    ) || "GENERAL";


  const capabilities =
    template.capabilities ===
      undefined ||
    template.capabilities ===
      null
      ? {}
      : requirePlainObject(
          template.capabilities,
          "capabilities"
        );


  const fieldSchema =
    Array.isArray(
      template.fieldSchema
    )
      ? template.fieldSchema
      : [];

  if (
    template.fieldSchema !==
      undefined &&
    !Array.isArray(
      template.fieldSchema
    )
  ) {
    throw new MosError(
      "CARD_TEMPLATE_INVALID",
      "fieldSchema must be an array.",
      {
        fieldName:
          "fieldSchema"
      },
      400
    );
  }


  const faceSchema =
    Array.isArray(
      template.faceSchema
    )
      ? template.faceSchema
      : [];

  if (
    template.faceSchema !==
      undefined &&
    !Array.isArray(
      template.faceSchema
    )
  ) {
    throw new MosError(
      "CARD_TEMPLATE_INVALID",
      "faceSchema must be an array.",
      {
        fieldName:
          "faceSchema"
      },
      400
    );
  }


  const presentation =
    template.presentation ===
      undefined ||
    template.presentation ===
      null
      ? {}
      : requirePlainObject(
          template.presentation,
          "presentation"
        );


  return {
    templateSlug,
    templateNumber,
    version,

    baseObjectType,
    label,
    librarySection,

    capabilities: {
      ...capabilities
    },

    fieldSchema:
      [...fieldSchema],

    faceSchema:
      [...faceSchema],

    presentation: {
      ...presentation
    },

    modules:
      normalizeStringArray(
        template.modules,
        "modules"
      ),

    worksheets:
      normalizeStringArray(
        template.worksheets,
        "worksheets"
      ),

    metadata:
      template.metadata &&
      typeof template.metadata ===
        "object" &&
      !Array.isArray(
        template.metadata
      )
        ? {
            ...template.metadata
          }
        : {}
  };
}


module.exports = {
  normalizeSlug,
  validateCardTemplate
};
