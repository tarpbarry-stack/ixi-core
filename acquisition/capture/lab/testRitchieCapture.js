require("dotenv").config();

const {
  captureWithFirecrawl
} = require("../providers/firecrawlProvider");

(async () => {
  const url =
    process.argv[2] ||
    "https://www.rbauction.com/pdp/2021-john-deere-772gp-awd-motor-grader/15298020";

  try {
    const capture =
      await captureWithFirecrawl({ url });

    console.log(JSON.stringify({
      requestedUrl: url,
      finalUrl: capture.finalUrl,
      htmlLength: capture.html.length,
      hasCat926M:
        /926\s*M/i.test(capture.html),
      hasJohnDeere:
        /John Deere|JOHN DEERE/i.test(capture.html),
      has772GP:
        /772\s*GP/i.test(capture.html),
      hasSerial:
        /serial/i.test(capture.html),
      hasHours:
        /hours/i.test(capture.html),
      hasPrice:
        /\$|USD/i.test(capture.html)
    }, null, 2));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
})();
