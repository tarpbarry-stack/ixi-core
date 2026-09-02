const { chromium } = require("playwright");

const {
  applyIdentityToParsedListing
} = require("../parsers/applyIdentityToParsedListing");

const {
  filterMachinePhotos
} = require("../media/filterMachinePhotos");

const {
  normalizeShopifyMachinePhotos
} = require("../media/shopifyPhotoEngine");

function clean(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function matchFirst(text = "", patterns = []) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return clean(match[1]);
  }
  return "";
}

function parseTitle(title = "") {
  const value = clean(title).replace(/^Used\s+/i, "");
  const match = value.match(/^(\d{4})\s+([A-Za-z]+)\s+(.+)$/);

  if (!match) {
    return {
      year: "",
      make: "",
      model: value
    };
  }

  return {
    year: match[1],
    make: match[2],
    model: clean(match[3])
  };
}


function parseLocation(text = "") {
  const match = text.match(/\bLocation\s+([A-Z][A-Za-z .'-]+),\s*([A-Z]{2})\b/i);

  return {
    city: match ? clean(match[1]) : "",
    state: match ? clean(match[2]) : ""
  };
}

async function acquire(url) {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1200 }
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    await page.waitForTimeout(2500);

    const data = await page.evaluate(() => {
      const text = document.body ? document.body.innerText : "";

      const title =
        document.querySelector("h1")?.innerText ||
        document.title ||
        "";

      const metaDescription =
        document.querySelector('meta[name="description"]')?.content ||
        document.querySelector('meta[property="og:description"]')?.content ||
        "";

      const ogImage =
        document.querySelector('meta[property="og:image"]')?.content || "";

const gallery =
  document.querySelector("media-gallery.product-media-gallery") ||
  document.querySelector(".product-media-gallery") ||
  document.querySelector(".product-media-gallery-wrap");

const galleryImages = gallery
  ? Array.from(gallery.querySelectorAll("img"))
  : [];

const images = galleryImages
  .map(img =>
    img.src ||
    img.currentSrc ||
    img.getAttribute("src") ||
    img.getAttribute("data-src") ||
    img.getAttribute("data-original") ||
    ""
  )
  .filter(Boolean);
      return {
        title,
        text,
        metaDescription,
        ogImage,
        images
      };
    });

    const visibleText = clean(data.text);
    const rawTitle = clean(data.title);
    const title = rawTitle.replace(/\s*[–|-]\s*Used Equipment.*$/i, "");
    const parsedTitle = parseTitle(title);

const rawPrice = matchFirst(visibleText, [
  /Regular price\s*\$?([\d,]+(?:\.\d{2})?)/i,
  /\$([\d,]+(?:\.\d{2})?)/
]);

const price = rawPrice
  ? rawPrice.replace(/,/g, "").replace(/\.00$/, "")
  : "";

    const stockNumber = matchFirst(visibleText, [
      /\bSKU:\s*([A-Z0-9-]+)/i,
      /\bStock(?:\s*Number)?[:#]?\s*([A-Z0-9-]+)/i,
      /\b([0-9]{5,})\b/
    ]);

    const hours = matchFirst(visibleText, [
      /\bHours[:\s]+([\d,]+)\b/i,
      /\b([\d,]+)\s*hours\b/i
    ]);

    const location = parseLocation(visibleText);

const sourceCategory = matchFirst(visibleText, [
  /\bClass\s+([A-Za-z0-9 ,&/-]+?)\s+Manufacturer\b/i,
  /\bCASE\s+USED\s+\d{4}\s+CASE\s+\S+\s+([A-Za-z]+)\s+[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}\b/i
]);

const rawPhotos = filterMachinePhotos(
  Array.from(new Set([
    data.ogImage,
    ...(data.images || [])
  ].filter(Boolean)))
);

const photos = normalizeShopifyMachinePhotos(rawPhotos);
    const description =
      data.metaDescription ||
      [
        title,
        sourceCategory ? `Category: ${sourceCategory}` : "",
        location.city && location.state
          ? `Location: ${location.city}, ${location.state}`
          : "",
        stockNumber ? `Stock/SKU: ${stockNumber}` : ""
      ].filter(Boolean).join(". ");

    const machine = applyIdentityToParsedListing({
      source: "equipmentshare-used",
      sourceName: "EquipmentShare Used",
      url,
      title,
      description,
      visibleText,
      year: parsedTitle.year,
      make: parsedTitle.make,
      model: parsedTitle.model,
      hours,
      price,
      city: location.city,
      state: location.state,
      sourceCategory,
      parserCategory: sourceCategory,
      serialNumber: matchFirst(visibleText, [
  /\bSerial Number\s+([A-Z0-9-]+)/i
]),
      stockNumber,
      photos
    });

    return {
      source: {
        type: "equipmentshare-used",
        label: "EquipmentShare Used",
        url
      },
      acquisition: {
        adapter: "equipmentShareUsed",
        method: "rendered-browser-dom"
      },
      machine,
      media: photos,
      confidence: {
        title: title ? "parsed" : "missing",
        price: price ? "parsed" : "missing",
        hours: hours ? "parsed" : "missing",
        stockNumber: stockNumber ? "parsed" : "missing",
        location: location.city && location.state ? "parsed" : "missing",
        photos: photos.length ? "parsed" : "missing"
      }
    };
  } finally {
    await browser.close();
  }
}

module.exports = {
  acquire
};
