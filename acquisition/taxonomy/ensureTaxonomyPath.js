const fs = require("fs");
const path = require("path");

const {
  loadSiteTaxonomy
} = require("./siteTaxonomy");

const {
  resolveCategoryAlias
} = require("../identity/Category/categoryAlias");

const {
  resolveMakeAlias,
  normalizeMake,
  compactMake
} = require("../identity/resolveMakeAlias");

const {
  canonicalizeModel
} = require("../identity/canonicalizeModel");

const {
  applyManufacturerGrammar
} = require("../identity/Grammar/applyManufacturerGrammar");

const {
  recordIdentityAuditEvent
} = require("../audit/identityAuditLog");

const {
  queueIdentityChange
} = require("../identity/Queue/identityChangeQueue");

const TAXONOMY_FILE =
  "/var/www/ironxchange/src/config/configCategories.js";

const LOCK_FILE =
  `${TAXONOMY_FILE}.runtime.lock`;

function sleep(milliseconds) {
  const buffer =
    new SharedArrayBuffer(4);

  Atomics.wait(
    new Int32Array(buffer),
    0,
    0,
    milliseconds
  );
}

function withTaxonomyLock(callback) {
  const startedAt = Date.now();
  let lockFd = null;

  while (!lockFd) {
    try {
      lockFd = fs.openSync(
        LOCK_FILE,
        "wx"
      );
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }

      /*
       * Remove abandoned locks older than one minute.
       */
      try {
        const stat =
          fs.statSync(LOCK_FILE);

        if (
          Date.now() - stat.mtimeMs >
          60000
        ) {
          fs.unlinkSync(LOCK_FILE);
          continue;
        }
      } catch {
        continue;
      }

      if (
        Date.now() - startedAt >
        5000
      ) {
        throw new Error(
          "Timed out waiting for taxonomy lock"
        );
      }

      sleep(25);
    }
  }

  try {
    return callback();
  } finally {
    try {
      fs.closeSync(lockFd);
    } catch {}

    try {
      fs.unlinkSync(LOCK_FILE);
    } catch {}
  }
}

function cleanText(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeCategoryKey(value = "") {
  return cleanText(value)
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, "");
}

