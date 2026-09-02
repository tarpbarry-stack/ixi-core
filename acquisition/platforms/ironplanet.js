const {
  parseIronPlanetV2Html
} = require("../parsers/parseIronPlanetV2Html");

module.exports = {
  name: "IronPlanet",
  captureProvider: "firecrawl",
  parser: parseIronPlanetV2Html
};
