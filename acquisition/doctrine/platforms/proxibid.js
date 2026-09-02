module.exports = {
  platformId: "proxibid",

  platform: {
    id: "proxibid",
    name: "Proxibid",
    url: "https://www.proxibid.com"
  },

  terms: {
    platformFees: {
      additionalInternetPremium: {
        type: "unknown",
        ratePercent: null,
        capAmount: null,
        tiers: [],
        rawText: ""
      },

      otherFees: []
    }
  },

  auctionRules: {
    biddingPlatform: {
      id: "proxibid",
      additionalInternetPremiumApplies: null
    }
  }
};
