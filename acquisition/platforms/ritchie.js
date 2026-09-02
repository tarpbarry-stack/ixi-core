const {
  parseRitchieHtml
} = require("../parsers/parseRitchieHtml");

module.exports = {

  name: "Ritchie Bros.",

  captureProvider: "firecrawl",

  parser: parseRitchieHtml

};
