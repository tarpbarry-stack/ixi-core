const fs = require("fs");
const path = require("path");

const { getCategories } = require("../taxonomy/siteTaxonomy");

const KNOWLEDGE_FILE = path.join(
  __dirname,
  "manufacturerKnowledge.json"
);

function normalizeMake(value = "") {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\b(CONSTRUCTION|EQUIPMENT|MACHINERY|MACHINE|CE|CO|COMPANY|CORP|INC|LLC|LTD)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactMake(value = "") {
  return normalizeMake(value).replace(/\s+/g, "");
}

function readManufacturerKnowledge() {
  try {
    return JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, "utf8"));
  } catch {
    return { version: 1, manufacturers: [] };
  }
}

function getKnownMakes() {
  const makes = new Map();

  for (const category of getCategories()) {
    for (const make of category.subcategories || []) {
      const key = normalizeMake(make.name);
      if (key) makes.set(key, make.name);
    }
  }

  return makes;
}

function getMakeFamilyNames(make = "") {
  const target = normalizeMake(make);
  const targetCompact = compactMake(make);
  const knowledge = readManufacturerKnowledge();
  const names = new Set();

  if (make) names.add(make);

  for (const item of knowledge.manufacturers || []) {
    const canonical = String(item.canonical || "").trim();
    const aliases = Array.isArray(item.aliases) ? item.aliases : [];
    const all = [canonical, ...aliases].filter(Boolean);

    const match = all.some(name =>
      normalizeMake(name) === target ||
      compactMake(name) === targetCompact
    );

    if (match) {
      all.forEach(name => names.add(name));
      if (canonical) names.add(canonical);
    }
  }

  return Array.from(names);
}

function getKnowledgeAliases() {
  const knowledge = readManufacturerKnowledge();
  const aliases = new Map();

  for (const item of knowledge.manufacturers || []) {
    const canonical = String(item.canonical || "").trim();
    if (!canonical) continue;

    aliases.set(normalizeMake(canonical), canonical);
    aliases.set(compactMake(canonical), canonical);

    for (const alias of item.aliases || []) {
      aliases.set(normalizeMake(alias), canonical);
      aliases.set(compactMake(alias), canonical);
    }
  }

  return aliases;
}

function levenshtein(a = "", b = "") {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);

  for (let j = 1; j <= b.length; j++) m[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      m[i][j] = Math.min(
        m[i - 1][j] + 1,
        m[i][j - 1] + 1,
        m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }

  return m[a.length][b.length];
}

function resolveMakeAlias(make = "") {
  const rawMake = String(make || "").trim();
  const normalized = normalizeMake(rawMake);
  const compact = compactMake(rawMake);

  if (!normalized) {
    return {
      make: "",
      rawMake,
      familyNames: [],
      action: "missing-make",
      confidence: "low"
    };
  }

  const aliases = getKnowledgeAliases();

  if (aliases.has(normalized)) {
    const resolved = aliases.get(normalized);
    return {
      make: resolved,
      rawMake,
      familyNames: getMakeFamilyNames(resolved),
      action: "manufacturer-knowledge-alias",
      confidence: "high"
    };
  }

  if (aliases.has(compact)) {
    const resolved = aliases.get(compact);
    return {
      make: resolved,
      rawMake,
      familyNames: getMakeFamilyNames(resolved),
      action: "manufacturer-knowledge-alias",
      confidence: "high"
    };
  }

  const knownMakes = getKnownMakes();

  if (knownMakes.has(normalized)) {
    const resolved = knownMakes.get(normalized);
    return {
      make: resolved,
      rawMake,
      familyNames: getMakeFamilyNames(resolved),
      action: "exact-taxonomy-make",
      confidence: "high"
    };
  }

  let best = null;

  for (const [knownKey, knownName] of knownMakes.entries()) {
    const knownCompact = knownKey.replace(/\s+/g, "");
    const distance = levenshtein(compact, knownCompact);
    const maxLength = Math.max(compact.length, knownCompact.length);
    const score = maxLength ? 1 - distance / maxLength : 0;

    if (!best || score > best.score) {
      best = { make: knownName, score, distance };
    }
  }

  if (best && best.score >= 0.86 && best.distance <= 2 && compact.length >= 4) {
    return {
      make: best.make,
      rawMake,
      familyNames: getMakeFamilyNames(best.make),
      action: "fuzzy-taxonomy-make-match",
      confidence: "medium",
      score: best.score
    };
  }

  return {
    make: rawMake.toUpperCase(),
    rawMake,
    familyNames: [rawMake.toUpperCase()],
    action: "unresolved-make-accepted",
    confidence: "low"
  };
}

module.exports = {
  resolveMakeAlias,
  normalizeMake,
  compactMake,
  getKnownMakes,
  getMakeFamilyNames,
  readManufacturerKnowledge
};
