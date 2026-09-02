const fs = require("fs");
const { extractRouseEquipment } = require("../../engines/rouseEquipmentEngine");

const file =
  process.argv[2] ||
  "acquisition/capture/artifacts/sunbelt-az336697.html";

const html = fs.readFileSync(file, "utf8");
const result = extractRouseEquipment(html);

console.log(JSON.stringify(result, null, 2));
