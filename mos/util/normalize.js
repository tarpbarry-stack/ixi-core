function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeObjectType(value) {
  return normalizeKey(value);
}

function normalizeMoney(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(
    String(value).replace(/[$,\s]/g, "")
  );

  return Number.isFinite(number)
    ? Math.round(number * 100) / 100
    : null;
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  cleanText,
  normalizeKey,
  normalizeObjectType,
  normalizeMoney,
  nowIso
};
