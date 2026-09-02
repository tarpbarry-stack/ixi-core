const fs = require("fs");
const vm = require("vm");

const TAXONOMY_FILE =
  "/var/www/ironxchange/src/config/configCategories.js";

function loadSiteTaxonomy() {
  let code = fs.readFileSync(TAXONOMY_FILE, "utf8");

  code = code.replace(
    /export\s+default\s+categoriesConfig\s*;?/g,
    ""
  );

  const sandbox = {
    module: { exports: {} },
    exports: {}
  };

  vm.runInNewContext(
    `${code}\nmodule.exports = categoriesConfig;`,
    sandbox
  );

  return sandbox.module.exports;
}

function normalizeName(value = "") {
  return String(value).trim().toUpperCase();
}

function getCategories() {
  return loadSiteTaxonomy().categories || [];
}

function getKnownModels(categoryName = "", makeName = "") {
  const category = getCategories().find(
    item => normalizeName(item.name) === normalizeName(categoryName)
  );

  if (!category) return [];

  const make = (category.subcategories || []).find(
    item => normalizeName(item.name) === normalizeName(makeName)
  );

  if (!make) return [];

  return (make.subcategories || []).map(item => item.name).filter(Boolean);
}

function findCategoryByMakeModel(makeName = "", modelName = "", sameModel) {
  for (const category of getCategories()) {
    for (const make of category.subcategories || []) {
      if (normalizeName(make.name) !== normalizeName(makeName)) {
        continue;
      }

      const match = (make.subcategories || []).find(model =>
        sameModel(model.name, modelName)
      );

      if (match) {
        return {
          category: category.name,
          make: make.name,
          model: match.name
        };
      }
    }
  }

  return null;
}

module.exports = {
  loadSiteTaxonomy,
  getCategories,
  getKnownModels,
  findCategoryByMakeModel
};
