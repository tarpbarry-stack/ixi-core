const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DEFAULT_URL =
  "https://used.sunbeltrentals.com/en-US/equipment/details/az336697";

const url = process.argv[2] || DEFAULT_URL;

async function main() {
  const artifactDir = path.join(__dirname, "../artifacts");
  fs.mkdirSync(artifactDir, { recursive: true });

  const artifactPath = path.join(
    artifactDir,
    "sunbelt-az336697.html"
  );

  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage({
    viewport: { width: 1440, height: 1200 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
  });

  page.setDefaultTimeout(45000);

  console.log("SUNBELT_CAPTURE_START", url);

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });

  await page.waitForTimeout(8000);

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

  console.log(JSON.stringify({
    ok: true,
    source: "sunbelt-used",
    url,
    title,
    bodyTextLength: bodyText.length,
    htmlLength: html.length,
    imageCount: images.length,
    artifactPath,
    sampleText: bodyText.slice(0, 3000),
    images: images.slice(0, 40)
  }, null, 2));

  await browser.close();
}

main().catch(error => {
  console.error("SUNBELT_CAPTURE_FAILED:", error.message);
  process.exit(1);
});

