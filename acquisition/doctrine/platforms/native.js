module.exports = {
  platformId: "native",

  platform: {
    id: "native",
    name: "Auction Company Platform"
  },

  terms: {
    platformFees: {
      additionalInternetPremium: {
        type: "none",
        ratePercent: 0,
        capAmount: null,
        tiers: [],
        rawText:
          "No additional third-party internet buyer premium."
      },

      otherFees: []
    }
  },

  auctionRules: {
    biddingPlatform: {
      id: "native",
      additionalInternetPremiumApplies: false
    }
  }
};
