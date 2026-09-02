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

function parseTitle(title = "") {
  const value = clean(title)
    .replace(/\|\s*Ritchie Bros\. Auctioneers.*$/i, "")
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

function extractJsonLdProducts(html = "") {
  const rawObjects = [];

  for (const match of String(html).matchAll(
    /(\{"@context":"https?:\/\/schema\.org\/?"[\s\S]{0,12000?\})\s*(?=\{|"|<)/gi
  )) {
    rawObjects.push(match[1]);
  }

  const scripts = [...String(html).matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )].map(match => match[1]);

  rawObjects.push(...scripts);

  return rawObjects
    .map(raw => {
      try {
        return JSON.parse(
          clean(raw)
            .replace(/&quot;/g, '"')
        );
      } catch {
        return null;
      }
    })
    .filter(item => item && item["@type"] === "Product");
}

function extractTitle(html = "", product = {}) {
  return clean(product.name) ||
    stripTags(matchFirst(html, [
      /<title[^>]*>([\s\S]*?)<\/title>/i,
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)["']/i
    ]));
}

function extractDescription(html = "", product = {}) {
  return clean(product.description) ||
    clean(matchFirst(html, [
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i
    ]));
}

function extractPhotos(html = "", product = {}) {
  const urls = [];

  if (typeof product.image === "string") urls.push(product.image);
  if (Array.isArray(product.image)) urls.push(...product.image);

  for (const match of String(html).matchAll(
    /https?:\/\/www-ironplanet\.s3-[^"'\\\s<]+?\.(?:jpg|jpeg|png|webp)/gi
  )) {
    urls.push(match[0]);
  }

  const byImageId = new Map();

  for (const raw of urls) {
    const src = clean(raw);

    if (!src.includes("www-ironplanet")) continue;
    if (!/\.(jpg|jpeg|png|webp)$/i.test(src)) continue;

    const filename = src.split("/").pop() || "";

    // Ritchie images usually look like:
    // uuid-hr.jpg, uuid.jpg, uuid-thumb.jpg, etc.
    const id =
      filename
        .replace(/\.(jpg|jpeg|png|webp)$/i, "")
        .replace(/-(hr|large|medium|small|thumb|thumbnail)$/i, "");

    if (!id) continue;

    const current = byImageId.get(id);

    // Prefer high-resolution gallery image when available.
    if (!current || /-hr\.(jpg|jpeg|png|webp)$/i.test(src)) {
      byImageId.set(id, src);
    }
  }

  return [...byImageId.values()]
    .filter(src => /-hr\.(jpg|jpeg|png|webp)$/i.test(src))
    .slice(0, 80);
}


function extractAuctionEvent(html = "") {
  const match = String(html).match(
    /<a[^>]+href=["']([^"']*\/heavy-equipment-auctions\/[^"']+)["'][^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>[\s\S]*?<\/a>/i
  );

  if (!match) {
    return {
      name: "",
      url: ""
    };
  }

  const eventUrl = clean(match[1]);
  const eventName = clean(match[2]);

  return {
    name: eventName,
    url: eventUrl.startsWith("http")
      ? eventUrl
      : `https://www.rbauction.com${eventUrl}`
  };
}


function parseRitchieHtml({ html = "", url = "" } = {}) {
  const products = extractJsonLdProducts(html);
  const product = products[0] || {};

  const rawTitle = extractTitle(html, product);
  const titleParts = parseTitle(rawTitle);

const visibleText = stripTags(html);
const inspection = extractInspectionFacts({ html });
const auctionEvent = extractAuctionEvent(html);

  const description = extractDescription(html, product) || titleParts.title;

  const serialNumber = inspection.serialNumber;
  const hours = inspection.hours;
  const location = inspection.location;
  const city = inspection.city;
  const state = inspection.state;

  const price = money(matchFirst(visibleText, [
    /\$([\d,]{4,})/,
    /USD\s*\$?([\d,]{4,})/i
  ]));

  const photos = extractRbGalleryPhotos({
    html,
    structuredImages: Array.isArray(product.image)
      ? product.image
      : product.image
        ? [product.image]
        : [],
    source: "ritchie",
    limit: 120
  });

  const machine = applyIdentityToParsedListing({
    source: "rbauction",
    sourceName: "Ritchie Bros.",
    url,
    title: titleParts.title,
    description,
    visibleText,
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
    platform: "rbauction",
    defaultCompanyName: "Ritchie Bros.",
    machineLocation:
      machine.location ||
      location ||
      ""
  });

  return {
    source: {
      type: "rbauction",
      label: "Ritchie Bros.",
      url
    },

acquisition: {
  adapter: "ritchie",
  method: "captured-html-parser",
  saleType: "auction"
    },

sale: {
  type: "auction"
},

auction: {
  company: {
    name: "Ritchie Bros."
  },

  event: {
    name: auctionEvent.name,
    url: auctionEvent.url,
    format: /timed auction/i.test(visibleText)
      ? "timed"
      : ""
  }
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
  parseRitchieHtml
};
