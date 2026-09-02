const fs = require("fs");

const htmlPath =
  "acquisition/capture/artifacts/ritchie-772gp.html";

const html = fs.readFileSync(htmlPath, "utf8");

function clean(value = "") {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\\u0026/g, "&")
    .replace(/&amp;/g, "&")
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
  hasJsonLd: /application\/ld\+json/i.test(html),
  hasRedux: /__PRELOADED_STATE__|window\.__/i.test(html),
  imageCount: (html.match(/https?:\/\/[^"'\\\s]+/g) || []).filter(x =>
    /jpg|jpeg|png|webp|image|img/i.test(x)
  ).length
});

snippets("TITLE / MODEL", /772GP|John Deere|JOHN DEERE/gi);
snippets("SERIAL", /serial|serialNumber|Serial Number|VIN/gi);
snippets("HOURS / METER", /hours|meter|Meter|Hours/gi);
snippets("LOCATION", /Davenport|Florida|location|Location/gi);
snippets("IMAGES", /https?:\/\/[^"'\\\s]+(?:jpg|jpeg|png|webp)[^"'\\\s]*/gi, 10);
snippets("JSON-LD", /application\/ld\+json/gi, 5);
snippets("NEXT DATA", /__NEXT_DATA__/gi, 3);
