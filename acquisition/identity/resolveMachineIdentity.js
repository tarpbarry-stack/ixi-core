const {
  getCategories,
  getKnownModels
} = require("../taxonomy/siteTaxonomy");

const {
  resolveMachineModel
} = require("./resolveMachineModel");

const {
  canonicalizeModel
} = require("./canonicalizeModel");

const {
  resolveMakeAlias
} = require("./resolveMakeAlias");

function normalize(value = "") {
  return String(value).trim().toUpperCase();
}

function sameModel(a = "", b = "") {
  return canonicalizeModel(a) === canonicalizeModel(b);
}

function getMakeFamilySearchNames(makeResolution, fallbackMake = "") {
  const names = new Set();

  for (const name of makeResolution?.familyNames || []) {
    if (name) names.add(name);
  }

  if (makeResolution?.make) names.add(makeResolution.make);
  if (fallbackMake) names.add(fallbackMake);

  return Array.from(names).filter(Boolean);
}

function applyCategoryMakeDoctrine(make = "", category = "") {
  const normalizedMake = normalize(make).replace(/\s+/g, "");
  const normalizedCategory = normalize(category);

  const johnDeereFamily = [
    "JOHNDEERE",
    "DEERE",
    "JD",
    "JDEERE"
  ].includes(normalizedMake);

  const agricultureJohnDeereCategories = [
    "AGRICULTURE HARVESTERS",
    "AGRICULTURE TRACTORS",
    "UTILITY CARTS"
  ];

  if (!johnDeereFamily) return make;

  if (agricultureJohnDeereCategories.includes(normalizedCategory)) {
    return "JOHN DEERE";
  }

  return "DEERE";
}

function findCategoryByMakeAndModel(make = "", model = "", makeResolution = null) {
  const familyNames = getMakeFamilySearchNames(makeResolution, make);

  for (const familyMake of familyNames) {
    const targetMake = normalize(familyMake);

    for (const category of getCategories()) {
      for (const makeNode of category.subcategories || []) {
        if (normalize(makeNode.name) !== targetMake) continue;

        const matchedModel = (makeNode.subcategories || []).find(modelNode =>
          sameModel(modelNode.name, model)
        );

        if (matchedModel) {
          return {
            category: category.name,
            make: makeNode.name,
            model: matchedModel.name,
            taxonomyMake: makeNode.name,
            canonicalMake: makeResolution?.make || make,
            matchType: "exact-or-normalized-taxonomy-match"
          };
        }
      }
    }
  }

  return null;
}

function findBestFamilyByMake(make = "", model = "", makeResolution = null) {
  const familyNames = getMakeFamilySearchNames(makeResolution, make);
  const canonicalIncoming = canonicalizeModel(model);

  for (const familyMake of familyNames) {
    const targetMake = normalize(familyMake);

    for (const category of getCategories()) {
      for (const makeNode of category.subcategories || []) {
        if (normalize(makeNode.name) !== targetMake) continue;

        const knownModels = (makeNode.subcategories || [])
          .map(item => item.name)
          .filter(Boolean);

        const result = resolveMachineModel({
          category: category.name,
          make: makeNode.name,
          model: canonicalIncoming,
          knownModels
        });

        if (
          result.action === "existing-model" ||
          result.action === "normalized-to-existing-model" ||
          result.action === "auto-model-variant" ||
          result.action === "grammar-exact-known-model" ||
          result.action === "grammar-hyphenated-to-existing-model" ||
          result.action === "grammar-hyphenated-model" ||
          result.action === "grammar-canonical-model"
        ) {
          return {
            category: category.name,
            make: makeNode.name,
            model: result.model,
            taxonomyMake: makeNode.name,
            canonicalMake: makeResolution?.make || make,
            modelResolution: result,
            matchType: result.action
          };
        }
      }
    }
  }

  return null;
}

function resolveMachineIdentity(input = {}) {
  const makeResolution = resolveMakeAlias(input.make || "");

  const incoming = {
    category: input.category || "",
    make: makeResolution.make,
    rawMake: input.make || "",
    model: input.model || ""
  };

  if (!incoming.make || !incoming.model) {
    return {
      ...incoming,
      makeResolution,
      action: "missing-make-or-model",
      confidence: "low"
    };
  }

  const direct = findCategoryByMakeAndModel(
    incoming.make,
    incoming.model,
    makeResolution
  );

  if (direct) {
    return {
      category: direct.category,
      make: applyCategoryMakeDoctrine(direct.make, direct.category),
      rawMake: incoming.rawMake,
      makeResolution,
      taxonomyMake: direct.taxonomyMake,
      canonicalMake: direct.canonicalMake,
      model: direct.model,
      rawModel: incoming.model,
      action: direct.matchType,
      confidence: "high"
    };
  }

  const family = findBestFamilyByMake(
    incoming.make,
    incoming.model,
    makeResolution
  );

  if (family) {
    return {
      category: family.category,
      make: applyCategoryMakeDoctrine(family.make, family.category),
      rawMake: incoming.rawMake,
      makeResolution,
      taxonomyMake: family.taxonomyMake,
      canonicalMake: family.canonicalMake,
      model: family.model,
      rawModel: incoming.model,
      action: family.matchType,
      confidence: "high",
      modelResolution: family.modelResolution
    };
  }

  if (incoming.category) {
    for (const familyMake of getMakeFamilySearchNames(makeResolution, incoming.make)) {
      const knownModels = getKnownModels(
        incoming.category,
        familyMake
      );

      if (!knownModels.length) continue;

      const modelResolution = resolveMachineModel({
        category: incoming.category,
        make: familyMake,
        model: incoming.model,
        knownModels
      });

      return {
        category: incoming.category,
        make: applyCategoryMakeDoctrine(familyMake, incoming.category),
        rawMake: incoming.rawMake,
        makeResolution,
        taxonomyMake: familyMake,
        canonicalMake: incoming.make,
        model: modelResolution.model,
        rawModel: incoming.model,
        action: modelResolution.action,
        confidence: "medium",
        modelResolution
      };
    }

    return {
      category: incoming.category,
      make: applyCategoryMakeDoctrine(incoming.make, incoming.category),
      rawMake: incoming.rawMake,
      makeResolution,
      canonicalMake: incoming.make,
      model: canonicalizeModel(incoming.model),
      rawModel: incoming.model,
      action: "category-known-make-family-not-found",
      confidence: "low"
    };
  }

  return {
    category: "",
    make: incoming.make,
    rawMake: incoming.rawMake,
    makeResolution,
    canonicalMake: incoming.make,
    model: canonicalizeModel(incoming.model),
    rawModel: incoming.model,
    action: "accepted-without-category",
    confidence: "low"
  };
}

module.exports = {
  resolveMachineIdentity,
  findCategoryByMakeAndModel,
  findBestFamilyByMake,
  getMakeFamilySearchNames,
  applyCategoryMakeDoctrine
};
