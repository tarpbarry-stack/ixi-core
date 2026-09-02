const fs = require("fs");

const { canonicalizeModel } = require("../identity/canonicalizeModel");
const { loadSiteTaxonomy } = require("./siteTaxonomy");

const TAXONOMY_FILE = "/var/www/ironxchange/src/config/configCategories.js";

function slugify(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function sameModel(a = "", b = "") {
  return canonicalizeModel(a) === canonicalizeModel(b);
}

function buildModelText(categoryName, makeName, modelName) {
  const id = `${slugify(categoryName)}-${slugify(makeName)}-${slugify(modelName)}`;

  return [
    "            {",
    `              "id": "${id}",`,
    `              "name": "${modelName}",`,
    '              "subcategories": []',
    "            }"
  ].join("\n");
}

function findInsertionPoint(fileText, categoryName, makeName) {
  const categoryIndex = fileText.indexOf(`"name": "${categoryName}"`);
  if (categoryIndex === -1) return null;

  const makeIndex = fileText.indexOf(`"name": "${makeName}"`, categoryIndex);
  if (makeIndex === -1) return null;

  const subcategoriesIndex = fileText.indexOf('"subcategories": [', makeIndex);
  if (subcategoriesIndex === -1) return null;

  const arrayStart = fileText.indexOf("[", subcategoriesIndex);
  if (arrayStart === -1) return null;

  let depth = 0;

  for (let i = arrayStart; i < fileText.length; i++) {
    if (fileText[i] === "[") depth++;
    if (fileText[i] === "]") depth--;

    if (depth === 0) {
      return { arrayStart, arrayEnd: i };
    }
  }

  return null;
}

function insertModelSurgically({ categoryName, makeName, modelName }) {
  const fileText = fs.readFileSync(TAXONOMY_FILE, "utf8");
  const location = findInsertionPoint(fileText, categoryName, makeName);

  if (!location) {
    return {
      ok: false,
      action: "surgical-location-not-found",
      category: categoryName,
      make: makeName,
      model: modelName
    };
  }

  const arrayBody = fileText.slice(location.arrayStart + 1, location.arrayEnd);
  const modelText = buildModelText(categoryName, makeName, modelName);

  const newArrayBody = arrayBody.trim()
    ? `${arrayBody.replace(/\s*$/, "")},\n${modelText}\n          `
    : `\n${modelText}\n          `;

  fs.writeFileSync(
    TAXONOMY_FILE,
    fileText.slice(0, location.arrayStart + 1) +
      newArrayBody +
      fileText.slice(location.arrayEnd)
  );

  return {
    ok: true,
    action: "model-added-surgical",
    category: categoryName,
    make: makeName,
    model: modelName
  };
}

function commitTaxonomyModel(input = {}) {
  const categoryName = String(input.category || "").trim();
  const makeName = String(input.make || "").trim();
  const modelName = String(input.model || "").trim().toUpperCase();

  if (!categoryName || !makeName || !modelName) {
    return {
      ok: false,
      action: "missing-required-fields",
      category: categoryName,
      make: makeName,
      model: modelName
    };
  }

  const taxonomy = loadSiteTaxonomy();

  const category = (taxonomy.categories || []).find(
    item => String(item.name).toUpperCase() === categoryName.toUpperCase()
  );

  if (!category) {
    return {
      ok: false,
      action: "category-not-found",
      category: categoryName,
      make: makeName,
      model: modelName
    };
  }

  const make = (category.subcategories || []).find(
    item => String(item.name).toUpperCase() === makeName.toUpperCase()
  );

  if (!make) {
    return {
      ok: false,
      action: "make-not-found",
      category: category.name,
      make: makeName,
      model: modelName
    };
  }

  const existing = (make.subcategories || []).find(
    item => sameModel(item.name, modelName)
  );

  if (existing) {
    return {
      ok: true,
      action: "model-already-exists",
      category: category.name,
      make: make.name,
      model: existing.name
    };
  }

  return insertModelSurgically({
    categoryName: category.name,
    makeName: make.name,
    modelName
  });
}

module.exports = {
  commitTaxonomyModel
};
