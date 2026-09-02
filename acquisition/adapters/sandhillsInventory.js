const {
  captureRenderedHtml
} = require("../capture/ixiCaptureGateway");

const { chromium } = require("playwright");

const fs = require("fs");
const path = require("path");

const {
  parseSandhillsHostedHtml
} = require("../parsers/parseSandhillsHostedHtml");


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

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function parseTitle(title = "") {
  const clean = text(title);
  const year = firstMatch(clean, [/^(\d{4})\b/, /\b(19\d{2}|20\d{2})\b/]);

  const withoutYear = year ? clean.replace(year, "").trim() : clean;
  const parts = withoutYear.split(/\s+/);

  return {
    year,
    make: parts[0] || "",
    model: parts[1] || "",
    category: parts.slice(2).join(" ")
  };
}

async function acquire(url = "") {
if (process.env.IXI_SANDHILLS_ARTIFACT_TEST === "1") {
  const artifactPath = path.join(
    __dirname,
    "../capture/artifacts/sandhills-total-equipment-test.html"
  );

  const html = fs.readFileSync(artifactPath, "utf8");

  return parseSandhillsHostedHtml({
    html,
    url
  });
} 

if (process.env.IXI_SANDHILLS_CAPTURE === "1") {
  const capture = await captureRenderedHtml({ url });

  return parseSandhillsHostedHtml({
    html: capture.html,
    url: capture.finalUrl || url
  });
}

 const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1200 }
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    await page.waitForTimeout(5000);

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

    const bodyText = text(data.text || "");
    const html = String(data.html || "");

    const title =
      text(data.title) ||
      firstMatch(bodyText, [
        /(\d{4}\s+[A-Z]+\s+[A-Z0-9-]+\s+[A-Za-z\s]+?)(?:\s+Options|\s+See All|\s+USD|\s+\$)/i
      ]);

    const titleParts = parseTitle(title);

    const price = money(firstMatch(bodyText, [
      /USD\s*\$?([\d,]+)/i,
      /\$([\d,]{4,})/
    ]));

    const hours = firstMatch(bodyText, [
      /Hours\s*:?\s*([\d,]+)/i,
      /Hours\s+([\d,]+)/i,
      /([\d,]+)\s*hours/i,
      /([\d,]+)\s*hrs/i
    ]);

    const serialNumber = firstMatch(bodyText, [
      /Serial Number\s*:?\s*([A-Z0-9-]+)/i,
      /Serial\s*#?\s*:?\s*([A-Z0-9-]+)/i
    ]);

    const stockNumber = firstMatch(bodyText, [
      /Stock Number\s*:?\s*([A-Z0-9-]+)/i,
      /Stock\s*#?\s*:?\s*([A-Z0-9-]+)/i
    ]);

    const location = firstMatch(bodyText, [
      /Machine Location\s*:?\s*([A-Za-z\s]+,\s*[A-Za-z]+)(?:\s+\d{5})?/i,
      /For Sale in\s+([A-Za-z\s]+,\s*[A-Za-z]+)/i,
      /Location\s*:?\s*([A-Za-z\s]+,\s*[A-Za-z]+)/i
    ]);

    const city = location.includes(",")
      ? text(location.split(",")[0])
      : "";

    const state = location.includes(",")
      ? text(location.split(",")[1])
      : "";

    const description =
      firstMatch(bodyText, [
        /Description\s+(.+?)(?:Machine sold as is|General|Exterior|Category Specific|Engine|Contact|$)/i,
        /((?:KOMATSU|Komatsu)\s+[A-Z0-9-]+\s+.+?)(?:Machine sold as is|General|Exterior|Category Specific|Engine|Contact|$)/i
      ]) ||
      title;

    const photoUrls = unique(
      [
        ...data.images.map(item => item.currentSrc || item.src),
        ...[...html.matchAll(/https?:\/\/[^"'\\\s]+(?:jpg|jpeg|png|webp)[^"'\\\s]*/gi)]
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
            !lower.includes("icon")
          );
        })
    );

    const machine = applyIdentityToParsedListing({
      source: "sandhills-inventory",
      sourceName: "Sandhills Inventory",
      url,
      title,
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
      serialNumber,
      stockNumber,
      photos: photoUrls
    });

    return {
      source: {
        type: "sandhills-inventory",
        label: "Sandhills Inventory",
        url
      },
      acquisition: {
        adapter: "sandhillsInventory",
        method: "rendered-browser-dom"
      },
      machine,
      media: photoUrls,
      confidence: {
        title: title ? "parsed" : "missing",
        price: price ? "parsed" : "missing",
        hours: hours ? "parsed" : "missing",
        serialNumber: serialNumber ? "parsed" : "missing",
        stockNumber: stockNumber ? "parsed" : "missing",
        location: location ? "parsed" : "missing",
        photos: photoUrls.length ? "parsed" : "missing"
      }
    };
  } finally {
    await browser.close();
  }
}

module.exports = {
  acquire
};
