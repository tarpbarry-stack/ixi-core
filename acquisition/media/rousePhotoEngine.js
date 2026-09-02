function clean(value = "") {
  return String(value).trim();
}

function getParam(url = "", name = "") {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get(name) || "";
  } catch {
    const match = String(url).match(new RegExp(`[?&]${name}=([^&]+)`, "i"));
    return match ? decodeURIComponent(match[1]) : "";
  }
}

function isRouseImage(url = "") {
  const lower = String(url).toLowerCase();

  return (
    lower.includes("imageserver.rouseservices.com") &&
    lower.includes("getimage.aspx") &&
    lower.includes("guid=")
  );
}

function normalizeRouseMachinePhotos(urls = [], options = {}) {
  const {
    maxPhotos = 40
  } = options;

  const byGuid = new Map();

  for (const rawUrl of urls) {
    const url = clean(rawUrl);
    const lower = url.toLowerCase();

    if (!url) continue;
    if (!isRouseImage(url)) continue;

    const type = getParam(url, "type");
    const guid = getParam(url, "guid");

    if (!guid) continue;

    // Keep the real machine-detail images.
    // Reject thumbnails, logos, app-store assets, and undefined related images.
    if (type !== "ItemDetailExtended") continue;
    if (lower.includes("gallery thumbnail")) continue;
    if (lower.includes("undefined")) continue;
    if (lower.includes("logo")) continue;
    if (lower.includes("app-store")) continue;
    if (lower.includes("play-store")) continue;

    if (!byGuid.has(guid)) {
      byGuid.set(guid, url);
    }
  }

  return Array.from(byGuid.values()).slice(0, maxPhotos);
}

module.exports = {
  normalizeRouseMachinePhotos,
  isRouseImage,
  getParam
};
