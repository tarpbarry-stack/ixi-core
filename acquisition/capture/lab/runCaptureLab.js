const {
  parseSandhillsHostedHtml
} = require("../../parsers/parseSandhillsHostedHtml");

const {
  validateMachineObject
} = require("./validateMachineObject");

const fs = require("fs");
const path = require("path");

const { providers } = require("./captureProviders");
const { scoreCaptureResult } = require("./scoreCaptureResult");

const TEST_URL =
  process.argv[2] ||
  "https://www.totalequipmentandrental.com/inventory/?/listing/for-sale/255932613/2020-bobcat-a770-wheel-skid-steers?dscompanyid=25562&settingscrmid=11888";

async function runProvider(provider, url) {
  const start = Date.now();

  try {
    const capture = await provider.capture({ url });

    const elapsedMs = Date.now() - start;

    const parsed = parseSandhillsHostedHtml({
      html: capture.html,
      url
    });

    const validation = validateMachineObject(parsed);

    return {
      provider: provider.name,
      elapsedMs,
      htmlLength: capture.html.length,
      validation,
      parsed
    };

  } catch (error) {

    return {
      provider: provider.name,
      error: error.message,
      validation: {
        passed: false
      }
    };

  }
}

async function main() {
  const url = TEST_URL;
  const results = [];

  for (const provider of providers.filter(item => item.enabled)) {
    const score = await runProvider(provider, url);
    results.push(score);
  }

  const artifactsDir = path.join(__dirname, "../artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });

  const outPath = path.join(artifactsDir, `capture-lab-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ url, results }, null, 2));

console.log(JSON.stringify({

  url,

  results: results.map(r => ({

    provider: r.provider,

    passed: r.validation.passed,

    title: r.parsed?.machine?.title,

    year: r.parsed?.machine?.year,

    make: r.parsed?.machine?.make,

    model: r.parsed?.machine?.model,

    category: r.parsed?.machine?.category,

    price: r.parsed?.machine?.price,

    hours: r.parsed?.machine?.hours,

    serial: r.parsed?.machine?.serialNumber,

    stock: r.parsed?.machine?.stockNumber,

    photos: r.parsed?.media?.length,

    validation: r.validation.checks,

    error: r.error || ""

  })),

  outPath

}, null, 2));

}

main().catch(error => {
  console.error("CAPTURE LAB FAILED:", error.message);
  process.exit(1);
});

