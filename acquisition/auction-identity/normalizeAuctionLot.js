const {
  firstString,
  normalizeBoolean,
  normalizeDateTime,
  normalizeIdPart,
  normalizeNumber,
  normalizeUpper
} = require("./auctionIdentityUtils");

const {
  normalizeLocation
} = require("./normalizeAuctionEvent");

function normalizeAuctionLot(
  evidence = {},
  event = {},
  machine = {}
) {
  const sourceId =
    firstString(
      evidence.lot?.sourceId,
      evidence.lot?.id,
      evidence.sourceLotId,
      evidence.lotId,
      evidence.providerListingId
    );

  const number =
    firstString(
      evidence.lot?.number,
      evidence.lotNumber,
      evidence.saleOrderNumber
    );

  const id =
    firstString(
      evidence.lot?.normalizedId,
      sourceId
        ? [
            event.id,
            normalizeIdPart(sourceId)
          ]
            .filter(Boolean)
            .join("-")
        : "",
      number
        ? [
            event.id,
            "lot",
            normalizeIdPart(number)
          ]
            .filter(Boolean)
            .join("-")
        : ""
    );

  const reserveNotMet =
    normalizeBoolean(
      evidence.lot?.reserveNotMet ??
      evidence.reserveNotMet
    );

  let reserveMet =
    normalizeBoolean(
      evidence.lot?.reserveMet ??
      evidence.reserveMet
    );

  if (
    reserveMet === null &&
    reserveNotMet !== null
  ) {
    reserveMet =
      !reserveNotMet;
  }

  return {
    id,

    sourceId,

    number,

    saleOrder:
      normalizeNumber(
        evidence.lot?.saleOrder ??
        evidence.saleOrder
      ),

    scheduledCloseAt:
      normalizeDateTime(
        firstString(
          evidence.lot?.scheduledCloseAt,
          evidence.scheduledCloseAt,
          evidence.lotCloseAt,
          evidence.closesAt
        )
      ),

    actualCloseAt:
      normalizeDateTime(
        firstString(
          evidence.lot?.actualCloseAt,
          evidence.actualCloseAt
        )
      ),

    timezone:
      firstString(
        evidence.lot?.timezone,
        evidence.timezone,
        event.timezone
      ),

    openingBid:
      normalizeNumber(
        evidence.lot?.openingBid ??
        evidence.openingBid
      ),

    currentBid:
      normalizeNumber(
        evidence.lot?.currentBid ??
        evidence.currentBid ??
        evidence.highBid
      ),

    bidCount:
      normalizeNumber(
        evidence.lot?.bidCount ??
        evidence.bidCount
      ),

    buyNowPrice:
      normalizeNumber(
        evidence.lot?.buyNowPrice ??
        evidence.buyNowPrice
      ),

    increment:
      normalizeNumber(
        evidence.lot?.increment ??
        evidence.bidIncrement
      ),

    reserveMet,

    currency:
      normalizeUpper(
        firstString(
          evidence.lot?.currency,
          evidence.currency,
          "USD"
        )
      ),

    status:
      normalizeUpper(
        firstString(
          evidence.lot?.status,
          evidence.status,
          evidence.bidStatus,
          evidence.lotStatus
        )
      ),

    machineLocation:
      normalizeLocation(
        evidence.lot?.machineLocation,
        evidence.machineLocation,
        {
          label:
            machine.location,

          city:
            machine.city,

          state:
            machine.state,

          country:
            machine.country,

          address:
            machine.address,

          postalCode:
            machine.postalCode
        }
      )
  };
}

module.exports = {
  normalizeAuctionLot
};
