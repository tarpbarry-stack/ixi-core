const fs = require("fs");
const path = require("path");

async function captureWithLocalArtifact() {
  const artifactPath = path.join(
    __dirname,
    "../artifacts/sandhills-total-equipment-test.html"
  );

  const html = fs.readFileSync(artifactPath, "utf8");

  return {
    html,
    finalUrl: "local-artifact",
    rawLength: html.length
  };
}

module.exports = {
  captureWithLocalArtifact
};
