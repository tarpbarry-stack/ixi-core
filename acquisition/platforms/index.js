module.exports = {

  // ===== NEW PLATFORM ENGINE =====

  "sandhills-inventory":
    require("./sandhills"),

  "rbauction":
    require("./ritchie"),

  "ironplanet":
    require("./ironplanet"),

  "proxibid":
    require("./proxibid"),

  "auctiontime":
    require("./auctiontime"),

  // ===== LEGACY ADAPTERS =====

  "facebook-marketplace": {
    legacyAdapter: require("../adapters/facebook")
  },

  "machinery-trader": {
    legacyAdapter: require("../adapters/machineryTrader")
  },

  "4sale-heavy-equipment": {
    legacyAdapter: require("../adapters/fourSale")
  },

  "worldwide-machinery": {
    legacyAdapter: require("../adapters/worldwideMachinery")
  },

  "generic-dealer": {
    legacyAdapter: require("../adapters/genericDealer")
  },

  "purplewave": {
    legacyAdapter: require("../adapters/purpleWave")
  },

  "lyon-auction": {
    legacyAdapter: require("../adapters/lyonAuction")
  },

  "equipmentshare-used": {
    legacyAdapter: require("../adapters/equipmentShareUsed")
  },

  "herc-used": {
    legacyAdapter: require("../adapters/hercUsed")
  },

  "sunbelt-used": {
    legacyAdapter: require("../adapters/sunbeltUsed")
  },

  "sunstate-used": {
    legacyAdapter: require("../adapters/sunstateUsed")
  },


  "united-rentals-used": {
    legacyAdapter: require("../adapters/unitedRentalsUsed")
  }

};
