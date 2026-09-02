const { clean, cleanUpper } = require("./clean");
const { normalizeMake, getMakeAliases } = require("./normalizeMake");

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractIdentity(text = "", fallbackTitle = "") {
  const source = clean(`${text} ${fallbackTitle}`);

  const makeAliases = getMakeAliases();

  for (const [makePattern, normalizedMake] of makeAliases) {
    const pattern = new RegExp(
      `\\b(19[8-9]\\d|20[0-3]\\d)\\s+(${escapeRegex(makePattern)})\\s+([A-Z0-9][A-Z0-9\\-\\.\\/]+)`,
      "i"
    );

    const match = source.match(pattern);

    if (match?.[1] && match?.[3]) {
      return {
        year: match[1],
        make: normalizedMake,
        model: cleanUpper(match[3]),
        confidence: "high"
      };
    }
  }

  const loose = source.match(
    /\b(19[8-9]\d|20[0-3]\d)\s+([A-Z][A-Z\-]+(?:\s+[A-Z][A-Z\-]+){0,2})\s+([A-Z0-9][A-Z0-9\-\.\/]+)\b/i
  );

  if (loose?.[1] && loose?.[2] && loose?.[3]) {
    return {
      year: loose[1],
      make: normalizeMake(loose[2]),
      model: cleanUpper(loose[3]),
      confidence: "medium"
    };
  }

  return {
    year: "",
    make: "",
    model: "",
    confidence: "missing"
  };
}

module.exports = {
  extractIdentity
};
