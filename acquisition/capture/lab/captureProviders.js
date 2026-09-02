const {
  captureWithLocalArtifact
} = require("../providers/localArtifactProvider");

const {
  captureWithBrowserless
} = require("../providers/browserlessProvider");

const {
  captureWithFirecrawl
} = require("../providers/firecrawlProvider");

const providers = [
  {
    name: "local-artifact-control",
    enabled: true,
    capture: captureWithLocalArtifact
  },
  {
    name: "firecrawl",
    enabled: true,
    capture: captureWithFirecrawl
  },
  {
    name: "browserless",
    enabled: false,
    capture: captureWithBrowserless
  }
];

module.exports = {
  providers
};
