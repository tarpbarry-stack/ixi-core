const { chromium } = require("playwright");

const { buildMachineObject } = require("../interpreter/buildMachineObject");

const PRODUCT_PHOTO_SELECTOR =
  'div[aria-label="Product"] img[data-image-id][alt="Product"]';

async function acquire(url) {
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"]
    });

    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36",
      viewport: {
        width: 390,
        height: 844
      },
      locale: "en-US"
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    await page.waitForTimeout(3000);

	await page.mouse.wheel(0, 600);
	await page.waitForTimeout(1500);

	await page.mouse.wheel(0, -600);
	await page.waitForTimeout(1500);

	await page.locator('img[alt="Product"]').first().click({
  	timeout: 10000
	}).catch(() => {});

	await page.waitForTimeout(3000);

    const result = await page.evaluate(selector => {
      const getMeta = property =>
        document.querySelector(`meta[property="${property}"]`)?.content ||
        document.querySelector(`meta[name="${property}"]`)?.content ||
        "";

const debug = {
  productImgCount: document.querySelectorAll('img[alt="Product"]').length,
  dataImageCount: document.querySelectorAll("img[data-image-id]").length,
  productDivCount: document.querySelectorAll('div[aria-label="Product"]').length,
  allImageCount: document.querySelectorAll("img").length,
  productImageSamples: Array.from(document.querySelectorAll("img"))
    .slice(0, 20)
    .map(img => ({
      alt: img.alt,
      src: img.src,
      dataImageId: img.getAttribute("data-image-id"),
      parentLabel: img.parentElement?.getAttribute("aria-label")
    }))
};

      const listingTitle = getMeta("og:title");

const photos = Array.from(document.querySelectorAll("img[data-image-id]"))
  .filter(img =>
    img.alt &&
    listingTitle &&
    img.alt.startsWith(`${listingTitle} photo`)
  )
  .map(img => img.src)
  .filter(src => src && src.includes("scontent"));


      return {
        title: getMeta("og:title"),
        description: getMeta("og:description"),
        heroImage: getMeta("og:image"),
        visibleText: document.body?.innerText || "",
debug,
        photos: Array.from(new Set(photos))
      };
    }, PRODUCT_PHOTO_SELECTOR);

    if (result.photos.length === 0 && result.heroImage) {
      result.photos = [result.heroImage];
    }


const machine = buildMachineObject({
  title: result.title,
  description: result.description,
  visibleText: result.visibleText,
  sourceCategory: "",
  sourceName: "Facebook Marketplace",
  url
});

    return {
      source: {
        type: "facebook-marketplace-browser",
        label: "Facebook Marketplace",
        url
      },
      acquisition: {
        adapter: "facebook-playwright",
        method: "rendered-browser-dom"
      },
machine,
      media: result.photos,
      confidence: {
        title: result.title ? "parsed" : "missing",
        description: result.description ? "parsed" : "missing",
        photos: result.photos.length > 1 ? "gallery" : result.photos.length === 1 ? "hero-only" : "missing"
      }
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  acquire
};
