const {
  detectSource
} = require("../lib/detectSource");

const {
  captureRenderedHtml
} = require("../capture/ixiCaptureGateway");

const platforms = require("../platforms");

async function acquireMachine(url = "") {
  const source = detectSource(url);
  const platform = platforms[source];

  if (!platform) {
    throw new Error(
      `No acquisition platform for ${source}`
    );
  }

  if (platform.legacyAdapter) {
    return platform.legacyAdapter.acquire(
      url
    );
  }

  if (
    typeof platform.parser !== "function"
  ) {
    throw new Error(
      `No parser configured for ${source}`
    );
  }

  const captureProvider =
    platform.captureProvider ||
    "firecrawl";

  const capture =
    await captureRenderedHtml({
      url,
      provider: captureProvider
    });

  if (capture?.payload?.data) {
    console.log("DATA KEYS:");
    console.log(Object.keys(capture.payload.data));

    console.log("METADATA:");
    console.log(
      JSON.stringify(
        capture.payload.data.metadata,
        null,
        2
      )
    );

    console.log("TOP LEVEL:");
    console.log(
      JSON.stringify(
        {
          title: capture.payload.data.metadata?.title,
          description: capture.payload.data.metadata?.description,
          sourceURL: capture.payload.data.metadata?.sourceURL
        },
        null,
        2
      )
    );
  }

  const result =
    await platform.parser({
      html: capture.html,
      url,
      sourceUrl: url,
      capture
    });

  return {
    ...result,

    acquisition: {
      ...(result?.acquisition || {}),

      source,
      platform:
        result?.source?.platform ||
        source,

      captureProvider:
        capture.provider ||
        captureProvider,

      capturedAt:
        capture.capturedAt ||
        new Date().toISOString(),

      requestedUrl: url,

      finalUrl:
        capture.url || url,

      status:
        capture.status ?? null
    }
  };
}

module.exports = {
  acquireMachine
};
