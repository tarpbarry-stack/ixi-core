function cleanUrl(value = "") {
  return String(value || "").trim();
}

function getFileKey(url = "") {
  const clean = cleanUrl(url).split("?")[0];
  return clean.split("/").pop();
}

function isUnitedDrupalMachinePhoto(url = "") {
  const value = cleanUrl(url).toLowerCase();

  if (!value) return false;
  if (!value.includes("unitedrentals.com/sites/default/files/styles/")) return false;
  if (!value.includes("/externals/")) return false;

  if (value.includes("gallery_thumbnail")) return false;
  if (!value.includes("gallery_primary_desktop")) return false;

  if (value.includes("logo")) return false;
  if (value.includes("icon")) return false;
  if (value.includes("cookielaw")) return false;
  if (value.includes("bat.bing")) return false;
  if (value.includes("rlcdn")) return false;

  return true;
}

function normalizeDrupalGalleryPhotos(rawPhotos = []) {
  const seen = new Set();
  const photos = [];

  for (const item of rawPhotos) {
    const url = typeof item === "string"
      ? item
      : item?.currentSrc || item?.src || "";

    const clean = cleanUrl(url);
    if (!isUnitedDrupalMachinePhoto(clean)) continue;

    const key = getFileKey(clean);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    photos.push(clean);
  }

  return photos;
}

module.exports = {
  normalizeDrupalGalleryPhotos,
  isUnitedDrupalMachinePhoto
};
