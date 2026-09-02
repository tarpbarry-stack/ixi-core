const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DEFAULT_URL =
  "https://catused.com/en/construction/crawler-excavators/cat-323-f-l/56380436-660b-4b2a-a28e-89bdbfb3b705.html";

const url = process.argv[2] || DEFAULT_URL;

function safeSlug(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

async function main() {
  const artifactDir = path.join(__dirname, "../artifacts");
  fs.mkdirSync(artifactDir, { recursive: true });

  const artifactPath = path.join(
    artifactDir,
    `catused-${safeSlug(url)}.html`
  );

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1200 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    });

    page.setDefaultTimeout(45000);

    console.log("CATUSED_CAPTURE_START", url);

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    await page.waitForTimeout(7000);

    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(resolve => setTimeout(resolve, 1500));
      window.scrollTo(0, 0);
      await new Promise(resolve => setTimeout(resolve, 1500));
    });

    const title = await page.title().catch(() => "");
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const html = await page.content();

    fs.writeFileSync(artifactPath, html, "utf8");

    const images = await page.$$eval("img", imgs =>
      imgs
        .map(img => ({
          src: img.currentSrc || img.src || "",
          alt: img.alt || "",
          width: img.naturalWidth || 0,
          height: img.naturalHeight || 0
        }))
        .filter(img => img.src)
    );

    const scripts = await page.$$eval("script", scripts =>
      scripts.map(script => ({
        type: script.type || "",
        id: script.id || "",
        src: script.src || "",
        textLength: script.innerText ? script.innerText.length : 0,
        sample: script.innerText ? script.innerText.slice(0, 300) : ""
      }))
    );

    console.log(JSON.stringify({
      ok: true,
      source: "catused",
      url,
      title,
      bodyTextLength: bodyText.length,
      htmlLength: html.length,
      imageCount: images.length,
      scriptCount: scripts.length,
      artifactPath,
      sampleText: bodyText.slice(0, 4000),
      images: images.slice(0, 60),
      scripts: scripts.slice(0, 30)
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error("CATUSED_CAPTURE_FAILED:", error.message);
  process.exit(1);
});
