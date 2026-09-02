const fs = require("fs");

async function captureWithFirecrawl({ url = "" } = {}) {
  const apiKey = process.env.FIRECRAWL_API_KEY;

  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY missing");
  }

  const response = await fetch(
    "https://api.firecrawl.dev/v2/scrape",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url,
        formats: [
          "html",
          "rawHtml",
          "markdown",
          "screenshot"
        ]
      })
    }
  );

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(payload));
  }

  //
  // SAVE THE RAW FIRECRAWL RESPONSE
  //
  fs.writeFileSync(
    "/tmp/firecrawl-payload.json",
    JSON.stringify(payload, null, 2),
    "utf8"
  );

  const html =
    payload.data?.rawHtml ||
    payload.data?.html ||
    "";

  return {
    html,
    finalUrl:
      payload.data?.metadata?.sourceURL ||
      url,
    rawLength: html.length,
    payload
  };
}

module.exports = {
  captureWithFirecrawl
};
