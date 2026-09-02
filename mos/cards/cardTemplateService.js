const {
  readJsonFile,
  writeJsonFileAtomic
} = require("../storage/jsonStore");

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  MosError
} = require("../errors/MosError");

const {
  listSystemCardTemplates
} = require("./systemCardTemplates");

const {
  normalizeSlug,
  validateCardTemplate
} = require("./cardTemplateValidator");


function cleanText(value) {
  return String(
    value ?? ""
  ).trim();
}


function readCustomerCardTemplates() {
  const stored =
    readJsonFile(
      MOS_PATHS.cardTemplates,
      {}
    );

  if (
    !stored ||
    typeof stored !== "object" ||
    Array.isArray(stored)
  ) {
    throw new MosError(
      "CARD_TEMPLATE_STORE_INVALID",
      "Card Template store must contain an object.",
      null,
      500
    );
  }

  return stored;
}


function getSystemTemplatesValidated() {
  return listSystemCardTemplates()
    .map(template => ({
      ...validateCardTemplate(
        template
      ),

      ownerType:
        "system",

      entityId:
        null
    }));
}


function getCustomerTemplatesValidated({
  entityId = null
} = {}) {
  const requestedEntityId =
    cleanText(entityId);

  /*
   * Tenant isolation boundary.
   *
   * Customer templates are NEVER globally enumerable.
   *
   * No entityId:
   *   return no customer templates.
   *
   * entityId supplied:
   *   return only templates owned by that Entity.
   */
  if (!requestedEntityId) {
    return [];
  }

  return Object.values(
    readCustomerCardTemplates()
  )
    .map(template => ({
      ...validateCardTemplate(
        template
      ),

      ownerType:
        "customer",

      entityId:
        cleanText(
          template?.entityId
        ) || null
    }))
    .filter(
      template =>
        template.entityId ===
        requestedEntityId
    );
}


function listCardTemplates({
  entityId = null,
  librarySection = null,
  baseObjectType = null
} = {}) {
  const sectionFilter =
    cleanText(
      librarySection
    ).toLowerCase();

  const objectTypeFilter =
    cleanText(
      baseObjectType
    ).toLowerCase();

  const templates = [
    ...getSystemTemplatesValidated(),
    ...getCustomerTemplatesValidated({
      entityId
    })
  ];

  return templates
    .filter(template => {
      if (
        sectionFilter &&
        String(
          template.librarySection ||
          ""
        )
          .trim()
          .toLowerCase() !==
          sectionFilter
      ) {
        return false;
      }

      if (
        objectTypeFilter &&
        String(
          template.baseObjectType ||
          ""
        )
          .trim()
          .toLowerCase() !==
          objectTypeFilter
      ) {
        return false;
      }

      return true;
    })
    .sort((a, b) => {
      const aNumber =
        Number(
          a.templateNumber
        ) || Number.MAX_SAFE_INTEGER;

      const bNumber =
        Number(
          b.templateNumber
        ) || Number.MAX_SAFE_INTEGER;

      if (
        aNumber !== bNumber
      ) {
        return (
          aNumber -
          bNumber
        );
      }

      return String(
        a.label || ""
      ).localeCompare(
        String(
          b.label || ""
        )
      );
    });
}


function getCardTemplate({
  templateSlug,
  version = null,
  entityId = null
}) {
  const slug =
    normalizeSlug(
      templateSlug
    );

  if (!slug) {
    throw new MosError(
      "CARD_TEMPLATE_SLUG_REQUIRED",
      "templateSlug is required.",
      null,
      400
    );
  }

  const requestedVersion =
    version === null ||
    version === undefined ||
    version === ""
      ? null
      : Number(version);

  if (
    requestedVersion !== null &&
    (
      !Number.isInteger(
        requestedVersion
      ) ||
      requestedVersion < 1
    )
  ) {
    throw new MosError(
      "CARD_TEMPLATE_VERSION_INVALID",
      "version must be a positive integer.",
      {
        version
      },
      400
    );
  }

  const matches =
    listCardTemplates({
      entityId
    }).filter(
      template =>
        template.templateSlug ===
          slug &&
        (
          requestedVersion === null ||
          template.version ===
            requestedVersion
        )
    );

  if (!matches.length) {
    throw new MosError(
      "CARD_TEMPLATE_NOT_FOUND",
      `Card Template not found: ${slug}`,
      {
        templateSlug:
          slug,

        version:
          requestedVersion
      },
      404
    );
  }

  if (
    requestedVersion === null
  ) {
    matches.sort(
      (a, b) =>
        b.version -
        a.version
    );
  }

  return matches[0];
}


function resolveCardTemplate({
  templateSlug,
  version = null,
  entityId = null
}) {
  return getCardTemplate({
    templateSlug,
    version,
    entityId
  });
}


function createCustomerCardTemplate({
  entityId,
  template
}) {
  const ownerEntityId =
    cleanText(
      entityId
    );

  if (!ownerEntityId) {
    throw new MosError(
      "CARD_TEMPLATE_ENTITY_REQUIRED",
      "entityId is required for a customer Card Template.",
      null,
      400
    );
  }

  const validated =
    validateCardTemplate(
      template
    );

  /*
   * System slugs are globally reserved.
   */
  const systemConflict =
    getSystemTemplatesValidated()
      .some(
        existing =>
          existing.templateSlug ===
            validated.templateSlug &&
          existing.version ===
            validated.version
      );

  if (systemConflict) {
    throw new MosError(
      "CARD_TEMPLATE_CONFLICT",
      "A system Card Template already uses this slug and version.",
      {
        templateSlug:
          validated.templateSlug,

        version:
          validated.version
      },
      409
    );
  }

  const store =
    readCustomerCardTemplates();

  const storageKey =
    [
      ownerEntityId,
      validated.templateSlug,
      `v${validated.version}`
    ].join(":");

  if (store[storageKey]) {
    throw new MosError(
      "CARD_TEMPLATE_CONFLICT",
      "This customer Card Template version already exists.",
      {
        entityId:
          ownerEntityId,

        templateSlug:
          validated.templateSlug,

        version:
          validated.version
      },
      409
    );
  }

  const storedTemplate = {
    ...validated,

    ownerType:
      "customer",

    entityId:
      ownerEntityId,

    createdAt:
      new Date()
        .toISOString()
  };

  store[storageKey] =
    storedTemplate;

  writeJsonFileAtomic(
    MOS_PATHS.cardTemplates,
    store
  );

  return storedTemplate;
}


module.exports = {
  listCardTemplates,
  getCardTemplate,
  resolveCardTemplate,
  createCustomerCardTemplate
};
