const {
  canonicalizeModel
} = require("../canonicalizeModel");

function normalize(value = "") {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function splitAlphaNumeric(value = "") {
  return String(value)
    .trim()
    .toUpperCase()
    .match(/[A-Z]+|\d+/g) || [];
}

function learnModelGrammar({
  make = "",
  knownModels = []
} = {}) {
  const models = knownModels
    .map(model => String(model || "").trim())
    .filter(Boolean);

  const grammar = {
    make,
    modelCount: models.length,
    preservesHyphenBeforeGeneration: false,
    collapsesSpaces: true,
    examples: []
  };

  for (const model of models) {
    const upper = model.toUpperCase();

    if (/[A-Z]\d+-\d+$/.test(upper) || /LC-\d+$/.test(upper)) {
      grammar.preservesHyphenBeforeGeneration = true;
    }

    grammar.examples.push({
      model,
      canonical: canonicalizeModel(model),
      compact: normalize(model),
      tokens: splitAlphaNumeric(model)
    });
  }

  grammar.examples = grammar.examples.slice(0, 25);

  return grammar;
}

function applyLearnedGrammar({
  make = "",
  model = "",
  knownModels = []
} = {}) {
  const rawModel = String(model || "").trim();
  const canonical = canonicalizeModel(rawModel);
  const compact = normalize(rawModel);
  const grammar = learnModelGrammar({ make, knownModels });

  if (!rawModel) {
    return {
      model: "",
      rawModel,
      action: "missing-model",
      grammar
    };
  }

  const exactKnown = knownModels.find(item =>
    normalize(item) === compact ||
    canonicalizeModel(item) === canonical
  );

  if (exactKnown) {
    return {
      model: exactKnown,
      rawModel,
      action: "learned-exact-known-model",
      grammar
    };
  }

  if (grammar.preservesHyphenBeforeGeneration) {
    const generationMatch = canonical.match(/^([A-Z]*\d+[A-Z]*?)(\d{2})$/);

    if (generationMatch) {
      const withHyphen = `${generationMatch[1]}-${generationMatch[2]}`;

      const knownHyphen = knownModels.find(item =>
        canonicalizeModel(item) === withHyphen ||
        normalize(item) === normalize(withHyphen)
      );

      if (knownHyphen) {
        return {
          model: knownHyphen,
          rawModel,
          action: "learned-generation-hyphen-match",
          grammar
        };
      }

      return {
        model: withHyphen,
        rawModel,
        action: "learned-generation-hyphen-created",
        grammar
      };
    }
  }

  return {
    model: canonical,
    rawModel,
    action: "learned-canonical-model",
    grammar
  };
}

module.exports = {
  learnModelGrammar,
  applyLearnedGrammar,
  normalize,
  splitAlphaNumeric
};
