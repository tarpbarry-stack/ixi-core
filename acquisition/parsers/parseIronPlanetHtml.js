const {
  applyIdentityToParsedListing
} = require("./applyIdentityToParsedListing");

const {
  extractRbGalleryPhotos
} = require("../engines/rbMediaEngine");

const {
  extractInspectionFacts
} = require("../engines/inspectionEngine");

const {
  parseAuctionFacts
} = require("../engines/rbAuctionEngine");

function clean(value = "") {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\\u0026/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value = "") {
  return clean(String(value || "").replace(/<[^>]+>/g, " "));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function matchFirst(value = "", patterns = []) {
  for (const pattern of patterns) {
    const match = String(value || "").match(pattern);
    if (match?.[1]) return clean(match[1]);
  }
  return "";
}

function money(value = "") {
  return clean(value).replace(/[^0-9]/g, "");
}

function decodeBase64Text(value = "") {
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function decodeObfuscatedSerials(text = "") {
  return String(text || "")
    .replace(
      /base64Decode\(\s*['"]([^'"]+)['"]\s*\)/gi,
      (_, encoded) => decodeBase64Text(encoded)
    )
    .replace(
      /base6['"]?\s*\+\s*['"]4Dec['"]?\s*\+\s*['"]ode\(['"]?\s*\+\s*['"]([^'"]+)['"]\s*\+\s*['"]\)/gi,
      (_, encoded) => decodeBase64Text(encoded)
    )
    .replace(/eval\([^)]*\)/gi, "");
}

function parseTitle(title = "") {
  const value = clean(title)
    .replace(/\s*\(IronPlanet Item #[^)]+\).*$/i, "")
    .replace(/\s+in\s+.+$/i, "")
    .trim();

  const year = matchFirst(value, [/\b(19\d{2}|20\d{2})\b/]);
  const rest = year ? value.replace(year, "").trim() : value;
  const parts = rest.split(/\s+/);

  const make =
    parts[0] && parts[1] && /john/i.test(parts[0]) && /deere/i.test(parts[1])
      ? "JOHN DEERE"
      : parts[0] || "";

  const modelStart = make === "JOHN DEERE" ? 2 : 1;
  const model = parts[modelStart] || "";
  const sourceCategory = parts.slice(modelStart + 1).join(" ");

  return {
    title: value,
    year,
    make,
    model,
    sourceCategory
  };
}

function extractTitle(html = "") {
  return stripTags(matchFirst(html, [
    /<title[^>]*>([\s\S]*?)<\/title>/i,
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
  ]));
}

function extractDescription(html = "") {
  return clean(matchFirst(html, [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i
  ]));
}

function extractPhotos(html = "") {
  const urls = [];

  for (const match of String(html).matchAll(
    /"filename"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp))"/gi
  )) {
    urls.push(match[1]);
  }

  for (const match of String(html).matchAll(
    /"thumbUrl"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp))"/gi
  )) {
    urls.push(match[1]);
  }

  for (const match of String(html).matchAll(
    /https?:\/\/cdn\.ironpla\.net\/i\/[^"'\\\s<]+?\.(?:jpg|jpeg|png|webp)/gi
  )) {
    urls.push(match[0]);
  }

  const byImageId = new Map();

  for (const src of unique(
    urls
      .map(item => clean(item))
      .map(item => item.replace(/\\\//g, "/"))
.filter(item => item.includes("cdn.ironpla.net/i/"))
.filter(item => /\.(jpg|jpeg|png|webp)$/i.test(item))
.filter(item => !item.toLowerCase().includes("sprite"))
.filter(item => !item.toLowerCase().includes("logo"))
.filter(item => !item.toLowerCase().includes("banner"))
.filter(item => !item.toLowerCase().includes("/hmpg/"))
.filter(item => !item.toLowerCase().includes("/howto/"))
.filter(item => !item.toLowerCase().includes("approvals"))
.filter(item => {
  // Keep real inspection/gallery photos:
  // https://cdn.ironpla.net/i/22420/993/<uuid>.jpg
  return /cdn\.ironpla\.net\/i\/\d+\/\d+\/[a-f0-9-]+(?:-hr)?\.(jpg|jpeg|png|webp)$/i.test(item);
})

  )) {
    const filename = src.split("/").pop() || "";
    const id = filename
      .replace(/\.(jpg|jpeg|png|webp)$/i, "")
      .replace(/-(hr|large|medium|small|thumb|thumbnail)$/i, "");

    if (!id) continue;

    const current = byImageId.get(id);

    if (!current || /-hr\.(jpg|jpeg|png|webp)$/i.test(src)) {
      byImageId.set(id, src);
    }
  }

  return [...byImageId.values()]
    .sort((a, b) => {
      const aHr = /-hr\.(jpg|jpeg|png|webp)$/i.test(a) ? 0 : 1;
      const bHr = /-hr\.(jpg|jpeg|png|webp)$/i.test(b) ? 0 : 1;
      return aHr - bHr;
    })
    .slice(0, 80);

}
function parseIronPlanetHtml({ html = "", url = "" } = {}) {
const visibleText = stripTags(html);
const inspection = extractInspectionFacts({ html });
const decodedText = inspection.text;

  const rawTitle = extractTitle(html);
  const titleParts = parseTitle(rawTitle);

  const description = extractDescription(html) || titleParts.title;

const serialNumber = inspection.serialNumber;
const hours = inspection.hours;
const location = inspection.location;
const city = inspection.city;
const state = inspection.state;

  const price = money(matchFirst(decodedText, [
    /US\s*\$([\d,]+)/i,
    /\$([\d,]{4,})/
  ]));

const photos = extractRbGalleryPhotos({
  html,
  source: "ironplanet",
  limit: 120
});

  const machine = applyIdentityToParsedListing({
    source: "ironplanet",
    sourceName: "IronPlanet",
    url,
    title: titleParts.title,
    description,
    visibleText: decodedText,
    year: titleParts.year,
    make: titleParts.make,
    model: titleParts.model,
    sourceCategory: titleParts.sourceCategory,
    parserCategory: titleParts.sourceCategory,
    price,
    hours,
    location,
    city,
    state,
    serialNumber,
    stockNumber: "",
    photos
  });


  const auctionResult = parseAuctionFacts({
    html,
    sourceUrl: url,
    platform: "ironplanet",
    defaultCompanyName: "IronPlanet",
    machineLocation:
      machine.location ||
      location ||
      ""
  });

  return {
    source: {
      type: "ironplanet",
      label: "IronPlanet",
      url
    },
    acquisition: {
      adapter: "ironplanet",
      method: "captured-html-parser"
    },
    machine,
    media: photos,

    auctionEvent:
      auctionResult.auctionEvent,

    auctionLot:
      auctionResult.auctionLot,

    auctionTerms:
      auctionResult.auctionTerms,

    auction:
      auctionResult.auction,

    launchPolicy:
      auctionResult.launchPolicy,

    rawAuctionEvidence:
      auctionResult.rawAuctionEvidence,

    confidence: {
      auction:
        auctionResult.auctionConfidence,

      title: titleParts.title ? "parsed" : "missing",
      price: price ? "parsed" : "missing",
      hours: hours ? "parsed" : "missing",
      serialNumber: serialNumber ? "parsed" : "missing",
      stockNumber: "missing",
      location: location ? "parsed" : "missing",
      photos: photos.length ? "parsed" : "missing"
    }
  };
}

module.exports = {
  parseIronPlanetHtml
};
