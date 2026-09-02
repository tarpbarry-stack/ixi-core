function countSandhillsPhotos(html = "") {
  const matches = String(html).match(/media\.sandhills\.com\/img\.axd/gi);
  return matches ? matches.length : 0;
}

function scoreCaptureResult({ provider = "", html = "", elapsedMs = 0, error = "" } = {}) {
  const text = String(html || "");

  const checks = {
    hasHtml: text.length > 1000,
    hasBobcat: /BOBCAT/i.test(text),
    hasModel: /\bA770\b/i.test(text),
    hasSerial: /AT5J12969/i.test(text),
    hasPrice: /50,500|50500/i.test(text),
    hasHours: /1,759|1759/i.test(text),
    hasJsonLd: /application\/ld\+json/i.test(text),
    hasSandhillsMedia: /media\.sandhills\.com\/img\.axd/i.test(text)
  };

  const photoCount = countSandhillsPhotos(text);

  const passed =
    checks.hasHtml &&
    checks.hasBobcat &&
    checks.hasModel &&
    checks.hasSerial &&
    checks.hasPrice &&
    checks.hasHours &&
    checks.hasSandhillsMedia;

  return {
    provider,
    passed,
    elapsedMs,
    htmlLength: text.length,
    photoCount,
    checks,
    error: error || ""
  };
}

module.exports = {
  scoreCaptureResult
};

