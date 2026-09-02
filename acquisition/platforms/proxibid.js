const {
  parseProxibidHtml
} = require(
  "../parsers/parseProxibidHtml"
);

module.exports = {
  name: "Proxibid",

  captureProvider: "playwright",

  parser({
    html = "",
    url = "",
    sourceUrl = ""
  } = {}) {
    return parseProxibidHtml({
      html,
      sourceUrl:
        sourceUrl || url
    });
  }
};
