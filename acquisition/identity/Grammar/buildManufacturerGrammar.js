const {
  getCategories
} = require("../../taxonomy/siteTaxonomy");

function normalizeMake(value = "") {
  return String(value).trim().toUpperCase();
}

function tokenize(model = "") {
  return String(model)
    .trim()
    .toUpperCase()
    .match(/[A-Z]+|\d+|-/g) || [];
}

function normalizeModel(model = "") {
  return String(model).trim().toUpperCase();
}

function createGrammar(make) {
  return {
    make,
    normalizedMake: normalizeMake(make),
    modelCount: 0,
    prefixes: {},
    suffixes: {},
    tokenPatterns: {},
    hyphenatedGenerations: 0,
    compactGenerations: 0,
    spacedModels: 0,
    compactModels: 0,
    examples: []
  };
}

function increment(map, key) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function addModelToGrammar(grammar, modelName) {
  const model = normalizeModel(modelName);
  if (!model || model === "OTHER") return;

  grammar.modelCount++;

  if (grammar.examples.length < 20) {
    grammar.examples.push(model);
  }

  if (model.includes(" ")) grammar.spacedModels++;
  else grammar.compactModels++;

  if (/-\d+$/.test(model)) grammar.hyphenatedGenerations++;

  if (/[A-Z]\d+$/.test(model) && !/-\d+$/.test(model)) {
    grammar.compactGenerations++;
  }

  const tokens = tokenize(model);

  if (tokens.length) increment(grammar.prefixes, tokens[0]);
  if (tokens.length > 1) increment(grammar.suffixes, tokens[tokens.length - 1]);

  increment(grammar.tokenPatterns, tokens.join("|"));
}

function buildManufacturerGrammar() {
  const grammarsByMake = {};
  const grammarsByNormalizedMake = {};

  for (const category of getCategories()) {
    for (const makeNode of category.subcategories || []) {
      const make = makeNode.name;
      const normalizedMake = normalizeMake(make);

      if (!grammarsByNormalizedMake[normalizedMake]) {
        const grammar = createGrammar(make);
        grammarsByNormalizedMake[normalizedMake] = grammar;
        grammarsByMake[make] = grammar;
      }

      const grammar = grammarsByNormalizedMake[normalizedMake];

      for (const modelNode of makeNode.subcategories || []) {
        addModelToGrammar(grammar, modelNode.name);
      }
    }
  }

  return {
    byMake: grammarsByMake,
    byNormalizedMake: grammarsByNormalizedMake
  };
}

function getManufacturerGrammar(make = "") {
  const grammars = buildManufacturerGrammar();
  return grammars.byNormalizedMake[normalizeMake(make)] || null;
}

module.exports = {
  buildManufacturerGrammar,
  getManufacturerGrammar,
  normalizeMake,
  tokenize
};
