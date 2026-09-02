const { chromium } = require("playwright");

async function captureWithPlaywright({
  url = "",
  timeoutMs = 45000
} = {}) {
  if (!url) {
    throw new Error(
      "captureWithPlaywright requires url"
    );
  }

  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ]
    });

    const context =
      await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/150.0.0.0 Safari/537.36",

        viewport: {
          width: 1440,
          height: 1100
        },

        locale: "en-US"
      });

    const page = await context.newPage();

    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(
      timeoutMs
    );

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs
    });

    /*
     * Proxibid renders the lot page after the initial
     * document response. Wait for the stable lot heading,
     * but do not fail solely because a future layout uses
     * a different selector.
     */
    await page
      .waitForSelector(
        "h1.lotHeaderDescription, .lotHeaderDescription, h1",
        {
          timeout: 15000
        }
      )
      .catch(() => {});

    /*
     * Give deferred gallery and terms markup time to
     * finish attaching to the rendered document.
     */
    await page.waitForTimeout(2500);


/*
 * DEBUG:
 * Show every visible element that looks like an
 * auction title so we can see where Proxibid
 * actually stores the event name.
 */
const auctionTextCandidates =
  await page.evaluate(() => {
    const candidates = [];

    document
      .querySelectorAll(
        "a, h1, h2, h3, h4, div, span, strong"
      )
      .forEach(element => {
        const text =
          String(
            element.innerText ||
            element.textContent ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim();

        if (
          text &&
          text.length <= 180 &&
          /auction|sale/i.test(text)
        ) {
          candidates.push({
            tag: element.tagName,
            className:
              typeof element.className === "string"
                ? element.className
                : "",
            id:
              element.id || "",
            href:
              element.href || "",
            text
          });
        }
      });

    return candidates.slice(0, 100);
  });

console.log(
  "PROXIBID AUCTION TEXT CANDIDATES:",
  JSON.stringify(
    auctionTextCandidates,
    null,
    2
  )
);

    const html = await page.content();
    const title = await page.title();
    const finalUrl = page.url();

    if (!html || html.length < 1000) {
      throw new Error(
        "Playwright returned insufficient HTML"
      );
    }

    return {
      ok: true,
      html,
      title,
      url: finalUrl,
      requestedUrl: url,
      status:
        response?.status?.() || null,
      provider: "playwright",
      capturedAt:
        new Date().toISOString()
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  captureWithPlaywright
};
