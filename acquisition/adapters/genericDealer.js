const { chromium } = require("playwright");

const {
  applyIdentityToParsedListing
} = require("../parsers/applyIdentityToParsedListing");

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
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

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function parseTitle(title = "") {
  const cleanTitle = clean(title);
  const year = matchFirst(cleanTitle, [/\b(19\d{2}|20\d{2})\b/]);
  const afterYear = year
    ? cleanTitle.slice(cleanTitle.indexOf(year) + year.length).trim()
    : cleanTitle;

  const parts = afterYear.split(/\s+/);

  return {
    year,
    make: parts[0] || "",
    model: parts[1] || "",
    sourceCategory: parts.slice(2).join(" ")
  };
}

async function acquire(url = "") {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1200 }
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    await page.waitForTimeout(4000);

    const data = await page.evaluate(() => ({
      title:
        document.querySelector("h1")?.innerText ||
        document.title ||
        "",
      text: document.body ? document.body.innerText : "",
      html: document.documentElement ? document.documentElement.outerHTML : "",
      images: Array.from(document.images || [])
        .map(img => ({
          src: img.src,
          currentSrc: img.currentSrc,
          alt: img.alt,
          width: img.naturalWidth,
          height: img.naturalHeight
        }))
        .filter(item => item.src || item.currentSrc)
    }));

const visibleText = clean(data.text || "");
const title = clean(data.title || "");

if (/performing security verification|cloudflare|not a bot/i.test(visibleText)) {
  throw new Error("Generic dealer blocked by security verification");
}

const titleParts = parseTitle(title);
    const price = money(matchFirst(visibleText, [
      /(?:Price|USD)\s*:?\s*\$?([\d,]+)/i,
      /\$([\d,]{4,})/
    ]));

    const hours = matchFirst(visibleText, [
      /Hours\s*:?\s*([\d,]+)/i,
      /([\d,]+)\s*(?:hours|hrs)\b/i
    ]);

    const serialNumber = matchFirst(visibleText, [
      /Serial Number\s*:?\s*([A-Z0-9-]+)/i,
      /Serial\s*#?\s*:?\s*([A-Z0-9-]+)/i,
      /\bSN\s*:?\s*([A-Z0-9-]+)/i
    ]);

    const stockNumber = matchFirst(visibleText, [
      /Stock Number\s*:?\s*([A-Z0-9-]+)/i,
      /Stock\s*#?\s*:?\s*([A-Z0-9-]+)/i
    ]);

    const location = matchFirst(visibleText, [
      /(?:Machine Location|Location|For Sale in)\s*:?\s*([A-Za-z\s]+,\s*[A-Z]{2})/i,
      /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*,\s*[A-Z]{2})\b/
    ]);

    const city = location.includes(",")
      ? clean(location.split(",")[0])
      : "";

    const state = location.includes(",")
      ? clean(location.split(",")[1])
      : "";

    const description = matchFirst(visibleText, [
      /Description\s*:?\s*(.+?)(?:Contact|Request|Specifications|General|Exterior|Engine|$)/i
    ]) || title;

    const photos = unique(
      [
        ...data.images.map(item => item.currentSrc || item.src),
        ...[...String(data.html || "").matchAll(/https?:\/\/[^"'\\\s]+(?:jpg|jpeg|png|webp)[^"'\\\s]*/gi)]
          .map(match => match[0])
      ]
        .map(src => String(src || "").replace(/\\u0026/g, "&"))
        .filter(src => {
          const lower = src.toLowerCase();

          return (
            src &&
            !lower.includes("logo") &&
            !lower.includes("placeholder") &&
            !lower.includes("favicon") &&
            !lower.includes("sprite") &&
            !lower.includes("icon") &&
            !lower.includes("analytics") &&
            !lower.includes("tracking")
          );
        })
    );

    const machine = applyIdentityToParsedListing({
      source: "generic-dealer",
      sourceName: "Generic Dealer",
      url,
      title,
      description,
      visibleText,
      year: titleParts.year,
      make: titleParts.make,
      model: titleParts.model,
      sourceCategory: titleParts.sourceCategory,
      parserCategory: titleParts.sourceCategory,
      price,
      hours,
      city,
      state,
      location,
      serialNumber,
      stockNumber,
      photos
    });

    return {
      source: {
        type: "generic-dealer",
        label: "Generic Dealer",
        url
      },
      acquisition: {
        adapter: "generic-dealer",
        method: "rendered-browser-dom-best-effort"
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
  } finally {
    await browser.close();
  }
}

module.exports = {
  acquire
};
