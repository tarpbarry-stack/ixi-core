const { chromium } = require("playwright");

const {
  extractRouseEquipment
} = require("../engines/rouseEquipmentEngine");

const {
  applyIdentityToParsedListing
} = require("../parsers/applyIdentityToParsedListing");

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

    await page.waitForTimeout(5000);

    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(resolve => setTimeout(resolve, 1000));
      window.scrollTo(0, 0);
      await new Promise(resolve => setTimeout(resolve, 1000));
    });

    const html = await page.content();
    const visibleText = await page.locator("body").innerText().catch(() => "");

    const rouse = extractRouseEquipment(html, { url });

    const machine = applyIdentityToParsedListing({
      source: "sunbelt-used",
      sourceName: "Sunbelt Rentals Used",
      url,
      title: rouse.title,
      description: rouse.description,
      visibleText,
      year: rouse.year,
      make: rouse.make,
      model: rouse.model,
      hours: rouse.hours,
      price: rouse.price,
      city: rouse.city,
      state: rouse.state,
      sourceCategory: rouse.sourceCategory,
      parserCategory: rouse.sourceCategory,
      serialNumber: rouse.serialNumber,
      stockNumber: rouse.stockNumber,
      photos: rouse.photos
    });

    return {
      source: {
        type: "sunbelt-used",
        label: "Sunbelt Rentals Used",
        url
      },
      acquisition: {
        adapter: "sunbeltUsed",
        method: "playwright-rouse-engine"
      },
      machine,
      media: rouse.photos || [],
      confidence: {
        title: machine.title ? "parsed" : "missing",
        price: machine.price ? "parsed" : "missing",
        hours: machine.hours ? "parsed" : "missing",
        stockNumber: machine.stockNumber ? "parsed" : "missing",
        serialNumber: machine.serialNumber ? "parsed" : "missing",
        location: machine.city && machine.state ? "parsed" : "missing",
        photos: rouse.photos?.length ? "parsed" : "missing"
      },
      raw: {
        rouse
      }
    };
  } finally {
    await browser.close();
  }
}

module.exports = {
  acquire
};
