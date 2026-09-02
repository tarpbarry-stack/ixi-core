function clean(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstClean(...values) {
  for (const value of values) {
    const cleaned = clean(value);

    if (cleaned) {
      return cleaned;
    }
  }

  return "";
}

function firstDefined(...values) {
  for (const value of values) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      return value;
    }
  }

  return null;
}

function unique(values = []) {
  return [
    ...new Set(
      values.filter(Boolean)
    )
  ];
}

function buildTitle(machine = {}) {
  return clean(
    machine.title ||
    [
      machine.year,
      machine.make,
      machine.model
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function buildLocation(machine = {}) {
  const city = clean(machine.city);
  const state = clean(machine.state);
  const location =
    clean(machine.location);

  if (city && state) {
    return `${city}, ${state}`;
  }

  return location;
}

function normalizeMediaUrl(item) {
  if (!item) return "";

  if (typeof item === "string") {
    return clean(item);
  }

  if (
    typeof item === "object"
  ) {
    return clean(
      item.url ||
      item.sourceUrl ||
      item.src ||
      item.originalUrl ||
      ""
    );
  }

  return "";
}

function normalizeBoolean(value) {
  if (
    value === true ||
    value === false
  ) {
    return value;
  }

  const normalized =
    clean(value).toLowerCase();

  if (
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "1" ||
    normalized === "met"
  ) {
    return true;
  }

  if (
    normalized === "false" ||
    normalized === "no" ||
    normalized === "0" ||
    normalized === "not met"
  ) {
    return false;
  }

  return null;
}

function normalizeNumber(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  const normalized =
    String(value)
      .replace(/[$,%\s]/g, "")
      .replace(/,/g, "")
      .trim();

  if (!normalized) {
    return null;
  }

  const parsed =
    Number(normalized);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function normalizeLocation(
  primary = {},
  fallbackLabel = ""
) {
  const source =
    primary &&
    typeof primary === "object"
      ? primary
      : {};

  const city = firstClean(
    source.city,
    source.locality,
    source.town
  );

  const state = firstClean(
    source.state,
    source.region,
    source.stateCode,
    source.province
  );

  const country = firstClean(
    source.country,
    source.countryCode
  );

  const address = firstClean(
    source.address,
    source.streetAddress,
    source.addressLine1
  );

  const postalCode = firstClean(
    source.postalCode,
    source.zip,
    source.zipCode
  );

  const label = firstClean(
    source.label,
    source.location,
    source.name,
    fallbackLabel,
    [
      city,
      state
    ]
      .filter(Boolean)
      .join(", ")
  );

  return {
    label,
    city,
    state,
    country,
    address,
    postalCode
  };
}

function buildAuctionObject(
  result = {},
  machine = {}
) {
  const legacyAuction =
    result.auction &&
    typeof result.auction === "object"
      ? result.auction
      : {};

  const auctionEvent =
    result.auctionEvent &&
    typeof result.auctionEvent === "object"
      ? result.auctionEvent
      : legacyAuction.event &&
          typeof legacyAuction.event === "object"
        ? legacyAuction.event
        : {};

  const auctionLot =
    result.auctionLot &&
    typeof result.auctionLot === "object"
      ? result.auctionLot
      : legacyAuction.lot &&
          typeof legacyAuction.lot === "object"
        ? legacyAuction.lot
        : {};

  const auctionCompany =
    legacyAuction.company &&
    typeof legacyAuction.company === "object"
      ? legacyAuction.company
      : auctionEvent.company &&
          typeof auctionEvent.company === "object"
        ? auctionEvent.company
        : {};

  const auctionBidding =
    legacyAuction.bidding &&
    typeof legacyAuction.bidding === "object"
      ? legacyAuction.bidding
      : auctionLot.bidding &&
          typeof auctionLot.bidding === "object"
        ? auctionLot.bidding
        : {};

  const auctionTiming =
    legacyAuction.timing &&
    typeof legacyAuction.timing === "object"
      ? legacyAuction.timing
      : auctionLot.timing &&
          typeof auctionLot.timing === "object"
        ? auctionLot.timing
        : {};

  const auctionStatus =
    legacyAuction.status &&
    typeof legacyAuction.status === "object"
      ? legacyAuction.status
      : {};

  const source =
    result.source &&
    typeof result.source === "object"
      ? result.source
      : {};

  const acquisition =
    result.acquisition &&
    typeof result.acquisition === "object"
      ? result.acquisition
      : {};

  const platform = firstClean(
    legacyAuction.platform,
    legacyAuction.provider,
    source.platform,
    source.type,
    acquisition.platform,
    machine.source
  );

  const providerListingId =
    firstClean(
      legacyAuction.providerListingId,
      legacyAuction.listingId,
      auctionLot.providerListingId,
      auctionLot.id,
      auctionLot.lotId,
      result.providerListingId,
      machine.providerListingId
    );

  const providerUrl =
    firstClean(
      legacyAuction.providerUrl,
      legacyAuction.url,
      source.url,
      acquisition.url,
      machine.url
    );

  const companyName =
    firstClean(
      auctionCompany.name,
      auctionCompany.companyName,
      auctionEvent.companyName,
      auctionEvent.auctionCompanyName,
      legacyAuction.companyName,
      legacyAuction.auctionCompany,
      result.auctionCompanyName,
      result.auctionCompany
    );

  const eventLocation =
    normalizeLocation(
      auctionEvent.location,
      firstClean(
        auctionEvent.locationLabel,
        auctionEvent.auctionLocation,
        legacyAuction.eventLocation,
        legacyAuction.auctionLocation
      )
    );

  const machineLocation =
    normalizeLocation(
      auctionLot.machineLocation,
      firstClean(
        auctionLot.location,
        auctionLot.locationLabel,
        machine.location,
        buildLocation(machine)
      )
    );

  const timezone =
    firstClean(
      auctionLot.timezone,
      auctionTiming.timezone,
      auctionEvent.timezone,
      legacyAuction.timezone,
      result.auctionTimezone
    );

  const scheduledCloseAt =
    firstClean(
      auctionLot.scheduledCloseAt,
      auctionLot.closeAt,
      auctionLot.endsAt,
      auctionTiming.scheduledCloseAt,
      auctionTiming.closeAt,
      legacyAuction.scheduledCloseAt,
      legacyAuction.closeAt,
      result.scheduledCloseAt,
      result.auctionCloseAt
    );

  const actualCloseAt =
    firstClean(
      auctionLot.actualCloseAt,
      auctionTiming.actualCloseAt,
      legacyAuction.actualCloseAt
    );

  const startsAt =
    firstClean(
      auctionEvent.startsAt,
      auctionEvent.startAt,
      auctionEvent.startDate,
      legacyAuction.startsAt
    );

  const endsAt =
    firstClean(
      auctionEvent.endsAt,
      auctionEvent.endAt,
      auctionEvent.endDate,
      legacyAuction.endsAt
    );

  const currentBid =
    normalizeNumber(
      firstDefined(
        auctionBidding.currentBid,
        auctionLot.currentBid,
        auctionLot.bidAmount,
        legacyAuction.currentBid,
        result.currentBid
      )
    );

  const openingBid =
    normalizeNumber(
      firstDefined(
        auctionBidding.openingBid,
        auctionLot.openingBid,
        auctionLot.startingBid,
        legacyAuction.openingBid,
        result.openingBid
      )
    );

  const buyNowPrice =
    normalizeNumber(
      firstDefined(
        auctionBidding.buyNowPrice,
        auctionLot.buyNowPrice,
        auctionLot.buyNow,
        legacyAuction.buyNowPrice
      )
    );

  const bidIncrement =
    normalizeNumber(
      firstDefined(
        auctionBidding.increment,
        auctionBidding.bidIncrement,
        auctionLot.increment,
        auctionLot.bidIncrement,
        legacyAuction.bidIncrement
      )
    );

  const bidCount =
    normalizeNumber(
      firstDefined(
        auctionBidding.bidCount,
        auctionLot.bidCount,
        auctionLot.numberOfBids,
        legacyAuction.bidCount,
        result.bidCount
      )
    );

  const reserveMet =
    normalizeBoolean(
      firstDefined(
        auctionBidding.reserveMet,
        auctionLot.reserveMet,
        legacyAuction.reserveMet
      )
    );

  const statusValue =
    firstClean(
      auctionLot.status,
      auctionStatus.value,
      auctionStatus.status,
      legacyAuction.statusText,
      legacyAuction.auctionStatus,
      result.auctionStatus
    );

  const hasAuctionData = [
    platform,
    providerListingId,
    companyName,
    auctionEvent.id,
    auctionEvent.name,
    auctionEvent.eventName,
    auctionLot.number,
    auctionLot.lotNumber,
    scheduledCloseAt,
    currentBid,
    openingBid,
    statusValue
  ].some(value => {
    return (
      value !== undefined &&
      value !== null &&
      value !== ""
    );
  });

  if (!hasAuctionData) {
    return null;
  }

  return {
    provider: platform,
    platform,

    providerListingId,
    providerUrl,

    company: {
      id: firstClean(
        auctionCompany.id,
        auctionCompany.companyId,
        auctionEvent.companyId,
        legacyAuction.companyId
      ),

      name: companyName,

      url: firstClean(
        auctionCompany.url,
        auctionCompany.website,
        auctionEvent.companyUrl
      )
    },

    event: {
      id: firstClean(
        auctionEvent.id,
        auctionEvent.eventId,
        legacyAuction.eventId
      ),

      name: firstClean(
        auctionEvent.name,
        auctionEvent.eventName,
        auctionEvent.title,
        legacyAuction.eventName,
        legacyAuction.auctionEventName,
        result.auctionEventName
      ),

      format: firstClean(
        auctionEvent.format,
        auctionEvent.auctionFormat,
        legacyAuction.format,
        legacyAuction.auctionFormat,
        result.auctionFormat
      ),


      participation: firstClean(
        auctionEvent.participation,
        auctionEvent.participationType,
        legacyAuction.participation,
        legacyAuction.auctionParticipation,
        result.auctionParticipation
      ),

      scope: firstClean(
        auctionEvent.scope,
        legacyAuction.scope,
        result.auctionEventScope
      ),

      location: eventLocation,


      dateText: firstClean(
        auctionEvent.dateText,
        auctionEvent.saleDateText,
        auctionEvent.date,
        legacyAuction.dateText,
        legacyAuction.auctionDate,
        result.auctionDate
      ),

      startsAt,
      endsAt,
      timezone
    },

    lot: {
      id: firstClean(
        auctionLot.id,
        auctionLot.lotId,
        providerListingId
      ),

      number: firstClean(
        auctionLot.number,
        auctionLot.lotNumber,
        auctionLot.lot,
        legacyAuction.lotNumber,
        result.lotNumber
      ),

      saleOrder:
        normalizeNumber(
          firstDefined(
            auctionLot.saleOrder,
            auctionLot.order,
            auctionLot.sequence
          )
        ),

      scheduledCloseAt,
      actualCloseAt,
      timezone,

      openingBid,
      currentBid,
      bidCount,

      buyNowPrice,
      increment:
        bidIncrement,

      reserveMet,

      currency: firstClean(
        auctionBidding.currency,
        auctionLot.currency,
        legacyAuction.currency,
        "USD"
      ),

      status:
        statusValue,

      machineLocation
    },

    bidding: {
      openingBid,
      currentBid,
      bidCount,

      reserveMet,

      buyNowPrice,

      increment:
        bidIncrement,

      currency: firstClean(
        auctionBidding.currency,
        auctionLot.currency,
        legacyAuction.currency,
        "USD"
      )
    },

    timing: {
      timezone,
      startsAt,
      endsAt,
      scheduledCloseAt,
      actualCloseAt,

      updatedAt: firstClean(
        auctionTiming.updatedAt,
        auctionLot.updatedAt,
        legacyAuction.updatedAt,
        result.scrapedAt,
        acquisition.scrapedAt
      )
    },

    status: {
      value:
        statusValue,

      live:
        normalizeBoolean(
          firstDefined(
            auctionStatus.live,
            legacyAuction.live
          )
        ),

      closed:
        normalizeBoolean(
          firstDefined(
            auctionStatus.closed,
            legacyAuction.closed
          )
        ),

      pending:
        normalizeBoolean(
          firstDefined(
            auctionStatus.pending,
            legacyAuction.pending
          )
        ),

      sold:
        normalizeBoolean(
          firstDefined(
            auctionStatus.sold,
            legacyAuction.sold
          )
        ),

      extended:
        normalizeBoolean(
          firstDefined(
            auctionStatus.extended,
            legacyAuction.extended,
            auctionLot.extended
          )
        )
    },

    terms:
      result.auctionTerms ||
      auctionEvent.terms ||
      legacyAuction.terms ||
      null,

    /*
     * Preserve the source engine's AOF compatibility contract.
     * No parsing or source-specific normalization belongs here.
     */
    auctionRules:
      legacyAuction.auctionRules &&
      typeof legacyAuction.auctionRules === "object"
        ? legacyAuction.auctionRules
        : null,

    source: {
      url:
        providerUrl,

      type: firstClean(
        source.type,
        platform
      ),

      platform,

      scrapedAt: firstClean(
        result.scrapedAt,
        acquisition.scrapedAt,
        acquisition.capturedAt,
        legacyAuction.scrapedAt
      ),

      updatedAt: firstClean(
        legacyAuction.updatedAt,
        auctionLot.updatedAt,
        auctionEvent.updatedAt
      ),

      parserVersion: firstClean(
        result.parserVersion,
        acquisition.parserVersion,
        legacyAuction.parserVersion
      )
    }
  };
}


function resolveLaunchPrice({
  machine = {},
  auction = {}
} = {}) {
  const bidding =
    auction.bidding || {};

  const lot =
    auction.lot || {};

  const event =
    auction.event || {};

  const price =
    firstDefined(
      bidding.reservePrice,
      lot.reservePrice,

      bidding.currentBid,
      lot.currentBid,
      lot.bidAmount,

      bidding.buyNowPrice,
      lot.buyNowPrice,
      lot.buyNow,

      bidding.askingPrice,
      lot.askingPrice,

      bidding.openingBid,
      lot.openingBid,
      lot.startingBid,

      event.currentBid,
      event.openingBid,

      machine.price
    );

  const normalized =
    normalizeNumber(price);

  return String(
    normalized > 0
      ? normalized
      : 1
  );
}


function buildLaunchPayload(result = {}) {
  const machine =
    result.machine || {};

  const media =
    Array.isArray(result.media)
      ? result.media
      : Array.isArray(machine.photos)
        ? machine.photos
        : [];

  const photos = unique(
    media
      .map(normalizeMediaUrl)
      .filter(Boolean)
  );

  const auction =
    buildAuctionObject(
      result,
      machine
    );

  const auctionEvent =
    auction?.event ||
    result.auctionEvent ||
    null;

  const auctionLot =
    auction?.lot ||
    result.auctionLot ||
    null;

  const auctionMachineLocation =
    normalizeLocation(
      auctionLot?.machineLocation ||
      auction?.machine?.location ||
      result.auctionLot?.machineLocation ||
      result.auction?.lot?.machineLocation ||
      {}
    );

  const launchCity =
    firstClean(
      machine.city,
      auctionMachineLocation.city
    );

  const launchState =
    firstClean(
      machine.state,
      auctionMachineLocation.state
    );

  const launchLocation =
    firstClean(
      buildLocation({
        ...machine,
        city: launchCity,
        state: launchState
      }),
      auctionMachineLocation.label
    );

  const auctionTerms =
    auction?.terms ||
    result.auctionTerms ||
    auctionEvent?.terms ||
    null;

  const launchPolicy =
    result.launchPolicy || null;

  return {
    source: {
      type:
        result.source?.type ||
        machine.source ||
        "",

      label:
        result.source?.label ||
        result.source?.platform ||
        machine.sourceName ||
        "",

      platform:
        result.source?.platform ||
        result.acquisition?.platform ||
        "",

      url:
        result.source?.url ||
        machine.url ||
        ""
    },

    sourceListingUrl:
      result.source?.url ||
      machine.url ||
      "",

    title:
      buildTitle(machine),

    year:
      clean(machine.year),

    make:
      clean(machine.make),

    model:
      clean(machine.model),

    category:
      clean(machine.category),


price:
  resolveLaunchPrice({
    machine,
    auction
  }),

    hours:
      clean(machine.hours),

    location:
      launchLocation,

    city:
      launchCity,

    state:
      launchState,

    serialNumber:
      clean(machine.serialNumber),

    stockNumber:
      clean(machine.stockNumber),

    description:
      clean(machine.description),

    photos,

    photoCount:
      photos.length,

    identity: {
      ok:
        !!machine.identity?.ok,

      confidence:
        machine.identity?.confidence ||
        "",

      category:
        machine.identity?.resolved
          ?.category ||
        machine.category ||
        "",

      make:
        machine.identity?.resolved
          ?.make ||
        machine.make ||
        "",

      model:
        machine.identity?.resolved
          ?.model ||
        machine.model ||
        ""
    },

    auction,

    auctionEvent,

    auctionLot,

    auctionTerms,

    launchPolicy,

    acquisition:
      result.acquisition || {},

    confidence:
      result.confidence || {}
  };
}

module.exports = {
  buildLaunchPayload
};
