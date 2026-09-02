async function captureWithBrowserless({ url = "" } = {}) {
  const token = process.env.BROWSERLESS_TOKEN;

  if (!token) {
    throw new Error("BROWSERLESS_TOKEN missing");
  }

  const endpoint = `https://production-sfo.browserless.io/chrome/content?token=${encodeURIComponent(token)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      url,
      gotoOptions: {
        waitUntil: "networkidle2",
        timeout: 45000
      },
      bestAttempt: true
    })
  });

  const html = await response.text();

  if (!response.ok) {
    throw new Error(`Browserless HTTP ${response.status}: ${html.slice(0, 300)}`);
  }

  if (!html || html.length < 1000) {
    throw new Error(`Browserless returned weak HTML length=${html.length}`);
  }

  return {
    html,
    finalUrl: url,
    rawLength: html.length
  };
}

module.exports = {
  captureWithBrowserless
};
