const { clean } = require("./clean");

function inferCategory(input = {}) {
  const text = clean(
    `${input.category || ""} ${input.title || ""} ${input.make || ""} ${input.model || ""} ${input.description || ""}`
  ).toLowerCase();

  if (
    text.includes("roller") ||
    text.includes("compaction") ||
    text.includes("smooth drum") ||
    text.includes("vibratory")
  ) {
    return "COMPACTION/ROLLERS";
  }

  if (text.includes("excavator")) return "EXCAVATORS";
  if (text.includes("dozer") || text.includes("bulldozer")) return "DOZERS";
  if (text.includes("wheel loader")) return "WHEEL LOADERS";
  if (text.includes("skid steer") || text.includes("compact track loader") || text.includes(" ctl ")) return "SKID STEER/CTL";
  if (text.includes("telehandler")) return "TELEHANDLERS";
  if (text.includes("forklift")) return "FORKLIFTS";
  if (text.includes("backhoe")) return "BACKHOE LOADERS";
  if (text.includes("grader")) return "MOTOR GRADERS";
  if (text.includes("dump truck")) return "DUMP TRUCKS – ARTIC/RIGID";
  if (text.includes("crane")) return "CRANES";
  if (text.includes("scraper")) return "SCRAPER";

  return "";
}

module.exports = {
  inferCategory
};
