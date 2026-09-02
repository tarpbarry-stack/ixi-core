const {
  parseAuctionTimeHtml
} = require("../parsers/parseAuctionTimeHtml");

module.exports = {
  name: "AuctionTime",

  captureProvider: "firecrawl",

  parser({
    html = "",
    url = "",
    sourceUrl = ""
  } = {}) {
    return parseAuctionTimeHtml({
      html,
      sourceUrl: sourceUrl || url
    });
  }
};
