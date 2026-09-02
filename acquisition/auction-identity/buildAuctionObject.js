const {
  firstString,
  normalizeDateTime
} = require("./auctionIdentityUtils");

const {
  classifySale
} = require("./classifySale");

const {
  collectAuctionEvidence
} = require("./collectAuctionEvidence");

const {
  normalizeAuctionCompany
} = require("./normalizeAuctionCompany");

const {
  normalizeAuctionEvent
} = require("./normalizeAuctionEvent");

const {
  normalizeAuctionLot
} = require("./normalizeAuctionLot");

const {
  normalizeAuctionTiming
} = require("./normalizeAuctionTiming");

const {
  buildAuctionStatus
} = require("./buildAuctionStatus");

const {
  buildAuctionLaunchPolicy
} = require("./buildAuctionLaunchPolicy");

function buildAuctionObject(
  input = {},
  options = {}
) {
  const evidence =
    collectAuctionEvidence(input);

  const sale =
    classifySale({
      ...input,
      ...evidence
    });

  if (sale.type !== "auction") {
    return {
      sale,
      auction:
        null,

      launchPolicy:
        buildAuctionLaunchPolicy({
          sale,
          importAuthority:
            options.importAuthority ||
            input.importAuthority,

          requestedDestination:
            options.requestedDestination ||
            input.requestedDestination
        }),

      evidence
    };
  }

  const company =
    normalizeAuctionCompany(
      evidence
    );

  const event =
    normalizeAuctionEvent(
      evidence,
      company
    );

  const lot =
    normalizeAuctionLot(
      evidence,
      event,
      input.machine || {}
    );

  const timing =
    normalizeAuctionTiming({
      evidence,
      event,
      lot,
      now:
        options.now
    });

  const status =
    buildAuctionStatus({
      evidence,
      event,
      lot,
      timing
    });

  const provider =
    firstString(
      evidence.provider,
      input.source?.platform,
      input.source?.type
    );

  const providerUrl =
    firstString(
      evidence.providerUrl,
      input.source?.url
    );

  const auction = {
    schemaVersion:
      "ixi-auction-object-v1",

    provider,

    platform:
      provider,

    providerListingId:
      evidence.providerListingId,

    providerUrl,

    company,

    event,

    lot,

    bidding: {
      openingBid:
        lot.openingBid,

      currentBid:
        lot.currentBid,

      bidCount:
        lot.bidCount,

      reserveMet:
        lot.reserveMet,

      buyNowPrice:
        lot.buyNowPrice,

      increment:
        lot.increment,

      currency:
        lot.currency
    },

    timing,

    status,

    terms:
      evidence.terms,

    source: {
      url:
        providerUrl,

      type:
        firstString(
          input.source?.type,
          provider
        ),

      platform:
        firstString(
          input.source?.platform,
          provider
        ),

      scrapedAt:
        normalizeDateTime(
          firstString(
            evidence.source?.scrapedAt,
            input.scrapedAt
          )
        ),

      updatedAt:
        normalizeDateTime(
          firstString(
            evidence.source?.updatedAt,
            input.updatedAt
          )
        ),

      parserVersion:
        firstString(
          evidence.source?.parserVersion,
          input.acquisition?.parserVersion
        )
    }
  };

  const launchPolicy =
    buildAuctionLaunchPolicy({
      sale,
      importAuthority:
        options.importAuthority ||
        input.importAuthority,

      requestedDestination:
        options.requestedDestination ||
        input.requestedDestination
    });

  return {
    sale,
    auction,
    launchPolicy,
    evidence
  };
}

module.exports = {
  buildAuctionObject
};
