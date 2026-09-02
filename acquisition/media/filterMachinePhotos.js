function filterMachinePhotos(urls = []) {
  return Array.from(new Set(urls))
    .filter(Boolean)
    .filter(url => {
      const lower = String(url).toLowerCase();

      if (lower.includes("/build/")) return false;
      if (lower.includes("/images/")) return false;
      if (lower.includes(".svg")) return false;

const deny = [
  "logo",
  "icon",
  "save",
  "watch",
  "copart",
  "purplewave"
];

      if (deny.some(term => lower.includes(term))) {
        return false;
      }

      return /\.(jpg|jpeg|png|webp)(\?|$)/i.test(lower);
    });
}

module.exports = {
  filterMachinePhotos
};
