function clean(value = "") {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanUpper(value = "") {
  return clean(value).toUpperCase();
}

function digitsOnly(value = "") {
  return clean(value).replace(/[^\d]/g, "");
}

function limitText(value = "", max = 200) {
  const text = clean(value);

  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max).trim()}...`;
}

module.exports = {
  clean,
  cleanUpper,
  digitsOnly,
  limitText
};
