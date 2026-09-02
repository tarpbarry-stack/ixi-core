function normalizeParsedListing(input = {}) {
  return {
    source: input.source || "",
    sourceName: input.sourceName || input.source || "",
    url: input.url || "",

    title: input.title || "",
    description: input.description || "",
    visibleText: input.visibleText || "",

    year: input.year || "",
    make: input.make || "",
    model: input.model || "",

    hours: input.hours || "",
    price: input.price || "",

    city: input.city || "",
    state: input.state || "",

    sourceCategory: input.sourceCategory || "",
    parserCategory: input.parserCategory || "",

    serialNumber: input.serialNumber || "",
    stockNumber: input.stockNumber || "",

    photos: Array.isArray(input.photos) ? input.photos : []
  };
}

module.exports = {
  normalizeParsedListing
};
