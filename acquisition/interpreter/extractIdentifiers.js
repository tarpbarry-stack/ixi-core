const { cleanUpper } = require("./clean");

function extractSerialNumber(text = "") {
  const value = String(text || "");

  const patterns = [
    /\b(?:serial number|serial|s\/n|sn)\s*[:#-]?\s*([A-Z0-9\-]{4,})\b/i
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);

    if (match?.[1]) {
      return cleanUpper(match[1]);
    }
  }

  return "";
}

function extractStockNumber(text = "") {
  const value = String(text || "");

  const patterns = [
    /\b(?:stock number|stock no\.?|stock #|stk #|stk no\.?|unit id|inventory id)\s*[:#-]\s*([A-Z0-9\-]{3,})\b/i
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);

    if (match?.[1]) {
      return cleanUpper(match[1]);
    }
  }

  return "";
}

module.exports = {
  extractSerialNumber,
  extractStockNumber
};
