require("dotenv").config();

const {
  captureWithFirecrawl
} = require("../providers/firecrawlProvider");

(async () => {
  const url =
    "https://www.ironplanet.com/for-sale/Wheel-Loaders-2015-Komatsu-WA470-7-Wheel-Loader-Texas/15525730?h=5000%2Cct%7C1%2Cc%7C4%2Cmode%7C2&rr=0.33333&hitprm=&pnLink=yes";

  try {
    const capture = await captureWithFirecrawl({ url });
    const html = capture.html || "";

    console.log(JSON.stringify({
      htmlLength: html.length,
      hasKomatsu: /komatsu/i.test(html),
      hasWA470: /WA470/i.test(html),
      hasSerial: /serial|vin/i.test(html),
      hasHours: /hours|meter|odometer/i.test(html),
      hasLocation: /texas|location/i.test(html),
      hasJsonLd: /schema\.org|application\/ld\+json/i.test(html),
      hasIronPlanetImages: /www-ironplanet\.s3/i.test(html)
    }, null, 2));
  } catch (error) {
    console.error(error.message);
  }
})();