function normalizeModelKey(value = "") {
  return canonicalizeModel(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function titleCaseCategory(value = "") {
  const preserved = new Set([
    "CTL",
    "ATV",
    "UTV",
    "HVAC",
    "GPS"
  ]);

  return cleanText(value)
    .toLowerCase()
    .replace(/\b[a-z0-9]+\b/g, word => {
      const upper =
        word.toUpperCase();

      return preserved.has(upper)
        ? upper
        : word.charAt(0).toUpperCase() +
            word.slice(1);
    });
}

function canonicalizeCategory(rawCategory = "") {
  const raw =
    cleanText(rawCategory);

  if (!raw) {
    return "Other / Specialty";
  }

  const aliased =
    cleanText(
      resolveCategoryAlias(raw)
    );

  /*
   * Existing aliases return the site's canonical label.
   * Previously unseen categories receive a stable display
   * label and are queued for later admin governance.
   */
  if (
    normalizeCategoryKey(aliased) !==
    normalizeCategoryKey(raw)
  ) {
    return aliased;
  }

  return titleCaseCategory(aliased);
}

function sameCategory(a = "", b = "") {
  return (
    normalizeCategoryKey(a) ===
    normalizeCategoryKey(b)
  );
}

function sameMake(a = "", b = "") {
  const normalizedA =
    normalizeMake(a);

  const normalizedB =
    normalizeMake(b);

  return Boolean(
    normalizedA &&
    normalizedA === normalizedB
  ) || Boolean(
    compactMake(a) &&
    compactMake(a) === compactMake(b)
  );
}

function sameModel(a = "", b = "") {
  const keyA =
    normalizeModelKey(a);

  const keyB =
    normalizeModelKey(b);

  return Boolean(
    keyA &&
    keyA === keyB
  );
}

function makeId(category, make) {
  return [
    slugify(category),
    slugify(make)
  ]
    .filter(Boolean)
    .join("-");
}

function modelId(category, make, model) {
  return [
    slugify(category),
    slugify(make),
    slugify(model)
  ]
    .filter(Boolean)
    .join("-");
}

function createCategoryNode(name) {
  return {
    id: slugify(name),
    name,
    subcategories: []
  };
}

function createMakeNode(
  categoryName,
  makeName
) {
  return {
    id:
      makeId(
        categoryName,
        makeName
      ),

    name:
      makeName,

    subcategories: []
  };
}

function createModelNode(
  categoryName,
  makeName,
  modelName
) {
  return {
    id:
      modelId(
        categoryName,
        makeName,
        modelName
      ),

    name:
      modelName,

    subcategories: []
  };
}

function writeTaxonomyAtomically(
  taxonomy
) {
  const temporaryFile =
    path.join(
      path.dirname(TAXONOMY_FILE),
      `.configCategories.${process.pid}.${Date.now()}.tmp`
    );

  const output = [
    `const categoriesConfig = ${JSON.stringify(
      taxonomy,
      null,
      2
    )};`,
    "",
    "export default categoriesConfig;",
    ""
  ].join("\n");

  fs.writeFileSync(
    temporaryFile,
    output,
    "utf8"
  );

  fs.renameSync(
    temporaryFile,
    TAXONOMY_FILE
  );
}

function buildRuntimeStatus({
  categoryCreated,
  makeCreated,
  modelCreated
}) {
  const createdAnything =
    categoryCreated ||
    makeCreated ||
    modelCreated;

  return {
    runtimeAccepted: true,

    categoryCreatedNow:
      categoryCreated,

    makeCreatedNow:
      makeCreated,

    modelCreatedNow:
      modelCreated,

    frontendShouldRefreshTaxonomy:
      createdAnything,

    queuedForAdmin:
      createdAnything
  };
}

function ensureTaxonomyPath(input = {}) {
  return withTaxonomyLock(() => {
    const rawCategory =
      cleanText(
        input.category ||
        input.rawCategory
      );

    const rawMake =
      cleanText(
        input.make ||
        input.rawMake
      );

    const rawModel =
      cleanText(
        input.model ||
        input.rawModel
      );

    const canonicalCategory =
      canonicalizeCategory(
        rawCategory
      );

    const makeResolution =
      resolveMakeAlias(rawMake);

    const requestedMake =
      cleanText(
        makeResolution.make ||
        rawMake
      ).toUpperCase();

    if (
      !canonicalCategory ||
      !requestedMake ||
      !rawModel
    ) {
      return {
        ok: false,
        action:
          "taxonomy-path-missing-required-identity",

        category:
          canonicalCategory,

        make:
          requestedMake,

        model:
          canonicalizeModel(rawModel),

        rawCategory,
        rawMake,
        rawModel,

        taxonomyRuntimeStatus: {
          runtimeAccepted: false,
          categoryCreatedNow: false,
          makeCreatedNow: false,
          modelCreatedNow: false,
          frontendShouldRefreshTaxonomy: false,
          queuedForAdmin: false
        }
      };
    }

    const taxonomy =
      loadSiteTaxonomy();

    if (
      !Array.isArray(
        taxonomy.categories
      )
    ) {
      taxonomy.categories = [];
    }

    let category =
      taxonomy.categories.find(item =>
        sameCategory(
          item.name,
          canonicalCategory
        )
      );

    let categoryCreated = false;
    let makeCreated = false;
    let modelCreated = false;

    if (!category) {
      category =
        createCategoryNode(
          canonicalCategory
        );

      taxonomy.categories.push(
        category
      );

      categoryCreated = true;
    }

    if (
      !Array.isArray(
        category.subcategories
      )
    ) {
      category.subcategories = [];
    }

    /*
     * Reuse any category-local make that belongs to the
     * resolved manufacturer family.
     */
    const familyNames =
      new Set([
        requestedMake,
        rawMake,
        ...(makeResolution.familyNames || [])
      ].filter(Boolean));

    let make =
      category.subcategories.find(
        item =>
          Array.from(familyNames)
            .some(name =>
              sameMake(
                item.name,
                name
              )
            )
      );

    if (!make) {
      make =
        createMakeNode(
          category.name,
          requestedMake
        );

      category.subcategories.push(
        make
      );

      makeCreated = true;
    }

    if (
      !Array.isArray(
        make.subcategories
      )
    ) {
      make.subcategories = [];
    }

    const knownModels =
      make.subcategories
        .map(item => item.name)
        .filter(Boolean);

    const grammarResolution =
      applyManufacturerGrammar({
        make:
          make.name,

        model:
          rawModel,

        knownModels
      });

    const canonicalModel =
      cleanText(
        grammarResolution.model ||
        canonicalizeModel(rawModel)
      ).toUpperCase();

    let model =
      make.subcategories.find(item =>
        sameModel(
          item.name,
          canonicalModel
        )
      );

    if (!model) {
      model =
        createModelNode(
          category.name,
          make.name,
          canonicalModel
        );

      make.subcategories.push(
        model
      );

      modelCreated = true;
    }

    const createdAnything =
      categoryCreated ||
      makeCreated ||
      modelCreated;

    if (createdAnything) {
      writeTaxonomyAtomically(
        taxonomy
      );
    }

    const taxonomyRuntimeStatus =
      buildRuntimeStatus({
        categoryCreated,
        makeCreated,
        modelCreated
      });

    let queuedChange = null;
    let auditEvent = null;

    if (createdAnything) {
      const reason =
        [
          "Runtime taxonomy path ensured.",
          `Observed: ${rawCategory} / ${rawMake} / ${rawModel}.`,
          `Canonical: ${category.name} / ${make.name} / ${model.name}.`,
          "Customer import continued without interruption."
        ].join(" ");

      queuedChange =
        queueIdentityChange({
          type:
            "ensure-taxonomy-path",

          category:
            category.name,

          make:
            make.name,

          model:
            model.name,

          rawCategory,
          rawMake,
          rawModel,

          source:
            input.source || "",

          sourceUrl:
            input.sourceUrl ||
            input.url ||
            "",

          confidence:
            "runtime-provisional",

          reason,

          taxonomyRuntimeStatus
        });

      auditEvent =
        recordIdentityAuditEvent({
          type:
            "runtime-taxonomy-path",

          action:
            "taxonomy-path-created-or-extended",

          category:
            category.name,

          make:
            make.name,

          model:
            model.name,

          rawCategory,
          rawMake,
          rawModel,

          grammarResolution,
          makeResolution,
          taxonomyRuntimeStatus,

          reason,

          adminOptions: [
            "keep",
            "rename",
            "merge",
            "map-to-existing",
            "move-category",
            "move-make",
            "reclassify",
            "delete-new-node"
          ]
        });
    }

    return {
      ok: true,

      action: createdAnything
        ? "taxonomy-path-ensured-runtime"
        : "taxonomy-path-already-exists",

      category:
        category.name,

      make:
        make.name,

      model:
        model.name,

      rawCategory,
      rawMake,
      rawModel,

      makeResolution,
      grammarResolution,

      taxonomyRuntimeStatus,

      taxonomyPath: {
        category:
          category.name,

        make:
          make.name,

        model:
          model.name
      },

      queuedChange,
      auditEvent
    };
  });
}

module.exports = {
  ensureTaxonomyPath,
  canonicalizeCategory,
  normalizeCategoryKey,
  normalizeModelKey,
  sameCategory,
  sameMake,
  sameModel
};
