const {
  resolveCategoryAlias
} = require("../identity/Category/categoryAlias");

function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanText(value = "") {
  return decodeHtml(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniq(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function extractYear(title = "") {
  const match = String(title).match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : "";
}

function extractRouseJsonLdProduct(html = "") {
  const blocks = [...String(html).matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )];

  for (const block of blocks) {
    try {
      const parsed = JSON.parse(cleanText(block[1]));
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const product = list.find(item => item && item["@type"] === "Product");
      if (product) return product;
    } catch {}
  }

  return {};
}

function extractRousePhotos(html = "", title = "") {
  const source = String(html);
  const urls = [];
  const cleanTitle = cleanText(title).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const carouselRegex = new RegExp(
    `<img[^>]+alt=["'][^"']*${cleanTitle} image:[^"']*["'][^>]+src=["']([^"']+)["']`,
    "gi"
  );

  for (const match of source.matchAll(carouselRegex)) {
    urls.push(
      decodeHtml(match[1]).replace(/type=[^&]+/i, "type=ItemDetailExtended")
    );
  }

  if (urls.length === 0) {
    const fallback = source.matchAll(
      /https:\/\/imageserver\.rouseservices\.com\/ImageProcessor\/get\/getimage\.aspx\?guid=[^"' <]+/gi
    );

    for (const match of fallback) {
      urls.push(
        decodeHtml(match[0]).replace(/type=[^&]+/i, "type=ItemDetailExtended")
      );
    }
  }

  return uniq(urls).filter(url =>
    /guid=/i.test(url) &&
    !/logo|icon|placeholder/i.test(url)
  );
}

function extractDataPoint(html = "", label = "") {
  const source = String(html);
  const labelPattern = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const regex = new RegExp(
    `<div[^>]*class=["'][^"']*sub-text[^"']*["'][^>]*>\\s*${labelPattern}\\s*<\\/div>\\s*<div[^>]*class=["'][^"']*data[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`,
    "i"
  );

  const match = source.match(regex);
  return match ? cleanText(match[1]) : "";
}

function extractLocationParts(location = "") {
  const cleaned = cleanText(location);
  const match = cleaned.match(/^(.+?),\s*([A-Z]{2})$/i);

  return {
    location: cleaned,
    city: match ? match[1].trim() : "",
    state: match ? match[2].trim().toUpperCase() : ""
  };
}

function extractRouseEquipment(html = "", options = {}) {
  const product = extractRouseJsonLdProduct(html);

  const title =
    cleanText(options.title) ||
    cleanText(product.name) ||
    "";

  const year = extractYear(title);

  const price =
    product.offers && product.offers.price != null
      ? String(product.offers.price)
      : "";

  const locationParts = extractLocationParts(
    extractDataPoint(html, "Location")
  );

  const meter = extractDataPoint(html, "Meter");
  const hoursMatch = meter.match(/[\d,]+/);

  const serialNumber = extractDataPoint(html, "Serial #");
  const equipmentNumber = extractDataPoint(html, "Equipment #");

const renderedTitle = cleanText(
  (String(html).match(/detail__info-title[^>]*>\s*([^<]+)</i) || [])[1] || ""
);

const finalTitle = renderedTitle || title;

const photos = extractRousePhotos(html, finalTitle);

  return {
title: finalTitle || title,
year: extractYear(finalTitle || title),
    make: cleanText(product.brand),
    model: cleanText(product.model),
    sourceCategory: cleanText(product.category),
    category: resolveCategoryAlias(cleanText(product.category)),
    price,
    hours: hoursMatch ? hoursMatch[0].replace(/,/g, "") : "",
    serialNumber,
    equipmentNumber,
    stockNumber: equipmentNumber,
    location: locationParts.location,
    city: locationParts.city,
    state: locationParts.state,
    description:
      cleanText(product.description) === "null"
        ? ""
        : cleanText(product.description),
    photos,
    photoCount: photos.length,
    sourcePlatform: "rouse"
  };
}

module.exports = {
  extractRouseEquipment,
  extractRouseJsonLdProduct,
  extractRousePhotos,
  extractDataPoint
};
