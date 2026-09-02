function isPresent(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim() !== "";
  }

  return true;
}

function firstPresent(...values) {
  for (const value of values) {
    if (isPresent(value)) {
      return value;
    }
  }

  return null;
}

function firstString(...values) {
  const value =
    firstPresent(...values);

  if (!isPresent(value)) {
    return "";
  }

  return String(value).trim();
}

function normalizeText(value) {
  return firstString(value)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUpper(value) {
  return normalizeText(value)
    .toUpperCase();
}

function normalizeLower(value) {
  return normalizeText(value)
    .toLowerCase();
}

function normalizeIdPart(value) {
  return normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  const normalized =
    normalizeLower(value);

  if (
    [
      "true",
      "yes",
      "y",
      "1",
      "met",
      "sold",
      "closed"
    ].includes(normalized)
  ) {
    return true;
  }

  if (
    [
      "false",
      "no",
      "n",
      "0",
      "not met",
      "reserve not met",
      "unsold",
      "open"
    ].includes(normalized)
  ) {
    return false;
  }

  return null;
}

function normalizeNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  const normalized =
    String(value)
      .replace(/[$,%\s]/g, "")
      .replace(/,/g, "")
      .trim();

  if (!normalized) {
    return null;
  }

  const number =
    Number(normalized);

  return Number.isFinite(number)
    ? number
    : null;
}

function normalizeDateTime(value) {
  if (!isPresent(value)) {
    return "";
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? ""
      : value.toISOString();
  }

  const text =
    normalizeText(value);

  if (!text) {
    return "";
  }

  const timestamp =
    Date.parse(text);

  if (Number.isNaN(timestamp)) {
    return "";
  }

  return new Date(timestamp)
    .toISOString();
}

function compactObject(value) {
  if (Array.isArray(value)) {
    return value
      .map(compactObject)
      .filter(item => {
        if (item === null || item === undefined) {
          return false;
        }

        if (typeof item === "string") {
          return item.trim() !== "";
        }

        return true;
      });
  }

  if (
    !value ||
    typeof value !== "object"
  ) {
    return value;
  }

  const result = {};

  for (
    const [key, item] of
    Object.entries(value)
  ) {
    if (
      item === null ||
      item === undefined
    ) {
      continue;
    }

    if (
      typeof item === "string" &&
      item.trim() === ""
    ) {
      continue;
    }

    const compacted =
      compactObject(item);

    if (
      compacted &&
      typeof compacted === "object" &&
      !Array.isArray(compacted) &&
      Object.keys(compacted).length === 0
    ) {
      continue;
    }

    result[key] =
      compacted;
  }

  return result;
}

function uniqueStrings(values = []) {
  const seen =
    new Set();

  const result = [];

  for (const value of values) {
    const text =
      normalizeText(value);

    if (!text) {
      continue;
    }

    const key =
      text.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(text);
  }

  return result;
}

module.exports = {
  isPresent,
  firstPresent,
  firstString,
  normalizeText,
  normalizeUpper,
  normalizeLower,
  normalizeIdPart,
  normalizeBoolean,
  normalizeNumber,
  normalizeDateTime,
  compactObject,
  uniqueStrings
};
