const crypto = require("crypto");

function createMosId(prefix) {
  const normalizedPrefix =
    String(prefix || "mos")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "mos";

  return `${normalizedPrefix}_${crypto.randomUUID()}`;
}

module.exports = {
  createMosId
};
