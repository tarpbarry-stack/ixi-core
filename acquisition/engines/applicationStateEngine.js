function clean(value = "") {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\\u0026/g, "&")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeJsonParse(raw = "") {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractNextData(html = "") {
  const match = String(html).match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );

  if (!match) return null;

  return safeJsonParse(match[1]);
}

function extractNextFlight(html = "") {
  const matches = [];

  for (const match of String(html).matchAll(
    /self\.__next_f\.push\(([\s\S]*?)\);/gi
  )) {
    matches.push(match[1]);
  }

  return matches;
}

function extractRedux(html = "") {
  const match = String(html).match(
    /window\.__PRELOADED_STATE__\s*=\s*([\s\S]*?);\s*<\/script>/i
  );

  if (!match) return null;

  return safeJsonParse(match[1]);
}

function extractInitialState(html = "") {
  const match = String(html).match(
    /window\.__INITIAL_STATE__\s*=\s*([\s\S]*?);\s*<\/script>/i
  );

  if (!match) return null;

  return safeJsonParse(match[1]);
}

function extractApollo(html = "") {
  const match = String(html).match(
    /__APOLLO_STATE__["']?\s*:\s*({[\s\S]*?})[,}]/i
  );

  if (!match) return null;

  return safeJsonParse(match[1]);
}

function extractJsonObjects(html = "") {
  const results = [];

  for (const match of String(html).matchAll(
    /({[\s\S]{100,50000?}})/g
  )) {
    const parsed = safeJsonParse(match[1]);

    if (parsed && typeof parsed === "object") {
      results.push(parsed);
    }
  }

  return results;
}

function extractApplicationState(html = "") {

  const nextData = extractNextData(html);

  const nextFlight = extractNextFlight(html);

  const redux = extractRedux(html);

  const initialState = extractInitialState(html);

  const apollo = extractApollo(html);

  const jsonObjects = extractJsonObjects(html);

  return {

    nextData,

    nextFlight,

    redux,

    initialState,

    apollo,

    jsonObjects,

    discovery: {

      hasNextData: Boolean(nextData),

      hasNextFlight:
        nextFlight.length > 0,

      hasRedux:
        Boolean(redux),

      hasInitialState:
        Boolean(initialState),

      hasApollo:
        Boolean(apollo),

      jsonObjectCount:
        jsonObjects.length
    }
  };
}

module.exports = {
  extractApplicationState
};
