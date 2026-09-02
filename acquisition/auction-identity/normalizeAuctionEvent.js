const {
  firstString,
  normalizeDateTime,
  normalizeIdPart,
  normalizeUpper
} = require("./auctionIdentityUtils");

function normalizeLocation(
  ...candidates
) {
  let label = "";
  let city = "";
  let state = "";
  let country = "";
  let address = "";
  let postalCode = "";

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (typeof candidate === "string") {
      if (!label) {
        label =
          candidate.trim();
      }

      continue;
    }

    label =
      label ||
      firstString(
        candidate.label,
        candidate.name,
        candidate.formatted,
        candidate.location
      );

    city =
      city ||
      firstString(
        candidate.city,
        candidate.locality
      );

    state =
      state ||
      firstString(
        candidate.state,
        candidate.region,
        candidate.stateCode
      );

    country =
      country ||
      firstString(
        candidate.country,
        candidate.countryCode
      );

    address =
      address ||
      firstString(
        candidate.address,
        candidate.streetAddress
      );

    postalCode =
      postalCode ||
      firstString(
        candidate.postalCode,
        candidate.zip,
        candidate.zipCode
      );
  }

  if (!label) {
    label =
      [
        city,
        state
      ]
        .filter(Boolean)
        .join(", ");
  }

  return {
    label:
      normalizeUpper(label),

    city:
      normalizeUpper(city),

    state:
      normalizeUpper(state),

    country:
      normalizeUpper(country),

    address:
      normalizeUpper(address),

    postalCode:
      normalizeUpper(postalCode)
  };
}

function normalizeAuctionEvent(
  evidence = {},
  company = {}
) {
  const sourceId =
    firstString(
      evidence.event?.sourceId,
      evidence.event?.id,
      evidence.sourceEventId,
      evidence.eventId,
      evidence.auctionEventId
    );

  const title =
    firstString(
      evidence.event?.title,
      evidence.event?.name,
      evidence.eventTitle,
      evidence.auctionTitle,
      evidence.saleTitle
    );

  const startsAt =
    normalizeDateTime(
      firstString(
        evidence.event?.startsAt,
        evidence.startsAt,
        evidence.startDate,
        evidence.saleStartsAt
      )
    );

  const endsAt =
    normalizeDateTime(
      firstString(
        evidence.event?.endsAt,
        evidence.endsAt,
        evidence.endDate,
        evidence.saleEndsAt
      )
    );

  const dateText =
    firstString(
      evidence.event?.dateText,
      evidence.saleDateText,
      evidence.eventDateText,
      evidence.auctionDateText
    );

  const id =
    firstString(
      evidence.event?.normalizedId,
      sourceId
        ? [
            company.id,
            normalizeIdPart(sourceId)
          ]
            .filter(Boolean)
            .join("-")
        : "",
      title
        ? [
            company.id,
            normalizeIdPart(title),
            startsAt
              ? startsAt.slice(0, 10)
              : ""
          ]
            .filter(Boolean)
            .join("-")
        : ""
    );

  return {
    id,

    sourceId,

    title:
      normalizeUpper(title),

    format:
      normalizeUpper(
        firstString(
          evidence.event?.format,
          evidence.auctionType,
          evidence.eventType,
          evidence.saleType
        )
      ),

    participation:
      normalizeUpper(
        firstString(
          evidence.event?.participation,
          evidence.participation,
          evidence.biddingMethod
        )
      ),

    location:
      normalizeLocation(
        evidence.event?.location,
        evidence.eventLocation,
        evidence.auctionLocation,
        evidence.location
      ),

    dateText:
      normalizeUpper(dateText),

    startsAt,

    endsAt,

    timezone:
      firstString(
        evidence.event?.timezone,
        evidence.timezone,
        evidence.timeZone
      ),

    status:
      normalizeUpper(
        firstString(
          evidence.event?.status,
          evidence.eventStatus,
          evidence.auctionStatus
        )
      )
  };
}

module.exports = {
  normalizeAuctionEvent,
  normalizeLocation
};
