const { chromium } = require("playwright");

const {
  applyIdentityToParsedListing
} = require("../parsers/applyIdentityToParsedListing");

const {
  normalizeRouseMachinePhotos
} = require("../media/rousePhotoEngine");

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

    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      return {
        title:
          document.querySelector("h1")?.innerText ||
          document.title ||
          "",
        text: document.body ? document.body.innerText : "",
        images: Array.from(document.images || [])
          .map(img => ({
            src: img.src,
            currentSrc: img.currentSrc,
            alt: img.alt,
            width: img.naturalWidth,
            height: img.naturalHeight
          }))
          .filter(item => item.src || item.currentSrc)
      };
    });

const rawPhotos = data.images
  .map(item => item.currentSrc || item.src)
  .filter(Boolean);

const photos = normalizeRouseMachinePhotos(rawPhotos);

const visibleText = clean(data.text);
const title = clean(data.title);

const year = matchFirst(title, [
  /^(\d{4})\s+/,
  /\b(19\d{2}|20\d{2})\b/
]);

const make = matchFirst(title, [
  /^\d{4}\s+([A-Za-z]+)\s+/
]);

const model = matchFirst(title, [
  /^\d{4}\s+[A-Za-z]+\s+([A-Za-z0-9-]+)/
]);

const sourceCategory = matchFirst(visibleText, [
  /\bSubcategory\s+(.+?)\s+Equipment #/i,
  /\|\s*([^|\n]+?Excavators?)\b/i
]);

const price = matchFirst(visibleText, [
  /\$([\d,]+)\s+USD/i
]).replace(/,/g, "");

const hours = matchFirst(visibleText, [
  /\bMeter\s+([\d,]+)\s+hours/i,
  /\$[\d,]+\s+USD\s+([\d,]+)\s+hours/i
]);

const stockNumber = matchFirst(visibleText, [
  /\bEquipment #\s+([A-Z0-9-]+)/i
]);

const serialNumber = matchFirst(visibleText, [
  /\bSerial #\s+([A-Z0-9-]+)/i
]);

const locationMatch = visibleText.match(
  /\bLocation\s+\d{1,6}\s+[A-Za-z0-9 .'-]+\s+([A-Z][A-Za-z .'-]+),\s*([A-Z]{2})\s+\d{5}/i
);

const city = locationMatch
  ? clean(locationMatch[1])
  : "";

const state = locationMatch
  ? clean(locationMatch[2])
  : "";

const description = [
  title,
  sourceCategory ? `Category: ${sourceCategory}` : "",
  stockNumber ? `Equipment #: ${stockNumber}` : "",
  serialNumber ? `Serial #: ${serialNumber}` : "",
  hours ? `Hours: ${hours}` : "",
  city && state ? `Location: ${city}, ${state}` : ""
].filter(Boolean).join(". ");

const machine = applyIdentityToParsedListing({
  source: "herc-used",
  sourceName: "Herc Rentals Used",
  url,
  title,
  description,
  visibleText,
  year,
  make,
  model,
  hours,
  price,
  city,
  state,
  sourceCategory,
  parserCategory: sourceCategory,
  serialNumber,
  stockNumber,
  photos
});

return {
  source: {
    type: "herc-used",
    label: "Herc Rentals Used",
    url
  },
  acquisition: {
    adapter: "hercUsed",
    method: "rendered-browser-dom"
  },
  machine,
  media: photos,
  confidence: {
    title: title ? "parsed" : "missing",
    price: price ? "parsed" : "missing",
    hours: hours ? "parsed" : "missing",
    stockNumber: stockNumber ? "parsed" : "missing",
    serialNumber: serialNumber ? "parsed" : "missing",
    location: city && state ? "parsed" : "missing",
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

