const { clean } = require("./clean");

function extractLocation(text = "") {
  const value = String(text || "");

  const patterns = [
    /Listed(?:\s+over\s+a\s+week\s+ago)?\s+in\s+([A-Za-z .'-]+),\s*([A-Z]{2})/i,
    /\bListed\s+in\s+([A-Za-z .'-]+),\s*([A-Z]{2})/i,
    /\b([A-Za-z .'-]+),\s*([A-Z]{2})\s*·\s*Location is approximate/i
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);

    if (match?.[1] && match?.[2]) {
      return {
        city: clean(match[1]),
        state: clean(match[2]).toUpperCase()
      };
    }
  }

  return {
    city: "",
    state: ""
  };
}

module.exports = {
  extractLocation
};
