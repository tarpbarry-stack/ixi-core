function normalizeIdentityValue(value = "") {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[‐-‒–—]/g, "-")
    .replace(/[^A-Z0-9-]+/g, "")
    .replace(/-+/g, "-");
}

function compactModel(model = "") {
  return normalizeIdentityValue(model).replace(/-/g, "");
}

function modelFamilyKey(model = "") {
  return normalizeIdentityValue(model)
    .replace(/([0-9])([A-Z]+)$/i, "$1");
}

function numericBase(model = "") {
  const compact = compactModel(model);
  const match = compact.match(/^([A-Z]*\d+)/);
  return match ? match[1] : "";
}

function modelTokens(model = "") {
  const compact = compactModel(model);
  const match = compact.match(/^([A-Z]+)(\d+)([A-Z0-9]*)$/);

  if (!match) return null;

  return {
    prefix: match[1],
    number: match[2],
    suffix: match[3] || ""
  };
}

function isSafeModelVariant(candidate = "", existing = "") {
  const cleanCandidate = normalizeIdentityValue(candidate);
  const cleanExisting = normalizeIdentityValue(existing);

  const compactCandidate = compactModel(candidate);
  const compactExisting = compactModel(existing);

  if (!cleanCandidate || !cleanExisting) return false;
  if (cleanCandidate === cleanExisting) return true;

const candidateTokens = modelTokens(candidate);
const existingTokens = modelTokens(existing);

if (
  candidateTokens &&
  existingTokens &&
  candidateTokens.prefix === existingTokens.prefix &&
  candidateTokens.number === existingTokens.number &&
  candidateTokens.suffix &&
  existingTokens.suffix &&
  (
    candidateTokens.suffix.startsWith(existingTokens.suffix) ||
    existingTokens.suffix.startsWith(candidateTokens.suffix)
  )
) {
  return true;
}

  // SD115B from SD115
  if (modelFamilyKey(cleanCandidate) === cleanExisting) return true;

  // 310SL from 310SLHL / 310SL HL
  if (
    compactExisting.startsWith(compactCandidate) &&
    compactExisting.length > compactCandidate.length &&
    compactCandidate.length >= 4
  ) {
    return true;
  }

  // PC210LC-11 from PC210
  // 336FL from 336
  // D65PX-18 from D65
  if (
    numericBase(cleanCandidate) === compactExisting &&
    compactCandidate.length > compactExisting.length &&
    compactExisting.length >= 3
  ) {
    return true;
  }

  return false;
}

module.exports = {
  normalizeIdentityValue,
  modelFamilyKey,
  compactModel,
  numericBase,
  modelTokens,
  isSafeModelVariant
};

