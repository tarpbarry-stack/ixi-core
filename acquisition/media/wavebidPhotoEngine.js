const { chromium } = require("playwright");

function unique(items = []) {
  return Array.from(new Set(items.filter(Boolean)));
}

function normalizeWavebidPhotoUrl(url = "") {
  const match = String(url).match(/retrievePhoto\.html\?id=(\d+)/i);
  if (!match) return "";

  return `https://www.wavebid.com/retrievePhoto.html?id=${match[1]}`;
}

async function loadWavebidPhotos(wavebidUrl = "") {
  if (!wavebidUrl) return [];

  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"]
    });

    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/149 Safari/537.36",
      viewport: {
        width: 1440,
        height: 1200
      }
    });

    await page.goto(wavebidUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    await page.waitForTimeout(3000);

    const urls = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("img, a"))
        .flatMap(el => [el.src || "", el.href || ""])
        .filter(Boolean)
        .filter(url => url.includes("retrievePhoto.html?id="));
    });

    return unique(
      urls
        .map(normalizeWavebidPhotoUrl)
        .filter(Boolean)
    );
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  loadWavebidPhotos,
  normalizeWavebidPhotoUrl
};
