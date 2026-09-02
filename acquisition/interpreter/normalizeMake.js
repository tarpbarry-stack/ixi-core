const { cleanUpper } = require("./clean");

const MAKE_ALIASES = [
  ["VOLVO CONSTRUCTION EQUIPMENT", "VOLVO"],
  ["VOLVO CE", "VOLVO"],
  ["VOLVO", "VOLVO"],

  ["CATERPILLAR", "CAT"],
  ["CAT", "CAT"],

  ["JOHN DEERE", "JOHN DEERE"],
  ["DEERE", "JOHN DEERE"],

  ["KOMATSU", "KOMATSU"],
  ["CASE CONSTRUCTION", "CASE"],
  ["CASE CE", "CASE"],
  ["CASE", "CASE"],
  ["JCB", "JCB"],
  ["BOBCAT", "BOBCAT"],
  ["TAKEUCHI", "TAKEUCHI"],
  ["KUBOTA", "KUBOTA"],
  ["DOOSAN", "DOOSAN"],
  ["DEVELON", "DEVELON"],
  ["HYUNDAI", "HYUNDAI"],
  ["HITACHI", "HITACHI"],
  ["LINK-BELT", "LINK-BELT"],
  ["SANY", "SANY"],
  ["XCMG", "XCMG"],

  ["GENIE", "GENIE"],
  ["JLG", "JLG"],
  ["SKYJACK", "SKYJACK"],

  ["WIRTGEN", "WIRTGEN"],
  ["HAMM", "HAMM"],
  ["BOMAG", "BOMAG"],
  ["DYNAPAC", "DYNAPAC"],
  ["SAKAI", "SAKAI"],

  ["FREIGHTLINER", "FREIGHTLINER"],
  ["KENWORTH", "KENWORTH"],
  ["PETERBILT", "PETERBILT"],
  ["INTERNATIONAL", "INTERNATIONAL"],
  ["MACK", "MACK"]
];

function normalizeMake(value = "") {
  const upper = cleanUpper(value);

  for (const [source, normalized] of MAKE_ALIASES) {
    if (upper === source || upper.includes(source)) {
      return normalized;
    }
  }

  return upper;
}

function getMakeAliases() {
  return MAKE_ALIASES;
}

module.exports = {
  normalizeMake,
  getMakeAliases
};
