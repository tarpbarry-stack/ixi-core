const {
  applyIdentityToParsedListing
} = require("../parsers/applyIdentityToParsedListing");

const {
  createParserResult
} = require("../platform/parserContract");

function buildMachineObject(raw = {}) {

  const machine =
    applyIdentityToParsedListing(raw);

  return createParserResult({

    source: {
      type: raw.source || "",
      label: raw.sourceName || "",
      url: raw.url || ""
    },

    machine,

    media: raw.photos || [],

    confidence: raw.confidence || {},

    diagnostics: raw.diagnostics || {}

  });

}

module.exports = {
  buildMachineObject
};
