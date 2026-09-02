const {
  applyIdentityToParsedListing
} = require("./applyIdentityToParsedListing");

function clean(value = "") {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/\\u0026/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function money(value = "") {
  return clean(value).replace(/[^0-9]/g, "");
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

function extractJsonLd(html = "") {
  const blocks = [...String(html).matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )];

  return blocks
    .map(match => {
      try {
        return JSON.parse(
          match[1]
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, "&")
        );
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function findProductJson(jsonLd = []) {
  return jsonLd.find(item => item && item["@type"] === "Product") || {};
}

function extractSpec(html = "", label = "") {
  const pattern = new RegExp(
    `<div[^>]*class=["'][^"']*detail__specs-label[^"']*["'][^>]*>\\s*${label}\\s*<\\/div>\\s*<div[^>]*class=["'][^"']*detail__specs-value[^"']*["'][^>]*>(.*?)<\\/div>`,
    "i"
  );

  return clean(html.match(pattern)?.[1] || "");
}

function stripTags(value = "") {
  return clean(String(value).replace(/<[^>]+>/g, " "));
}

function parseTitle(title = "") {
  const value = clean(title);
  const year = matchFirst(value, [/\b(19\d{2}|20\d{2})\b/]);
  const rest = year ? value.replace(year, "").trim() : value;
  const parts = rest.split(/\s+/);

  return {
    year,
    make: parts[0] || "",
    model: parts[1] || ""
  };
}

function extractPhotos(html = "", product = {}) {
  const urls = [];

  if (typeof product.image === "string") urls.push(product.image);
  if (Array.isArray(product.image)) urls.push(...product.image);

  for (const match of String(html).matchAll(/data-fullscreen=["']([^"']+)["']/gi)) {
    urls.push(match[1]);
  }

  for (const match of String(html).matchAll(/data-src=["']([^"']*media\.sandhills\.com\/img\.axd[^"']*)["']/gi)) {
    urls.push(match[1]);
  }

  for (const match of String(html).matchAll(/https?:\/\/media\.sandhills\.com\/img\.axd[^"'\\\s<]+/gi)) {
    urls.push(match[0]);
  }

  return unique(
    urls
      .map(src => clean(src))
      .map(src => src.replace(/&amp;/g, "&"))
      .filter(src => src.includes("media.sandhills.com/img.axd"))
      .filter(src => !src.toLowerCase().includes("logo"))
      .filter(src => !src.toLowerCase().includes("placeholder"))
      .filter(src => !src.toLowerCase().includes("blank"))
      .filter(src => !src.toLowerCase().includes("noimage"))
      .filter(src => !src.toLowerCase().includes("no-image"))
      .filter(src => !src.toLowerCase().includes("sprite"))
      .filter(src => {
        const lower = src.toLowerCase();

        // Sandhills real gallery photos on listing pages are usually Max.
        // Related/ad/sidebar photos often show up as Cover or stripped id-only URLs.
return (
  lower.includes("sz=max") &&
  lower.includes("checksum=") &&
  lower.includes("wid=4326182721") &&
  !lower.includes("sz=cover")
);
    })
      .map(src => src.replace(/w=\d+/i, "w=0").replace(/h=\d+/i, "h=0"))
  );

}

function parseSandhillsHostedHtml({ html = "", url = "" } = {}) {
  const jsonLd = extractJsonLd(html);
  const product = findProductJson(jsonLd);

  const title =
    clean(product.name) ||
    stripTags(matchFirst(html, [
      /<h1[^>]*class=["'][^"']*detail__title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i
    ]));

  const titleParts = parseTitle(title);

  const offer = product.offers || {};
  const seller = offer.seller || {};
  const place = offer.availableAtOrFrom || {};
  const address = place.address || {};

  const category =
    clean(product.category) ||
    stripTags(matchFirst(html, [
      /<div[^>]*class=["'][^"']*detail__category[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
    ]));

  const price =
    money(offer.price) ||
    money(matchFirst(html, [
      /listing-prices__retail-price[^>]*>\s*\$?([\d,]+)/i,
      /USD\s*\$?([\d,]+)/i
    ]));

  const year = titleParts.year || extractSpec(html, "Year");
  const make = clean(product.manufacturer) || extractSpec(html, "Manufacturer") || titleParts.make;
  const model = clean(product.model) || extractSpec(html, "Model") || titleParts.model;

  const hours = extractSpec(html, "Hours");
  const serialNumber = clean(product.mpn) || extractSpec(html, "Serial Number");
  const stockNumber = clean(product.sku) || extractSpec(html, "Stock Number");
  const condition = extractSpec(html, "Condition");

  const cityStateZip = clean(offer.areaServed);
  const street = clean(address.streetAddress);
  const state = clean(address.addressRegion);
  const postalCode = clean(address.postalCode);

  const location =
    cityStateZip ||
    [street, state, postalCode].filter(Boolean).join(" ");

  const city = matchFirst(location, [/^(.+?)\s+(?:Idaho|Oklahoma|Texas|New Mexico|California|Florida|Georgia|Ohio|Kansas|Nebraska|Missouri|Iowa|Illinois|Indiana|Michigan|Wisconsin|Minnesota|Colorado|Arizona|Utah|Nevada|Oregon|Washington|Montana|Wyoming|North Dakota|South Dakota|Arkansas|Louisiana|Mississippi|Alabama|Tennessee|Kentucky|Virginia|West Virginia|Pennsylvania|New York|Maine|Vermont|New Hampshire|Massachusetts|Connecticut|Rhode Island|New Jersey|Delaware|Maryland|North Carolina|South Carolina)\b/i]);

  const photos = extractPhotos(html, product);

  const description = title;

  const machine = applyIdentityToParsedListing({
    source: "sandhills-inventory",
    sourceName: "Sandhills Inventory",
    url,
    title,
    description,
    visibleText: stripTags(html),
    year,
    make,
    model,
    sourceCategory: category,
    parserCategory: category,
    price,
    hours,
    location,
    city,
    state,
    serialNumber,
    stockNumber,
    condition,
    photos
  });

  return {
    source: {
      type: "sandhills-inventory",
      label: "Sandhills Inventory",
      url
    },
    acquisition: {
      adapter: "sandhillsInventory",
      method: "captured-html-parser"
    },
    machine,
    media: photos,
    confidence: {
      title: title ? "parsed" : "missing",
      price: price ? "parsed" : "missing",
      hours: hours ? "parsed" : "missing",
      serialNumber: serialNumber ? "parsed" : "missing",
      stockNumber: stockNumber ? "parsed" : "missing",
      location: location ? "parsed" : "missing",
      photos: photos.length ? "parsed" : "missing"
    }
  };
}

module.exports = {
  parseSandhillsHostedHtml
};
