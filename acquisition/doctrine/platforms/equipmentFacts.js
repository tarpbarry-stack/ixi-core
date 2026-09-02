module.exports = {
  platformId: "equipmentfacts",

  platform: {
    id: "equipmentfacts",
    name: "EquipmentFacts",
    url: "https://www.equipmentfacts.com"
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
      id: "equipmentfacts",
      additionalInternetPremiumApplies: null
    }
  }
};
