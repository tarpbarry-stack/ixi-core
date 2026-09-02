const {
  parseSandhillsHostedHtml
} = require("../parsers/parseSandhillsHostedHtml");

module.exports = {

  name: "Sandhills",

  captureProvider: "firecrawl",

  parser: parseSandhillsHostedHtml

};
