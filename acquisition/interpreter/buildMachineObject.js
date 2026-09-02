const { clean, limitText } = require("./clean");
const { extractIdentity } = require("./extractIdentity");
const { extractHours } = require("./extractHours");
const { extractPrice } = require("./extractPrice");
const { extractLocation } = require("./extractLocation");

const {
  extractSerialNumber,
  extractStockNumber
} = require("./extractIdentifiers");

const { inferCategory } = require("./inferCategory");

const {
  resolveMachineIdentity
} = require("../identity/resolveMachineIdentity");

const {
  categoryEvidenceEngine
} = require("../identity/Evidence/categoryEvidenceEngine");

function buildMachineObject(input = {}) {
  const title = clean(input.title);
  const description = clean(input.description);
  const visibleText = clean(input.visibleText);
  const sourceCategory = clean(input.sourceCategory);
  const sourceName = clean(input.sourceName);
  const url = clean(input.url);

  const combinedText = clean(`${description} ${visibleText} ${title}`);

  const extractedIdentity = extractIdentity(combinedText, title);
  const location = extractLocation(visibleText || description);
  const price = clean(input.price) || extractPrice(visibleText || description);
  const hours = clean(input.hours) || extractHours(combinedText);

  const inferredCategory = inferCategory({
    category: sourceCategory,
    title,
    description,
    make: extractedIdentity.make,
    model: extractedIdentity.model
  });

  const resolvedIdentity = resolveMachineIdentity({
    category: inferredCategory,
    make: extractedIdentity.make,
    model: extractedIdentity.model
  });

const categoryEvidence = categoryEvidenceEngine({
  parserCategory: inferredCategory,
  sourceCategory,
  title,
  description,
  url,
  make: extractedIdentity.make,
  model: extractedIdentity.model,
  identityResolution: resolvedIdentity
});

  const serialNumber =
    clean(input.serialNumber) || extractSerialNumber(combinedText);

  const stockNumber =
    clean(input.stockNumber) || extractStockNumber(combinedText);

  return {
    category: resolvedIdentity.category || inferredCategory,

    year: extractedIdentity.year,
    make: resolvedIdentity.make || extractedIdentity.make,
    model: resolvedIdentity.model || extractedIdentity.model,
    hours,
    price,

    city: location.city,
    state: location.state,

    siteName: sourceName,
    url,

    description: limitText(description || visibleText, 200),

    serialNumber,
    stockNumber,

    identityResolution: resolvedIdentity,

categoryEvidence,

taxonomyRuntimeStatus:
  resolvedIdentity.modelResolution?.taxonomyRuntimeStatus || {
    runtimeAccepted: false,
    modelCreatedNow: false,
    modelAlreadyExisted: false,
    frontendShouldRefreshTaxonomy: false,
    queuedForAdmin: false
  },

    confidence: {
      identity: extractedIdentity.confidence,
      category: resolvedIdentity.category ? "resolved" : inferredCategory ? "inferred" : "missing",
      model: resolvedIdentity.confidence || "low",
      price: price ? "parsed" : "missing",
      hours: hours ? "parsed" : "missing",
      location: location.city && location.state ? "parsed" : "missing",
      description: description ? "parsed" : "missing"
    }
  };
}

module.exports = {
  buildMachineObject
};
