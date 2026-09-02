function clean(value = "") {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\\u0026/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value = "") {
  return clean(String(value || "").replace(/<[^>]+>/g, " "));
}

function matchFirst(value = "", patterns = []) {
  for (const pattern of patterns) {
    const match = String(value || "").match(pattern);
    if (match?.[1]) return clean(match[1]);
  }

  return "";
}

function decodeBase64Text(value = "") {
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function decodeObfuscatedText(value = "") {
  return String(value || "")
    .replace(
      /base64Decode\(\s*['"]([^'"]+)['"]\s*\)/gi,
      (_, encoded) => decodeBase64Text(encoded)
    )
    .replace(
      /base6['"]?\s*\+\s*['"]4Dec['"]?\s*\+\s*['"]ode\(['"]?\s*\+\s*['"]([^'"]+)['"]\s*\+\s*['"]\)/gi,
      (_, encoded) => decodeBase64Text(encoded)
    )
    .replace(/eval\([^)]*\)/gi, " ");
}

function normalizeInspectionText(html = "") {
  return decodeObfuscatedText(stripTags(html));
}

function extractSerialNumber(text = "") {
  return matchFirst(text, [
    /Serial\s*#\s*(?:eval\s*)?([A-Z0-9-]{4,})/i,
    /Serial\s*#\s*[^A-Z0-9]*([A-Z0-9-]{4,})/i,
    /Serial Number\s*\/\s*VIN\s*([A-Z0-9-]{4,})/i,
    /Serial Number\s*([A-Z0-9-]{4,})/i,
    /Serial number\s*([A-Z0-9-]{4,})/i,
    /\bVIN\s*([A-Z0-9-]{4,})/i
  ]);
}

function extractStockNumber(text = "") {
  const value = matchFirst(text, [
    /Stock\s*#\s*([A-Z0-9-]{3,})/i,
    /Stock Number\s*([A-Z0-9-]{3,})/i,
    /\bLot\s*#\s*([A-Z0-9-]{3,})\b/i,
    /\bItem\s*#\s*(\d{5,})\b/i
  ]);

  // Reject obvious false positives from page prose.
  if (!/[0-9]/.test(value)) return "";

  return value;
}

function extractHours(text = "") {
  if (/meter reading could not be obtained/i.test(text)) return "";

  return matchFirst(text, [
    /Hour Meter\s*\/\s*Odometer\s*([\d,]+)\s*hrs/i,
    /Hour Meter\s*([\d,]+)\s*hrs/i,
    /Odometer\s*([\d,]+)\s*hrs/i,
    /Hours\s*([\d,]+)\s*hrs/i,
    /([\d,]+)\s*hrs\b/i
  ]);
}

function extractLocation(text = "") {
  return matchFirst(text, [
    /Located\s+([A-Z][A-Za-z\s]+,\s*[A-Z]{2})\b/i,
    /Location\s+([A-Z][A-Za-z\s]+,\s*[A-Za-z]+,\s*United States)/i,
    /\bin\s+([A-Z][A-Za-z\s]+,\s*[A-Za-z]+),\s*United States/i,
    /\b([A-Z][A-Za-z\s]+,\s*[A-Z]{2})\b/,
    /\b([A-Z][A-Za-z\s]+,\s*Texas)\b/i,
    /\b([A-Z][A-Za-z\s]+,\s*Florida)\b/i
  ]);
}

function splitLocation(location = "") {
  const value = clean(location);
  const parts = value.split(",").map(clean).filter(Boolean);

  return {
    location: value,
    city: parts[0] || "",
    state: parts[1] || ""
  };
}

function extractInspectionFacts({ html = "", text = "" } = {}) {
  const normalized = clean(
    text || normalizeInspectionText(html)
  );

  const locationParts = splitLocation(extractLocation(normalized));

  return {
    text: normalized,
    serialNumber: extractSerialNumber(normalized),
    stockNumber: extractStockNumber(normalized),
    hours: extractHours(normalized),
    location: locationParts.location,
    city: locationParts.city,
    state: locationParts.state
  };
}

module.exports = {
  extractInspectionFacts,
  normalizeInspectionText,
  extractSerialNumber,
  extractStockNumber,
  extractHours,
  extractLocation
};
