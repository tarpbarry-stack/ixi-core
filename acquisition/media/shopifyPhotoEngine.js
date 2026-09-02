function clean(value = "") {
  return String(value).trim();
}

function isShopifyImage(url = "") {
  const lower = String(url).toLowerCase();

  return (
    lower.includes("/cdn/shop/files/") &&
    /\.(jpg|jpeg|png|webp)(\?|$)/i.test(lower)
  );
}

function removeWidthParam(url = "") {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("width");
    return parsed.toString();
  } catch {
    return url.replace(/([?&])width=\d+/i, "").replace(/[?&]$/, "");
  }
}

function getImageKey(url = "") {
  const cleaned = removeWidthParam(url);

  try {
    const parsed = new URL(cleaned);
    return parsed.pathname.split("/").pop().toLowerCase();
  } catch {
    const withoutQuery = cleaned.toLowerCase().split("?")[0];
    return withoutQuery.split("/").pop();
  }
}

function getWidth(url = "") {
  const match = String(url).match(/[?&]width=(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function scoreShopifyPhoto(url = "") {
  const lower = String(url).toLowerCase();
  const width = getWidth(url);

  let score = width;

  if (width >= 4096) score += 10000;
  if (width >= 1200) score += 5000;
  if (width <= 200) score -= 5000;

  if (lower.includes("logo")) score -= 100000;
  if (lower.includes("banner")) score -= 100000;
  if (lower.includes("coming-soon")) score -= 100000;
  if (lower.includes("uf-coming-soon")) score -= 100000;
  if (lower.includes(".svg")) score -= 100000;

  return score;
}

function normalizeShopifyMachinePhotos(urls = [], options = {}) {
  const {
    maxPhotos = 40
  } = options;

  const byKey = new Map();

  for (const rawUrl of urls) {
    const url = clean(rawUrl);
    const lower = url.toLowerCase();

    if (!url) continue;
    if (!isShopifyImage(url)) continue;

    if (lower.includes("logo")) continue;
    if (lower.includes("banner")) continue;
    if (lower.includes("coming-soon")) continue;
    if (lower.includes("uf-coming-soon")) continue;

    const key = getImageKey(url);
    const existing = byKey.get(key);

    if (!existing || scoreShopifyPhoto(url) > scoreShopifyPhoto(existing)) {
      byKey.set(key, url);
    }
  }

  return Array.from(byKey.values())
    .sort((a, b) => scoreShopifyPhoto(b) - scoreShopifyPhoto(a))
    .slice(0, maxPhotos);
}

module.exports = {
  normalizeShopifyMachinePhotos,
  removeWidthParam,
  getImageKey,
  isShopifyImage
};
