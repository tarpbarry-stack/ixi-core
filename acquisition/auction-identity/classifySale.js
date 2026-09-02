const {
  firstString,
  normalizeLower,
  uniqueStrings
} = require("./auctionIdentityUtils");

const AUCTION_PATTERNS = [
  /\bauction\b/i,
  /\blot\b/i,
  /\bbid(?:ding)?\b/i,
  /\bopening bid\b/i,
  /\bcurrent bid\b/i,
  /\bhigh bid\b/i,
  /\breserve\b/i,
  /\bsale order\b/i,
  /\btimed auction\b/i,
  /\blive auction\b/i,
  /\bonline auction\b/i
];

const FIXED_PRICE_PATTERNS = [
  /\bbuy now\b/i,
  /\basking price\b/i,
  /\bfor sale\b/i,
  /\bmarketplace\b/i,
  /\bmake offer\b/i,
  /\bfixed price\b/i
];

function collectSaleText(input = {}) {
  const source =
    input.source || {};

  const acquisition =
    input.acquisition || {};

  const auction =
    input.auction || {};

  const auctionEvent =
    input.auctionEvent || {};

  const auctionLot =
    input.auctionLot || {};

  const machine =
    input.machine || {};

  return uniqueStrings([
    input.saleType,
    input.type,
    input.mechanism,
    input.rawText,
    acquisition.saleType,
    acquisition.method,
    source.type,
    source.label,
    source.platform,
    auction.auctionType,
    auction.eventTitle,
    auction.status,
    auctionEvent.auctionType,
    auctionEvent.eventTitle,
    auctionLot.status,
    machine.title,
    machine.description
  ]);
}

function classifySale(input = {}) {
  const explicitType =
    normalizeLower(
      firstString(
        input.sale?.type,
        input.saleType,
        input.acquisition?.saleType
      )
    );

  if (
    [
      "auction",
      "fixed-price",
      "buy-now",
      "marketplace",
      "unknown"
    ].includes(explicitType)
  ) {
    return {
      type:
        explicitType === "buy-now" ||
        explicitType === "marketplace"
          ? "fixed-price"
          : explicitType,

      mechanism:
        explicitType,

      confidence:
        "high",

      evidence: [
        `explicit-sale-type:${explicitType}`
      ]
    };
  }

  const texts =
    collectSaleText(input);

  const auctionEvidence = [];
  const fixedPriceEvidence = [];

  for (const text of texts) {
    for (const pattern of AUCTION_PATTERNS) {
      if (pattern.test(text)) {
        auctionEvidence.push(text);
        break;
      }
    }

    for (
      const pattern of
      FIXED_PRICE_PATTERNS
    ) {
      if (pattern.test(text)) {
        fixedPriceEvidence.push(text);
        break;
      }
    }
  }

  const auctionLot =
    input.auctionLot || {};

  const auctionEvent =
    input.auctionEvent || {};

  const auction =
    input.auction || {};

  if (
    auctionLot.lotNumber ||
    auctionLot.sourceLotId ||
    auction.lotNumber ||
    auction.lot?.number ||
    auction.currentBid !== undefined ||
    auction.lot?.currentBid !== undefined ||
    auctionEvent.sourceEventId
  ) {
    auctionEvidence.push(
      "structured-auction-fields"
    );
  }

  const uniqueAuctionEvidence =
    uniqueStrings(auctionEvidence);

  const uniqueFixedEvidence =
    uniqueStrings(fixedPriceEvidence);

  if (
    uniqueAuctionEvidence.length > 0 &&
    uniqueAuctionEvidence.length >=
      uniqueFixedEvidence.length
  ) {
    return {
      type:
        "auction",

      mechanism:
        normalizeLower(
          firstString(
            auctionEvent.auctionType,
            auction.auctionType,
            auction.event?.format,
            "auction"
          )
        ),

      confidence:
        uniqueAuctionEvidence.length >= 2
          ? "high"
          : "medium",

      evidence:
        uniqueAuctionEvidence
    };
  }

  if (uniqueFixedEvidence.length > 0) {
    const hasBuyNow =
      uniqueFixedEvidence.some(value =>
        /\bbuy now\b/i.test(value)
      );

    return {
      type:
        "fixed-price",

      mechanism:
        hasBuyNow
          ? "buy-now"
          : "fixed-price",

      confidence:
        uniqueFixedEvidence.length >= 2
          ? "high"
          : "medium",

      evidence:
        uniqueFixedEvidence
    };
  }

  return {
    type:
      "unknown",

    mechanism:
      "unknown",

    confidence:
      "low",

    evidence: []
  };
}

module.exports = {
  classifySale
};
