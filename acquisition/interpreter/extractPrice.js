const { digitsOnly } = require("./clean");

function extractPrice(text = "") {
  const value = String(text || "");

  const match = value.match(/\$\s*([\d,]+)/);

  if (!match) {
    return "";
  }

  return digitsOnly(match[1]);
}

module.exports = {
  extractPrice
};
