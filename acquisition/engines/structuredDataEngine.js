function clean(value = "") {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\\u0026/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function safeJsonParse(raw = "") {
  try {
    return JSON.parse(clean(raw));
  } catch {
    return null;
  }
}

function extractJsonLdBlocks(html = "") {
  const blocks = [];

  for (const match of String(html).matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    blocks.push(match[1]);
  }

  for (const match of String(html).matchAll(
    /(\{"@context":"https?:\/\/schema\.org\/?"[\s\S]{0,25000?\})\s*(?=\{|"|<)/gi
  )) {
    blocks.push(match[1]);
  }

  return blocks;
}

function flattenJsonLd(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.flatMap(flattenJsonLd);
  }

  if (value["@graph"]) {
    return flattenJsonLd(value["@graph"]);
  }

  return [value];
}

function getMetaContent(html = "", patterns = []) {
  for (const pattern of patterns) {
    const match = String(html).match(pattern);
    if (match?.[1]) return clean(match[1]);
  }

  return "";
}

function extractStructuredData(html = "") {
  const parsedBlocks = extractJsonLdBlocks(html)
    .map(safeJsonParse)
    .filter(Boolean)
    .flatMap(flattenJsonLd);

  const product =
    parsedBlocks.find(item =>
      String(item["@type"] || "").toLowerCase() === "product"
    ) || {};

  const offer =
    product.offers ||
    parsedBlocks.find(item =>
      String(item["@type"] || "").toLowerCase() === "offer"
    ) || {};

  const title =
    clean(product.name) ||
    getMetaContent(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)["']/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i
    ]).replace(/<[^>]+>/g, " ");

  const description =
    clean(product.description) ||
    getMetaContent(html, [
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']+)["']/i
    ]);

  const images = [];

  if (typeof product.image === "string") images.push(product.image);
  if (Array.isArray(product.image)) images.push(...product.image);

  const location =
    product.eligibleRegion ||
    offer.eligibleRegion ||
    product.location ||
    {};

  const address = location.address || {};

  return {
    product,
    offer,
    title: clean(title),
    description: clean(description),
    images: images.map(clean).filter(Boolean),
    price: clean(offer.price || product.price || ""),
    currency: clean(offer.priceCurrency || ""),
    location: clean(location.name || ""),
    address: {
      street: clean(address.streetAddress),
      city: clean(address.addressLocality),
      state: clean(address.addressRegion),
      postalCode: clean(address.postalCode),
      country: clean(address.addressCountry)
    },
    geo: location.geo || {},
    rawBlocks: parsedBlocks
  };
}

module.exports = {
  extractStructuredData
};

