function normalizeUrl(value = "") {
  return String(value || "").trim().toLowerCase();
}

function detectSandhillsControlled(url = "") {
  const value = normalizeUrl(url);

  const directDomains = [
    "machinerytrader.",
    "tractorhouse.",
    "truckpaper.",
    "auctiontime.",
    "equipmentfacts.",
    "sandhillsinventory.com",
    "media.sandhills.com"
  ];

  const hostedSignals = [
    "/inventory/?/listing/",
    "/inventory/?/listings/",
    "dscompanyid=",
    "settingscrmid=",
    "sandhills"
  ];

  const isDirectSandhills = directDomains.some(token => value.includes(token));
  const isHostedDealerInventory =
    value.includes("/inventory/?/") &&
    hostedSignals.some(token => value.includes(token));

  if (!isDirectSandhills && !isHostedDealerInventory) {
    return {
      ok: false,
      type: "",
      confidence: 0,
      reason: "No Sandhills URL signals"
    };
  }

  return {
    ok: true,
    type: "sandhills-controlled",
    confidence: isDirectSandhills ? 0.98 : 0.85,
    reason: isDirectSandhills
      ? "Direct Sandhills marketplace domain"
      : "Hosted dealer inventory URL pattern"
  };
}

module.exports = {
  detectSandhillsControlled
};
