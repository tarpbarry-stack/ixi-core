const {
  getCategories
} = require("../../taxonomy/siteTaxonomy");

function normalize(value = "") {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CATEGORY_KEYWORDS = {
  "Compaction/Rollers": [
    "ROLLER",
    "COMPACTOR",
    "VIBRATORY",
    "SINGLE DRUM",
    "DOUBLE DRUM",
    "PADFOOT",
    "SMOOTH DRUM"
  ],
  "Excavators": [
    "EXCAVATOR",
    "TRACKHOE",
    "HYDRAULIC EXCAVATOR",
    "MINI EXCAVATOR"
  ],
  "Backhoe Loaders": [
    "BACKHOE",
    "BACKHOE LOADER",
    "TRACTOR LOADER BACKHOE",
    "TLB"
  ],
  "Wheel Loaders": [
    "WHEEL LOADER",
    "LOADER"
  ],
  "Dozers": [
  "DOZER",
  "BULLDOZER",
  "CRAWLER DOZER",
  "CRAWLER TRACTOR",
  "CRAWLER TRACTORS",
  "TRACTOR DOZER"
],
  "Skid Steer/CTL": [
    "SKID STEER",
    "COMPACT TRACK LOADER",
    "CTL",
    "TRACK LOADER"
  ],
  "Motor Graders": [
    "MOTOR GRADER",
    "GRADER"
  ],
  "Telehandlers": [
    "TELEHANDLER",
    "REACH FORKLIFT",
    "LULL"
  ],
  "Forklifts": [
    "FORKLIFT",
    "LIFT TRUCK"
  ],
  "Articulated Trucks": [
    "ARTICULATED TRUCK",
    "ARTIC TRUCK",
    "ROCK TRUCK",
    "DUMP TRUCK"
  ]
};

function addScore(scores, category, amount, reason, value = "") {
  if (!category) return;

  if (!scores[category]) {
    scores[category] = {
      category,
      score: 0,
      evidence: []
    };
  }

  scores[category].score += amount;
  scores[category].evidence.push({
    score: amount,
    reason,
    value
  });
}

function categoryEvidenceEngine({
  parserCategory = "",
  title = "",
  description = "",
  url = "",
  sourceCategory = "",
  make = "",
  model = "",
  identityResolution = null
} = {}) {
  const scores = {};

  if (identityResolution?.category) {
    addScore(
      scores,
      identityResolution.category,
      100,
      "Identity Engine",
      identityResolution.category
    );
  }

  if (parserCategory) {
    addScore(scores, parserCategory, 40, "Parser Category", parserCategory);
  }

  if (sourceCategory) {
    addScore(scores, sourceCategory, 35, "Source Category", sourceCategory);
  }

  const text = normalize(`${title} ${description} ${url}`);

  for (const category of getCategories()) {
    const categoryName = category.name;
    const normalizedCategory = normalize(categoryName);

    if (text.includes(normalizedCategory)) {
      addScore(scores, categoryName, 15, "Category Name Mention", categoryName);
    }
  }

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(normalize(keyword))) {
        addScore(scores, category, 20, "Keyword Evidence", keyword);
      }
    }
  }

  const ranked = Object.values(scores)
    .sort((a, b) => b.score - a.score);

  return {
    winner: ranked[0] || null,
    ranked
  };
}

module.exports = {
  categoryEvidenceEngine,
  CATEGORY_KEYWORDS
};
