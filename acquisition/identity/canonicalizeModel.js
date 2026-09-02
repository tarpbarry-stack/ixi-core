const { normalizeIdentityValue } = require("./normalizeIdentity");

const WORD_REPLACEMENTS = [
  [/SUPER\s*/gi, "S"],
  [/SERIES\s*/gi, ""],
  [/MODEL\s*/gi, ""]
];

function cleanModelInput(model = "") {
  let value = String(model || "").toUpperCase().trim();

  for (const [pattern, replacement] of WORD_REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }

  return value
    .replace(/[‐-‒–—_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeModel(model = "") {
  const cleaned = cleanModelInput(model);

  if (!cleaned) return "";

  const spacedLetterSuffix = cleaned.match(
    /^([A-Z]*\d+[A-Z]*)(?:\s+)([A-Z](?:\s+[A-Z])*)$/i
  );

  if (spacedLetterSuffix) {
    const base = normalizeIdentityValue(spacedLetterSuffix[1]).replace(/-/g, "");
    const suffix = spacedLetterSuffix[2].replace(/\s+/g, "").toUpperCase();
    return `${base}${suffix}`;
  }

  return normalizeIdentityValue(cleaned).replace(/-/g, "");
}

module.exports = {
  canonicalizeModel,
  cleanModelInput
};
