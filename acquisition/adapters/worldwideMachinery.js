const { JSDOM } = require("jsdom");

const {
  applyIdentityToParsedListing
} = require("../parsers/applyIdentityToParsedListing");

function text(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function money(value = "") {
  return text(value).replace(/[^0-9]/g, "");
}

function firstMatch(value = "", patterns = []) {
  for (const pattern of patterns) {
    const match = String(value || "").match(pattern);
    if (match?.[1]) return text(match[1]);
  }

  return "";
}

function extractProductJsonLd(document) {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const json = JSON.parse(script.textContent || "{}");

      const graph = Array.isArray(json["@graph"])
        ? json["@graph"]
        : [json];

      const product = graph.find(item => item?.["@type"] === "Product");

      if (product) return product;
    } catch {}
  }

  return {};
}

function parseTitle(title = "") {
  const clean = text(title);

  const year = firstMatch(clean, [/^(\d{4})\b/]);
  const withoutYear = year ? clean.replace(year, "").trim() : clean;

  const parts = withoutYear.split(/\s+/);
  const make = parts[0] || "";
  const model = parts[1] || "";
  const category = parts.slice(2).join(" ");

  return {
    year,
    make,
    model,
    category
  };
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

async function acquire(url = "") {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; IXIAcquisitionBot/1.0; +https://ironxchange.com)"
    }
  });

  if (!response.ok) {
    throw new Error(`Worldwide Machinery fetch failed: ${response.status}`);
  }

  const html = await response.text();
  const dom = new JSDOM(html);
  const document = dom.window.document;

  const bodyText = text(document.body?.textContent || "");
const product = extractProductJsonLd(document);

  const h1 =
    text(document.querySelector("h1")?.textContent) ||
    text(document.querySelector("title")?.textContent);

  const titleParts = parseTitle(h1);

  const price = money(
    firstMatch(bodyText, [
      /Price\s*\$?([\d,]+)/i,
      /\$([\d,]{4,})/
    ])
  );

const hours = firstMatch(bodyText, [
  /([0-9,]+)\s*hrs?\./i,
  /([0-9,]+)\s*hours/i,
  /Hours\s*:?\s*([0-9,]+)/i,
  /Hour Meter\s*:?\s*([0-9,]+)/i
]);

const stockNumber =
  text(product.sku || "") ||
  firstMatch(bodyText, [
    /\b([A-Z0-9]{10,})\b/,
    /Stock\s*(?:#|Number)?\s*:?\s*([A-Z0-9-]+)/i,
    /Stock ID\s*:?\s*([A-Z0-9-]+)/i
  ]);
  const serialNumber = firstMatch(bodyText, [
    /Serial\s*(?:#|Number)?\s*:?\s*([A-Z0-9-]+)/i,
    /VIN\s*:?\s*([A-Z0-9-]+)/i
  ]);

const location = firstMatch(bodyText, [
  /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*,\s*[A-Z]{2})\s+(?:Cab|[A-Z][a-zA-Z]+ Model|\$|Used)/,
  /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*,\s*[A-Z]{2})/
]);

const city = location.includes(",")
  ? text(location.split(",")[0])
  : "";

const state = location.includes(",")
  ? text(location.split(",")[1])
  : "";

let description = "";

for (const script of document.querySelectorAll(
  'script[type="application/ld+json"]'
)) {
  try {
    const json = JSON.parse(script.textContent);

    const graph = Array.isArray(json["@graph"])
      ? json["@graph"]
      : [json];

    const product = graph.find(
      item => item["@type"] === "Product"
    );

    if (product?.description) {
      description = text(product.description);
      break;
    }
  } catch {}
}

if (!description) {
  description = h1;
}



const heroImage = String(product.image || "");
const heroNumber = Number(heroImage.match(/(\d{7})/)?.[1] || 0);

const photos = unique(
  [
    heroImage,
    ...[...document.querySelectorAll("img")]
      .map(img => img.getAttribute("src") || img.getAttribute("data-src") || "")
  ]
    .map(src => {
      if (!src) return "";

      try {
        return new URL(src, url).href;
      } catch {
        return "";
      }
    })
    .filter(src => {
      if (!src.includes("/wp-content/uploads/")) return false;
      if (!/\.(jpg|jpeg|png|webp)(\?|$)/i.test(src)) return false;

      const lower = src.toLowerCase();

      if (
        lower.includes(".svg") ||
        lower.includes("logo") ||
        lower.includes("placeholder") ||
        lower.includes("superior")
      ) {
        return false;
      }

      const imageNumber = Number(src.match(/(\d{7})/)?.[1] || 0);

      if (heroNumber && imageNumber) {
        return imageNumber >= heroNumber && imageNumber <= heroNumber + 6;
      }

      return false;
    })
);

  const machine = applyIdentityToParsedListing({
    source: "worldwide-machinery",
    sourceName: "Worldwide Machinery",
    url,
    title: h1,
    description,
    visibleText: bodyText,
    year: titleParts.year,
    make: titleParts.make,
    model: titleParts.model,
    sourceCategory: titleParts.category,
    parserCategory: titleParts.category,
    price,
    hours,
    city,
    state,
    location,
    stockNumber,
    serialNumber,
    photos
  });

  return {
    source: {
      type: "worldwide-machinery",
      label: "Worldwide Machinery",
      url
    },
    acquisition: {
      adapter: "worldwideMachinery",
      method: "static-html"
    },
    machine,
    media: photos,
    confidence: {
      title: h1 ? "parsed" : "missing",
      price: price ? "parsed" : "missing",
      hours: hours ? "parsed" : "missing",
      location: location ? "parsed" : "missing",
      photos: photos.length ? "parsed" : "missing"
    }
  };
}

module.exports = {
  acquire
};
