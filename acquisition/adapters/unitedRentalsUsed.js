const { chromium } = require("playwright");


const {
  applyIdentityToParsedListing
} = require("../parsers/applyIdentityToParsedListing");

const {
  normalizeDrupalGalleryPhotos
} = require("../media/drupalGalleryPhotoEngine");

function text(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function moneyToNumber(value = "") {
  const cleaned = String(value || "").replace(/[^0-9.]/g, "");
  if (!cleaned) return "";
  return String(Math.round(Number(cleaned)));
}

function titleCase(value = "") {
  return text(value).replace(/\b[a-z]/g, c => c.toUpperCase());
}

function parseTitle(title = "") {
  const clean = text(title)
    .replace(/\s+For Sale.*$/i, "")
    .replace(/\s+\|\s+United Rentals.*$/i, "");

  const yearMatch = clean.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : "";

  let rest = clean.replace(year, "").trim();

  const knownMakes = [
    "John Deere",
"DEERE",
    "Caterpillar",
    "Cat",
    "Volvo",
    "Komatsu",
    "Case",
    "JCB",
    "Bobcat",
    "Kubota",
    "Takeuchi",
    "Doosan",
    "Hyundai",
    "Hitachi",
    "Kobelco",
    "Sany",
    "Link-Belt",
    "New Holland",
    "Genie",
    "JLG",
    "Skyjack"
  ];

  let make = "";
  for (const candidate of knownMakes) {
    if (rest.toLowerCase().startsWith(candidate.toLowerCase() + " ")) {
      make = candidate === "Cat" ? "CAT" : candidate;
      rest = rest.slice(candidate.length).trim();
      break;
    }
  }

  let model = rest;
  model = model
    .replace(/\bBulldozer\b/i, "")
    .replace(/\bExcavator\b/i, "")
    .replace(/\bSkid Steer\b/i, "")
    .replace(/\bWheel Loader\b/i, "")
    .replace(/\bTelehandler\b/i, "")
    .replace(/\bBoom Lift\b/i, "")
    .replace(/\bScissor Lift\b/i, "")
    .trim();

  return {
    title: clean,
    year,
    make,
    model
  };
}

function categoryFromUrlOrBreadcrumb(url = "", jsonLdGraph = []) {
  const lower = String(url).toLowerCase();

  if (lower.includes("/bulldozers/")) return "Dozers";
  if (lower.includes("/excavators/")) return "Excavators";
  if (lower.includes("/skid-steers/")) return "Skid Steer/CTL";
  if (lower.includes("/wheel-loaders/")) return "Wheel Loaders";
  if (lower.includes("/telehandlers/")) return "Telehandlers";
  if (lower.includes("/boom-lifts/")) return "Aerial Equipment";
  if (lower.includes("/scissor-lifts/")) return "Aerial Equipment";
  if (lower.includes("/forklifts/")) return "Forklifts";

  const webPage = jsonLdGraph.find(item => item["@type"] === "WebPage");
  const crumbs = webPage?.breadcrumb?.itemListElement || [];
  const names = crumbs.map(c => c.name).join(" ").toLowerCase();

  if (names.includes("bulldozer")) return "Dozers";
  if (names.includes("excavator")) return "Excavators";
  if (names.includes("wheel loader")) return "Wheel Loaders";
  if (names.includes("telehandler")) return "Telehandlers";
  if (names.includes("forklift")) return "Forklifts";

  return "";
}

function findLineValue(bodyText = "", label = "") {
  const lines = String(bodyText || "")
    .split(/\n+/)
    .map(text)
    .filter(Boolean);

  const target = label.toLowerCase();

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase() === target && lines[i + 1]) {
      return lines[i + 1];
    }

    const inline = lines[i].match(new RegExp(`^${label}\\s*:?\\s*(.+)$`, "i"));
    if (inline) return text(inline[1]);
  }

  return "";
}


function parseHours(bodyText = "") {
  const meter =
    findLineValue(bodyText, "Meter") ||
    findLineValue(bodyText, "Meter Reading") ||
    findLineValue(bodyText, "Hours") ||
    findLineValue(bodyText, "Hour Meter") ||
    "";

  const match = String(meter || "").match(/([\d,]+)/);

  return match ? match[1].replace(/,/g, "") : "";
}

function parseSerial(bodyText = "") {
  return (
    findLineValue(bodyText, "Serial Number") ||
    findLineValue(bodyText, "Serial #") ||
    findLineValue(bodyText, "Serial") ||
    ""
  );
}

async function acquire(url) {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
    });

await page.goto(url, {
  waitUntil: "domcontentloaded",
  timeout: 60000
});

await page.waitForTimeout(2500);

    const pageData = await page.evaluate(() => {
      const bodyText = document.body.innerText || "";

      const images = Array.from(document.images).map(img => ({
        src: img.src,
        currentSrc: img.currentSrc,
        alt: img.alt,
        width: img.naturalWidth,
        height: img.naturalHeight
      }));

      const jsonLd = Array.from(
        document.querySelectorAll('script[type="application/ld+json"]')
      ).map(s => s.innerText);

      const canonical =
        document.querySelector('link[rel="canonical"]')?.href || location.href;

      return {
        title: document.title,
        canonical,
        bodyText,
        images,
        jsonLd
      };
    });

    let graph = [];
    for (const raw of pageData.jsonLd || []) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed["@graph"])) {
          graph = graph.concat(parsed["@graph"]);
        }
      } catch (err) {}
    }

    const product = graph.find(item => item["@type"] === "Product") || {};
    const business = graph.find(item => item["@type"] === "LocalBusiness") || {};

    const titleParts = parseTitle(product.name || pageData.title);
    const photos = normalizeDrupalGalleryPhotos(pageData.images);

    const address = business.address || {};
    const city = address.addressLocality || "";
    const state = address.addressRegion || "";
    const location = [city, state].filter(Boolean).join(", ");

    const price = moneyToNumber(product?.offers?.price || "");
    const serialNumber = parseSerial(pageData.bodyText);
    const hours = parseHours(pageData.bodyText);

    const category = categoryFromUrlOrBreadcrumb(pageData.canonical, graph);

    const stockNumber =
      product.sku ||
      findLineValue(pageData.bodyText, "Equipment ID") ||
      findLineValue(pageData.bodyText, "Equipment #") ||
      "";

const machine = applyIdentityToParsedListing({
  title: titleParts.title,
  year: titleParts.year,
  make: titleCase(titleParts.make || product?.brand?.name || ""),
  model: titleParts.model,
  parserCategory: category,
  sourceCategory: category,
  category,
  price,
  hours,
  city,
  state,
  location,
  stockNumber,
  serialNumber,
  seller: "United Rentals",
  sourceUrl: pageData.canonical,
  url: pageData.canonical,
  description: `Used ${titleParts.title} for sale from United Rentals in ${location}.`,
  media: photos
});

    return {
      ok: true,
      source: {
        type: "united-rentals-used",
        label: "United Rentals Used",
        url
      },
      machine,
      media: photos,
      confidence: photos.length && product.name ? "high" : "medium",
      debug: {
        platform: "drupal-used-equipment",
        photoCount: photos.length,
        jsonLdProduct: Boolean(product.name),
        jsonLdBusiness: Boolean(business.name)
      }
    };
  } finally {
    await browser.close();
  }
}

module.exports = {
  acquire
};
