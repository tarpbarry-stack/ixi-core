const { parseSunbeltHtml } = require("../parsers/parseSunbeltHtml");

module.exports = {
  key: "sunbelt-used",
  name: "Sunbelt Rentals Used",
  captureProvider: "playwright",
  parser: parseSunbeltHtml
};

