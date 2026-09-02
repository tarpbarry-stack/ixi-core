const fs = require("fs");

const htmlPath =
  "acquisition/capture/artifacts/ironplanet-wa470.html";

const html = fs.readFileSync(htmlPath, "utf8");

function clean(value = "") {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\\u0026/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function snippets(label, pattern, limit = 8) {
  const matches = [...html.matchAll(pattern)].slice(0, limit);

  console.log(`\n=== ${label} (${matches.length}) ===`);

  for (const match of matches) {
    const index = match.index || 0;
    const start = Math.max(0, index - 220);
    const end = Math.min(html.length, index + 420);

    console.log(clean(html.slice(start, end)));
    console.log("---");
  }
}

console.log({
  htmlLength: html.length,
  hasNextData: html.includes("__NEXT_DATA__"),
  hasJsonLd: /application\/ld\+json|schema\.org/i.test(html),
  hasRedux: /__PRELOADED_STATE__|window\.__/i.test(html),
  ironPlanetImageCount: (html.match(/https?:\/\/www-ironplanet\.s3[^"'\\\s<]+?\.(?:jpg|jpeg|png|webp)/gi) || []).length
});

snippets("TITLE / MODEL", /WA470|Komatsu|KOMATSU/gi);
snippets("SERIAL", /serial|serialNumber|Serial Number|VIN/gi);
snippets("HOURS / METER", /hours|meter|Meter|Hours|Odometer/gi);
snippets("LOCATION", /Texas|location|Location|TX|Fort Worth|Humble|Davenport/gi);
snippets("PRICE / BID", /\$|USD|Current Bid|Sold Price|Buy Now/gi);
snippets("IMAGES", /https?:\/\/www-ironplanet\.s3[^"'\\\s<]+?\.(?:jpg|jpeg|png|webp)/gi, 12);
snippets("JSON-LD", /application\/ld\+json|schema\.org/gi, 8);
snippets("NEXT DATA", /__NEXT_DATA__/gi, 3);
