const {
  detectSandhillsControlled
} = require("../sources/detectSandhillsControlled");

function detectSource(url = "") {
  const value = String(url).toLowerCase();

  if (value.includes("facebook.com/marketplace/item")) {
    return "facebook-marketplace";
  }

  if (
    value.includes("rbauction.com/pdp/") ||
    value.includes("rbauction.com/") ||
    value.includes("ritchiebros.com/")
  ) {
    return "rbauction";
  }

  if (
    value.includes("ironplanet.com/for-sale/") ||
    value.includes("ironplanet.com/")
  ) {
    return "ironplanet";
  }

  if (
    value.includes("proxibid.com/") &&
    value.includes("/lotinformation/")
  ) {
    return "proxibid";
  }

  if (value.includes("auctiontime.com")) {
    return "auctiontime";
  }

const sandhillsControlled = detectSandhillsControlled(url);

if (sandhillsControlled.ok) {
  return "sandhills-inventory";
}

  if (
    value.includes("machinerytrader.com") ||
    value.includes("machinerytrader.co.uk")
  ) {
    return "machinery-trader";
  }


if (
  value.includes("komatsustores.com/inventory") ||
  value.includes("komatsuused.com/inventory") ||
  value.includes("komatsusw.com/inventory")
) {
  return "sandhills-inventory";
}


  if (value.includes("4saleheavyequipment.com")) {
    return "4sale-heavy-equipment";
  }

if (value.includes("example.com")) {
  return "generic-dealer";
}

if (value.includes("worldwidemachinery.com")) {
  return "worldwide-machinery";
}

if (value.includes("purplewave.com")) {
  return "purplewave";
}

if (value.includes("lyonauction.com")) {
  return "lyon-auction";
}

if (value.includes("used.equipmentshare.com/products/")) {
  return "equipmentshare-used";
}

if (value.includes("used.hercrentals.com/equipment/detail/")) {
  return "herc-used";
}

  if (value.includes("used.sunbeltrentals.com")) {
    return "sunbelt-used";
  }

  if (value.includes("used.sunstateequip.com")) {
    return "sunstate-used";
  }

  if (
    value.includes("used.sunbeltrentals.com/en-us/equipment/details/") ||
    value.includes("used.sunbeltrentals.com/")
  ) {
    return "sunbelt-used";
  }

if (
  value.includes("unitedrentals.com/sales/equipment/")
) {
  return "united-rentals-used";
}

  return "unknown";
}

module.exports = {
  detectSource
};
