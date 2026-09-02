function createParserResult({
  source = {},
  machine = {},
  media = [],
  confidence = {},
  diagnostics = {}
} = {}) {
  return {

    source: {
      type: source.type || "",
      label: source.label || "",
      url: source.url || ""
    },

    machine: {
      title: machine.title || "",

      year: machine.year || "",
      make: machine.make || "",
      model: machine.model || "",

      category: machine.category || "",

      price: machine.price || "",
      hours: machine.hours || "",

      serialNumber: machine.serialNumber || "",
      stockNumber: machine.stockNumber || "",

      location: machine.location || "",
      city: machine.city || "",
      state: machine.state || "",

      description: machine.description || "",

      ...machine
    },

    media: Array.isArray(media)
      ? media
      : [],

    confidence,

    diagnostics
  };
}

module.exports = {
  createParserResult
};
