module.exports = {
  companyId: "lyon-auction",

  company: {
    id: "lyon-auction",
    name: "Lyon Auction",
    legalName: "Alex Lyon & Son",
    url: "https://www.lyonauction.com"
  },

  terms: {
    basicTerms: [
      {
        code: "as_is_where_is",
        label: "AS IS, WHERE IS",
        confirmed: true,
        evidence:
          "IXI COMPANY DOCTRINE — LYON AUCTION",
        sourceUrl: ""
      }
    ],

    /*
     * These remain intentionally unknown until populated
     * from a verified Lyon Proxibid terms record.
     */

buyerPremium: {
  type: "tiered",

  tiers: [
    {
      minAmount: 1,
      maxAmount: 5000,
      cashCheckWireRatePercent: 12.5,
      creditCardRatePercent: 15.5
    },
    {
      minAmount: 5001,
      maxAmount: 55000,
      cashCheckWireRatePercent: 10,
      creditCardRatePercent: 13
    },
    {
      minAmount: 55001,
      maxAmount: null,
      cashCheckWireRatePercent: 5.99,
      creditCardRatePercent: 8.99
    }
  ],

  internetAdditional: {
    ratePercent: 2.5,
    capAmount: 700,
    perItem: true
  },

  rawText:
    "Verified Lyon standard auction terms."
},

payment: {
  dueRule: "relative-business-days",
  dueText:
    "Full payment is due within 5 business days from the auction date.",

  options: [
    "Cash",
    "Certified Check",
    "Wire Transfer",
    "Credit Card"
  ],

  instructions:
    "Cash, Certified Check and Credit Card accepted on sale day. After sale day, payment by Wire Transfer or Credit Card.",

  rawText:
    "Verified Lyon standard payment policy."
},

tax: {
  taxable: true,
  exemptionAllowed: true,
  exemptionCertificateRequired: true,
  exporterExemptionPossible: true,
  possessionInUnitedStatesTaxable: true,

  rawText:
    "Verified Lyon standard sales tax policy."
},

removal: {
  deadlineText:
    "Purchases must be removed within 7 days of the sale date.",

  relativeDays: 7,

  instructions:
    "Storage fee of $200 per day per item after 7 days.",

  storageFeeText:
    "$200/day/item after 7 days.",

  rawText:
    "Verified Lyon standard removal policy."
},

shipping: {
  available: true,
  buyerResponsible: true,

  instructions:
    "Shipping arrangements and cost are the buyer's responsibility.",

  rawText:
    "Verified Lyon standard shipping policy."
},

  legalTermsSource: {
    url: "",
    enriched: true,
    source:
      "Verified Lyon standard company doctrine"
  }
},

auctionRules: {
    doctrine: {
      companyId: "lyon-auction",
      version: "1.0.0",
      sourceType: "company-doctrine",
      verifiedAt: ""
    }
  }
};
