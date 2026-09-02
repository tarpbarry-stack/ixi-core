const {
  canonicalizeModel
} = require("../canonicalizeModel");

const {
  getManufacturerGrammar
} = require("./buildManufacturerGrammar");

function compact(value = "") {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function likelyUsesGenerationHyphen(grammar) {
  if (!grammar || !grammar.modelCount) return false;

  return grammar.hyphenatedGenerations >= 20 &&
    grammar.hyphenatedGenerations >= grammar.compactGenerations * 0.35;
}

function applyGenerationHyphen(model = "") {
  const value = canonicalizeModel(model);

  const match = value.match(/^([A-Z]+\d+[A-Z]*)(\d{2})$/);

  if (!match) return value;

  return `${match[1]}-${match[2]}`;
}

function applyManufacturerGrammar({
  make = "",
  model = "",
  knownModels = []
} = {}) {
  const rawModel = String(model || "").trim();
  const canonical = canonicalizeModel(rawModel);
  const grammar = getManufacturerGrammar(make);

  const exactKnown = knownModels.find(item =>
    compact(item) === compact(rawModel) ||
    compact(item) === compact(canonical)
  );

  if (exactKnown) {
    return {
      model: exactKnown,
      rawModel,
      action: "grammar-exact-known-model",
      grammarApplied: false,
      grammar
    };
  }

  if (likelyUsesGenerationHyphen(grammar)) {
    const hyphenated = applyGenerationHyphen(canonical);

    if (hyphenated !== canonical) {
      const knownHyphenated = knownModels.find(item =>
        compact(item) === compact(hyphenated)
      );

      return {
        model: knownHyphenated || hyphenated,
        rawModel,
        action: knownHyphenated
          ? "grammar-hyphenated-to-existing-model"
          : "grammar-hyphenated-model",
        grammarApplied: true,
        grammar
      };
    }
  }

  return {
    model: canonical,
    rawModel,
    action: "grammar-canonical-model",
    grammarApplied: false,
    grammar
  };
}

module.exports = {
  applyManufacturerGrammar,
  likelyUsesGenerationHyphen,
  applyGenerationHyphen,
  compact
};
