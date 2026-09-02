const {
  firstString
} = require("./auctionIdentityUtils");

function collectAuctionEvidence(
  input = {}
) {
  const auction =
    input.auction || {};

  const auctionEvent =
    input.auctionEvent || {};

  const auctionLot =
    input.auctionLot || {};

  return {
    provider:
      firstString(
        auction.provider,
        auction.platform,
        input.source?.platform,
        input.source?.type
      ),

    providerListingId:
      firstString(
        auction.providerListingId,
        auctionLot.sourceLotId,
        auctionLot.lotId,
        auction.lotId
      ),

    providerUrl:
      firstString(
        auction.providerUrl,
        auction.sourceUrl,
        auctionLot.sourceUrl,
        input.source?.url
      ),

    company:
      auction.company,

    companyName:
      firstString(
        auction.companyName,
        auctionEvent.companyName,
        auction.company?.name,
        auction.company?.canonicalName
      ),

    companyId:
      firstString(
        auction.companyId,
        auctionEvent.sourceAuctionHouseId,
        auction.company?.sourceId,
        auction.company?.id
      ),

    event:
      auction.event,

    sourceEventId:
      firstString(
        auction.eventId,
        auctionEvent.sourceEventId,
        auctionEvent.eventId,
        auction.event?.sourceId,
        auction.event?.id
      ),

    eventTitle:
      firstString(
        auction.eventTitle,
        auctionEvent.eventTitle,
        auction.event?.title,
        auction.event?.name
      ),

    auctionType:
      firstString(
        auction.auctionType,
        auctionEvent.auctionType,
        auction.event?.format
      ),

    participation:
      firstString(
        auction.participation,
        auctionEvent.participation,
        auction.event?.participation
      ),

    eventLocation:
      auction.event?.location ||
      auctionEvent.location ||
      auction.location,

    saleDateText:
      firstString(
        auction.saleDateText,
        auctionEvent.saleDateText,
        auction.event?.dateText
      ),

    startsAt:
      firstString(
        auction.startsAt,
        auctionEvent.startsAt,
        auction.event?.startsAt,
        auction.timing?.startsAt
      ),

    endsAt:
      firstString(
        auction.endsAt,
        auctionEvent.endsAt,
        auction.event?.endsAt,
        auction.timing?.endsAt
      ),

    timezone:
      firstString(
        auction.timezone,
        auctionEvent.timezone,
        auction.event?.timezone,
        auction.timing?.timezone
      ),

    lot:
      auction.lot,

    sourceLotId:
      firstString(
        auction.lotId,
        auctionLot.sourceLotId,
        auctionLot.lotId,
        auction.lot?.sourceId,
        auction.lot?.id
      ),

    lotNumber:
      firstString(
        auction.lotNumber,
        auctionLot.lotNumber,
        auction.lot?.number
      ),

    saleOrder:
      auction.saleOrder ??
      auctionLot.saleOrder ??
      auction.lot?.saleOrder,

    scheduledCloseAt:
      firstString(
        auction.scheduledCloseAt,
        auctionLot.scheduledCloseAt,
        auction.lot?.scheduledCloseAt,
        auction.timing?.scheduledCloseAt
      ),

    actualCloseAt:
      firstString(
        auction.actualCloseAt,
        auctionLot.actualCloseAt,
        auction.lot?.actualCloseAt,
        auction.timing?.actualCloseAt
      ),

    openingBid:
      auction.openingBid ??
      auctionLot.openingBid ??
      auction.lot?.openingBid ??
      auction.bidding?.openingBid,

    currentBid:
      auction.currentBid ??
      auctionLot.currentBid ??
      auction.lot?.currentBid ??
      auction.bidding?.currentBid,

    bidCount:
      auction.bidCount ??
      auctionLot.bidCount ??
      auction.lot?.bidCount ??
      auction.bidding?.bidCount,

    buyNowPrice:
      auction.buyNowPrice ??
      auctionLot.buyNowPrice ??
      auction.lot?.buyNowPrice ??
      auction.bidding?.buyNowPrice,

    bidIncrement:
      auction.bidIncrement ??
      auctionLot.bidIncrement ??
      auction.lot?.increment ??
      auction.bidding?.increment,

    reserveMet:
      auction.reserveMet ??
      auctionLot.reserveMet ??
      auction.lot?.reserveMet ??
      auction.bidding?.reserveMet,

    reserveNotMet:
      auction.reserveNotMet ??
      auctionLot.reserveNotMet,

    currency:
      firstString(
        auction.currency,
        auctionLot.currency,
        auction.lot?.currency,
        auction.bidding?.currency,
        "USD"
      ),

    status:
      firstString(
        auction.bidStatus,
        auction.status?.value,
        auctionLot.status,
        auction.lot?.status
      ),

    terms:
      auction.terms ||
      input.auctionTerms ||
      auctionEvent.terms ||
      null,

    source:
      auction.source || {},

    raw:
      input.auctionEvidence ||
      {}
  };
}

module.exports = {
  collectAuctionEvidence
};
