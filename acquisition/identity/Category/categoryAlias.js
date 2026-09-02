function normalize(value = "") {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CATEGORY_ALIASES = {
  // Dozers
  "CRAWLER TRACTOR": "Dozers",
  "CRAWLER TRACTORS": "Dozers",
  "TRACTOR DOZER": "Dozers",
  "BULLDOZER": "Dozers",
  "DOZER": "Dozers",

  // Backhoe Loaders
  "BACKHOES AND INDUSTRIAL TRACTORS": "Backhoe Loaders",
  "TRACTOR LOADER BACKHOE": "Backhoe Loaders",
  "BACKHOE": "Backhoe Loaders",
  "BACKHOE LOADER": "Backhoe Loaders",

  // Excavators
  "HYDRAULIC EXCAVATOR": "Excavators",
  "EXCAVATOR": "Excavators",
  "EXCAVATORS": "Excavators",

  "EXCAVATORS MINI": "Excavators",
  "MINI EXCAVATORS": "Excavators",
  "COMPACT EXCAVATORS": "Excavators",
  "0 4 999 LB MINI EXCAVATORS": "Excavators",

  "0 10 000 LB EXCAVATORS": "Excavators",
  "10 000 20 000 LB EXCAVATORS": "Excavators",
  "20 000 35 000 LB EXCAVATORS": "Excavators",
  "35 000 50 000 LB EXCAVATORS": "Excavators",
  "50 000 75 000 LB EXCAVATORS": "Excavators",
  "75 000 99 999 LB EXCAVATORS": "Excavators",
  "100 000 LB EXCAVATORS": "Excavators",

  // Wheel Loaders
  "WHEEL LOADER": "Wheel Loaders",
  "WHEEL LOADERS": "Wheel Loaders",
  "LOADER": "Wheel Loaders",

  // Motor Graders
  "MOTOR GRADER": "Motor Graders",
  "MOTOR GRADERS": "Motor Graders",
  "GRADER": "Motor Graders",

  // Skid Steers
  "SKID STEER LOADERS": "Skid Steer / CTL",
  "SKID STEER LOADER": "Skid Steer / CTL",


};

function resolveCategoryAlias(value = "") {
  const key = normalize(value);
  return CATEGORY_ALIASES[key] || value;
}

module.exports = {
  CATEGORY_ALIASES,
  normalize,
  resolveCategoryAlias
};
