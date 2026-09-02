const {
  normalizeParsedListing
} = require("./parserFactory");

const {
  resolveCategoryAlias
} = require("../identity/Category/categoryAlias");

const {
  buildIdentityEngineResult
} = require("../identity/ixiIdentityEngine");

const {
  resolveMachineIdentity
} = require("../identity/resolveMachineIdentity");

const {
  ensureTaxonomyPath
} = require("../taxonomy/ensureTaxonomyPath");

function firstNonEmpty(...values) {
  for (const value of values) {
    const cleaned =
      String(value || "").trim();

    if (cleaned) return cleaned;
  }

  return "";
}

function applyIdentityToParsedListing(
  input = {}
) {
  const parsed =
    normalizeParsedListing(input);

  const parserCategory =
    resolveCategoryAlias(
      parsed.parserCategory ||
      parsed.sourceCategory ||
      ""
    );

  const evidenceIdentity =
    buildIdentityEngineResult({
      category:
        parserCategory,

      sourceCategory:
        parsed.sourceCategory || "",

      title:
        parsed.title || "",

      description:
        parsed.description ||
        parsed.visibleText ||
        "",

      url:
        parsed.url || "",

      make:
        parsed.make || "",

      model:
        parsed.model || ""
    });

  const categoryCandidate =
    firstNonEmpty(
      evidenceIdentity
        ?.categoryEvidence
        ?.winner
        ?.category,

      parserCategory,

      parsed.sourceCategory,

      evidenceIdentity
        ?.resolved
        ?.category,

      "Other / Specialty"
    );

  const makeCandidate =
    firstNonEmpty(
      evidenceIdentity
        ?.resolved
        ?.make,

      parsed.make
    );

  const modelCandidate =
    firstNonEmpty(
      parsed.model,

      evidenceIdentity
        ?.resolved
        ?.model
    );

  /*
   * Existing identity intelligence remains useful for
   * aliases, family discovery, category doctrine, and
   * model grammar.
   *
   * It is no longer allowed to block runtime acceptance.
   */
  const machineIdentity =
    resolveMachineIdentity({
      category:
        categoryCandidate,

      make:
        makeCandidate,

      model:
        modelCandidate,

      source:
        parsed.source ||
        parsed.sourceName ||
        input.source ||
        ""
    });

  /*
   * This is now the final taxonomy authority.
   *
   * It guarantees a canonical category/make/model path,
   * reuses normalized equivalents, and creates missing
   * nodes provisionally for later Admin Daddy governance.
   */
  const taxonomyPath =
    ensureTaxonomyPath({
      category:
        firstNonEmpty(
          machineIdentity?.category,
          categoryCandidate
        ),

      make:
        firstNonEmpty(
          machineIdentity?.make,
          makeCandidate
        ),

      model:
        firstNonEmpty(
          machineIdentity?.model,
          modelCandidate
        ),

      rawCategory:
        parsed.parserCategory ||
        parsed.sourceCategory ||
        categoryCandidate,

      rawMake:
        parsed.make ||
        makeCandidate,

      rawModel:
        parsed.model ||
        modelCandidate,

      source:
        parsed.source ||
        parsed.sourceName ||
        input.source ||
        "",

      sourceUrl:
        parsed.url ||
        input.url ||
        ""
    });

  const finalCategory =
    firstNonEmpty(
      taxonomyPath.category,
      machineIdentity?.category,
      categoryCandidate
    );

  const finalMake =
    firstNonEmpty(
      taxonomyPath.make,
      machineIdentity?.make,
      makeCandidate
    );

  const finalModel =
    firstNonEmpty(
      taxonomyPath.model,
      machineIdentity?.model,
      modelCandidate
    );

  const identityResolution = {
    ...(evidenceIdentity
      ?.identityResolution || {}),

    ...(machineIdentity || {}),

    category:
      finalCategory,

    make:
      finalMake,

    model:
      finalModel,

    taxonomyPath:
      taxonomyPath.taxonomyPath,

    taxonomyRuntimeStatus:
      taxonomyPath
        .taxonomyRuntimeStatus
  };

  const finalIdentity = {
    ...evidenceIdentity,

    resolved: {
      ...(evidenceIdentity
        ?.resolved || {}),

      category:
        finalCategory,

      make:
        finalMake,

      model:
        finalModel
    },

    identityResolution,

    taxonomyPath:
      taxonomyPath.taxonomyPath,

    taxonomyRuntimeStatus:
      taxonomyPath
        .taxonomyRuntimeStatus
  };

  return {
    ...parsed,

    category:
      finalCategory,

    make:
      finalMake,

    model:
      finalModel,

    taxonomyPath:
      taxonomyPath.taxonomyPath,

    taxonomyRuntimeStatus:
      taxonomyPath
        .taxonomyRuntimeStatus,

    identity:
      finalIdentity,

    identityResolution,

    categoryEvidence:
      finalIdentity.categoryEvidence,

    confidence: {
      identity:
        machineIdentity?.confidence ||
        finalIdentity.confidence ||
        "runtime-accepted",

      category:
        finalIdentity
          ?.categoryEvidence
          ?.winner
          ? "resolved"
          : "runtime-accepted",

      make:
        machineIdentity
          ?.makeResolution
          ?.confidence ||
        "runtime-accepted",

      model:
        "runtime-accepted"
    }
  };
}

module.exports = {
  applyIdentityToParsedListing
};
