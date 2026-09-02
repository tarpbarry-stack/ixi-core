const {
  captureWithFirecrawl
} = require("./providers/firecrawlProvider");

const {
  captureWithPlaywright
} = require("./providers/playwrightProvider");

async function captureRenderedHtml({
  url = "",
  provider = "firecrawl"
} = {}) {
  if (!url) {
    throw new Error(
      "captureRenderedHtml requires url"
    );
  }

  if (provider === "playwright") {
    return captureWithPlaywright({
      url
    });
  }

  if (provider === "firecrawl") {
    const result =
      await captureWithFirecrawl({
        url
      });

    return {
      ...result,
      provider: "firecrawl"
    };
  }

  throw new Error(
    `Unsupported capture provider: ${provider}`
  );
}

module.exports = {
  captureRenderedHtml
};
