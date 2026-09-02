const { digitsOnly } = require("./clean");

function extractHours(text = "") {
  const value = String(text || "");

  const patterns = [
    /([\d,]+)\s*(?:original\s*)?(?:hrs|hours|hour)\b/i,
    /\bhours?\s*[:#-]?\s*([\d,]+)/i,
    /\bhrs?\s*[:#-]?\s*([\d,]+)/i
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);

    if (match?.[1]) {
      return digitsOnly(match[1]);
    }
  }

  return "";
}

module.exports = {
  extractHours
};
