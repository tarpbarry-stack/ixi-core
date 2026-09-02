const {
  applyIdentityToParsedListing
} = require("./applyIdentityToParsedListing");

const {
  extractRouseEquipment
} = require("../engines/rouseEquipmentEngine");

function parseSunbeltHtml(html = "", context = {}) {
  const url = context.url || "";
  const rouse = extractRouseEquipment(html, { url });

  const machine = applyIdentityToParsedListing({
    ...rouse,
    parserCategory: rouse.sourceCategory,
    sourceCategory: rouse.sourceCategory,
    url
  });

  return {
    source: {
      type: "sunbelt-used",
      label: "Sunbelt Rentals Used",
      url
    },
    machine,
    media: rouse.photos || [],
    raw: {
      rouse
    }
  };
}

module.exports = {
  parseSunbeltHtml
};
