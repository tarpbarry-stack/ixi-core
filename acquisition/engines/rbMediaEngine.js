function clean(value = "") {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/\\\//g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeImageId(src = "") {
  const filename = String(src).split("/").pop() || "";

  return filename
    .replace(/\.(jpg|jpeg|png|webp)$/i, "")
    .replace(/-(hr|large|medium|small|thumb|thumbnail)$/i, "");
}

function preferHighResolution(existing = "", candidate = "") {
  if (!existing) return candidate;

  const candidateHr = /-hr\.(jpg|jpeg|png|webp)$/i.test(candidate);
  const existingHr = /-hr\.(jpg|jpeg|png|webp)$/i.test(existing);

  if (candidateHr && !existingHr) return candidate;

  return existing;
}

function isRitchieS3Image(src = "") {
  return /www-ironplanet\.s3-[^/]+\.amazonaws\.com\/i\/\d+\/\d+\/[a-f0-9-]+(?:-hr)?\.(jpg|jpeg|png|webp)$/i.test(src);
}

function isIronPlanetCdnImage(src = "") {
  return /cdn\.ironpla\.net\/i\/\d+\/\d+\/[a-f0-9-]+(?:-hr)?\.(jpg|jpeg|png|webp)$/i.test(src);
}

function isTrashImage(src = "") {
  const lower = String(src || "").toLowerCase();

  return (
    lower.includes("sprite") ||
    lower.includes("logo") ||
    lower.includes("banner") ||
    lower.includes("/hmpg/") ||
    lower.includes("/howto/") ||
    lower.includes("approvals") ||
    lower.includes("photo-gallery-small")
  );
}

function collectRbImageUrls(html = "", structuredImages = []) {
  const urls = [];

  urls.push(...structuredImages);

  for (const match of String(html).matchAll(
    /"filename"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp))"/gi
  )) {
    urls.push(match[1]);
  }

  for (const match of String(html).matchAll(
    /"thumbUrl"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp))"/gi
  )) {
    urls.push(match[1]);
  }

  for (const match of String(html).matchAll(
    /https?:\/\/cdn\.ironpla\.net\/i\/[^"'\\\s<]+?\.(?:jpg|jpeg|png|webp)/gi
  )) {
    urls.push(match[0]);
  }

  for (const match of String(html).matchAll(
    /https?:\/\/www-ironplanet\.s3-[^"'\\\s<]+?\.(?:jpg|jpeg|png|webp)/gi
  )) {
    urls.push(match[0]);
  }

  return unique(urls.map(clean));
}

function extractRbGalleryPhotos({
  html = "",
  structuredImages = [],
  limit = 120,
  source = "rb-family"
} = {}) {
  const byImageId = new Map();

  for (const src of collectRbImageUrls(html, structuredImages)) {
    if (!src) continue;
    if (isTrashImage(src)) continue;
    if (!/\.(jpg|jpeg|png|webp)$/i.test(src)) continue;

    if (source === "ritchie" && !isRitchieS3Image(src)) continue;
    if (source === "ironplanet" && !isIronPlanetCdnImage(src)) continue;

    if (
      source === "rb-family" &&
      !isRitchieS3Image(src) &&
      !isIronPlanetCdnImage(src)
    ) {
      continue;
    }

    const id = normalizeImageId(src);
    if (!id) continue;

    byImageId.set(
      id,
      preferHighResolution(byImageId.get(id), src)
    );
  }

  return [...byImageId.values()]
    .sort((a, b) => {
      const aHr = /-hr\.(jpg|jpeg|png|webp)$/i.test(a) ? 0 : 1;
      const bHr = /-hr\.(jpg|jpeg|png|webp)$/i.test(b) ? 0 : 1;
      return aHr - bHr;
    })
    .slice(0, limit);
}

module.exports = {
  extractRbGalleryPhotos,
  collectRbImageUrls
};
