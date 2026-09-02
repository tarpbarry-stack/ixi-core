const { applyIdentityToParsedListing } =
  require("../parsers/applyIdentityToParsedListing");

const {
  loadWavebidPhotos
} = require("../media/wavebidPhotoEngine");

const {
  filterMachinePhotos
} = require("../media/filterMachinePhotos");

const {
  applyAuctionDoctrine
} = require("../doctrine/applyAuctionDoctrine");

function clean(value = "") {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#215;/g, "x")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchFirst(text = "", patterns = []) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);

    if (match?.[1]) {
      return clean(match[1]);
    }
  }

  return "";
}

function unique(items = []) {
  return Array.from(
    new Set(
      items
        .map(item => clean(item))
        .filter(Boolean)
    )
  );
}

function getStateCode(value = "") {
  const state = clean(value).toUpperCase();

  const states = {
    ALABAMA: "AL",
    ALASKA: "AK",
    ARIZONA: "AZ",
    ARKANSAS: "AR",
    CALIFORNIA: "CA",
    COLORADO: "CO",
    CONNECTICUT: "CT",
    DELAWARE: "DE",
    FLORIDA: "FL",
    GEORGIA: "GA",
    HAWAII: "HI",
    IDAHO: "ID",
    ILLINOIS: "IL",
    INDIANA: "IN",
    IOWA: "IA",
    KANSAS: "KS",
    KENTUCKY: "KY",
    LOUISIANA: "LA",
    MAINE: "ME",
    MARYLAND: "MD",
    MASSACHUSETTS: "MA",
    MICHIGAN: "MI",
    MINNESOTA: "MN",
    MISSISSIPPI: "MS",
    MISSOURI: "MO",
    MONTANA: "MT",
    NEBRASKA: "NE",
    NEVADA: "NV",
    "NEW HAMPSHIRE": "NH",
    "NEW JERSEY": "NJ",
    "NEW MEXICO": "NM",
    "NEW YORK": "NY",
    "NORTH CAROLINA": "NC",
    "NORTH DAKOTA": "ND",
    OHIO: "OH",
    OKLAHOMA: "OK",
    OREGON: "OR",
    PENNSYLVANIA: "PA",
    "RHODE ISLAND": "RI",
    "SOUTH CAROLINA": "SC",
    "SOUTH DAKOTA": "SD",
    TENNESSEE: "TN",
    TEXAS: "TX",
    UTAH: "UT",
    VERMONT: "VT",
    VIRGINIA: "VA",
    WASHINGTON: "WA",
    "WEST VIRGINIA": "WV",
    WISCONSIN: "WI",
    WYOMING: "WY"
  };

  if (/^[A-Z]{2}$/.test(state)) {
    return state;
  }

  return states[state] || "";
}

function getProviderListingId(url = "") {
  return matchFirst(url, [
    /\/lot\/([^/?#]+)/i
  ]);
}


function buildEventDateText(
  auctionDate = "",
  auctionTime = ""
) {
  return clean(
    [auctionDate, auctionTime]
      .filter(Boolean)
      .join(" ")
  );
}

async function acquire(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/149 Safari/537.36"
    }
  });

  if (!res.ok) {
    throw new Error(
      `Lyon fetch failed: ${res.status}`
    );
  }

  const html = await res.text();
  const visibleText = clean(html);
const wavebidUrl = matchFirst(html, [
    /href=["'](https?:\/\/www\.wavebid\.com\/lot\/[^"']+)["']/i
  ]);

  const title = matchFirst(html, [
    /<h1[^>]*>\s*Lot\s*#\d+\s*-\s*([\s\S]*?)<\/h1>/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i
  ]).replace(/\s*-\s*Alex Lyon.*$/i, "");

  const description =
    matchFirst(html, [
      /####\s*Description\s*([\s\S]*?)Quantity:/i,
      /<h4[^>]*>\s*Description\s*<\/h4>\s*<p[^>]*>([\s\S]*?)<\/p>/i
    ]) ||
    matchFirst(visibleText, [
      /Description\s+(.*?)\s+Quantity:/i
    ]);

  const combined = clean(
    `${title} ${description} ${visibleText}`
  );

  const sourceCategory =
    matchFirst(visibleText, [
      /Lot\s+#\d+\s+-\s+.*?\s+(crawler tractors|dozers|excavators|wheel loaders|backhoes|motor graders|skid steers|compact track loaders)/i,
      /\b(crawler tractors)\b/i
    ]) ||
    "crawler tractors";

  const year = matchFirst(combined, [
    /\b(20\d{2}|19\d{2})\b/
  ]);

  const make = matchFirst(combined, [
    /\b(?:20\d{2}|19\d{2})\s+(CAT|CATERPILLAR|CASE|KOMATSU|DEERE|JOHN DEERE|VOLVO|HITACHI|LINK-BELT|KOBELCO)\b/i
  ]);

  const model = matchFirst(combined, [
    /\b(?:20\d{2}|19\d{2})\s+(?:CAT|CATERPILLAR|CASE|KOMATSU|DEERE|JOHN DEERE|VOLVO|HITACHI|LINK-BELT|KOBELCO)\s+([A-Z0-9-]+)/i
  ]);

  const hours = matchFirst(combined, [
    /([\d,]+)\s*hours/i
  ]);

  const serialNumber = matchFirst(combined, [
    /SN\s*[:#]?\s*([A-Z0-9]+)/i,
    /Serial\s*[:#]?\s*([A-Z0-9]+)/i
  ]);

  const saleLocationText = matchFirst(
    visibleText,
    [
      /Auction\s+Show\s+Auction\s+Details\s+([A-Za-z .'-]+,\s*[A-Za-z ]+)\s*\(ONSITE/i,
      /Show\s+Auction\s+Details\s+([A-Za-z .'-]+,\s*[A-Za-z ]+)\s*\(ONSITE/i
    ]
  );

  const locationMatch =
    saleLocationText.match(/^(.+),\s*(.+)$/);

  const city =
    locationMatch?.[1]?.trim() || "";

  const state =
    locationMatch?.[2]?.trim() || "";

  const stateCode =
    getStateCode(state);

  const auctionDate = matchFirst(
    visibleText,
    [
      /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*(\d{2}\/\d{2}\/\d{4})/i,
      /\b(\d{2}\/\d{2}\/\d{4})\b/
    ]
  );

const auctionTime = matchFirst(
  visibleText,
  [
    /\b\d{2}\/\d{2}\/\d{4}\s+([0-9]{1,2}:[0-9]{2}\s*[AP]M(?:\s*(?:EST|EDT|CST|CDT|MST|MDT|PST|PDT))?)/i,
    /\b([0-9]{1,2}:[0-9]{2}\s*[AP]M(?:\s*(?:EST|EDT|CST|CDT|MST|MDT|PST|PDT))?)\b/i
  ]
);

  const lotNumber = matchFirst(
    visibleText,
    [
      /Lot\s+#\s*([A-Z0-9-]+)/i
    ]
  );

  const providerListingId =
    getProviderListingId(url) ||
    lotNumber;

  const eventId = matchFirst(html, [
    /auction[_-]?id["']?\s*[:=]\s*["']?([A-Z0-9-]+)/i,
    /event[_-]?id["']?\s*[:=]\s*["']?([A-Z0-9-]+)/i,
    /sale[_-]?id["']?\s*[:=]\s*["']?([A-Z0-9-]+)/i
  ]);

  const eventName = matchFirst(
    visibleText,
    [
      /Auction\s+Details\s+(.+?)\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),/i,
      /Show\s+Auction\s+Details\s+(.+?)\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),/i
    ]
  );

  const openingBidRaw = matchFirst(
    visibleText,
    [
      /Opening\s+Bid\s*:?\s*\$?([\d,]+(?:\.\d{2})?)/i,
      /Starting\s+Bid\s*:?\s*\$?([\d,]+(?:\.\d{2})?)/i
    ]
  );

  const currentBidRaw = matchFirst(
    visibleText,
    [
      /Current\s+Bid\s*:?\s*\$?([\d,]+(?:\.\d{2})?)/i,
      /High\s+Bid\s*:?\s*\$?([\d,]+(?:\.\d{2})?)/i
    ]
  );

  const bidCountRaw = matchFirst(
    visibleText,
    [
      /Bid(?:s)?\s*:?\s*(\d+)/i
    ]
  );

  const openingBid = openingBidRaw
    ? Number(
        openingBidRaw.replace(/,/g, "")
      )
    : null;

  const currentBid = currentBidRaw
    ? Number(
        currentBidRaw.replace(/,/g, "")
      )
    : null;

  const resolvedOpeningBid =
    openingBid !== null
      ? openingBid
      : currentBid !== null
        ? currentBid
        : 1000;

  const bidCount = bidCountRaw
    ? Number(bidCountRaw)
    : null;

  const photos = wavebidUrl
    ? await loadWavebidPhotos(wavebidUrl)
    : filterMachinePhotos(
        unique(
          Array.from(
            html.matchAll(
              /https?:\/\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s<>]*)?/gi
            )
          ).map(match => match[0])
        )
      );

  const machine =
    applyIdentityToParsedListing({
      source: "lyon-auction",
      sourceName: "Lyon Auction",
      url,
      title,
      description,
      visibleText,
      year,
      make,
      model,
      hours,
      price:
        currentBid !== null
          ? String(currentBid)
          : String(resolvedOpeningBid),
      city,
      state: stateCode || state,
      serialNumber,
      sourceCategory,
      photos
    });

  const eventDateText =
    buildEventDateText(
      auctionDate,
      auctionTime
    );

  const normalizedLocationText =
    [city, stateCode || state]
      .filter(Boolean)
      .join(", ");

  const eventLocation = {
    label: normalizedLocationText,
    display: normalizedLocationText,
    city,
    state: stateCode || state,
    stateCode,
    country: "United States",
    countryCode: "US",
    address: "",
    postalCode: ""
  };

let auction = {
    provider: "lyon-auction",
    platform: "lyon-auction",

    providerListingId,
    providerUrl: url,

    company: {
      id: "lyon-auction",
      name: "Lyon Auction",
      url: "https://www.lyonauction.com"
    },

    event: {
      id: eventId,
      name: eventName,
      format: "onsite",
      participation: "",
      scope: "local",
      location: eventLocation,
      dateText: eventDateText,
      startsAt: "",
      endsAt: "",
      timezone: ""
    },

    lot: {
      id:
        lotNumber ||
        providerListingId,

      number: lotNumber,
      saleOrder: null,

      scheduledCloseAt: "",
      actualCloseAt: "",
      timezone: "",

      openingBid: resolvedOpeningBid,
      currentBid,
      bidCount,

      buyNowPrice: null,
      increment: null,
      reserveMet: null,

      currency: "USD",
      status: "",

      machineLocation: eventLocation
    },

    bidding: {
      openingBid: resolvedOpeningBid,
      currentBid,
      bidCount,
      reserveMet: null,
      buyNowPrice: null,
      increment: null,
      currency: "USD"
    },

    timing: {
      timezone: "",
      startsAt: "",
      endsAt: "",
      scheduledCloseAt: "",
      actualCloseAt: "",
      updatedAt: ""
    },

    status: {
      value: "",
      live: null,
      closed: null,
      pending: null,
      sold: null,
      extended: null
    },

    terms: {
      basicTerms: []
    },

    auctionRules: {},

    source: {
      url,
      type: "lyon-auction",
      platform: "lyon-auction",
      scrapedAt:
        new Date().toISOString(),
      updatedAt: "",
      parserVersion:
        "lyon-auction-v2"
    }
  };

  auction = applyAuctionDoctrine({
    auction,
    companyId: "lyon-auction",
    platformId: "native"
  });


  /*
   * Lyon native AOF2 rule fallbacks.
   *
   * Lyon HTML does not publish these standard values.
   * Preserve any populated rule value, otherwise expose
   * the resolved Lyon doctrine through the canonical
   * auctionRules paths consumed by AOF2.
   */
  auction.auctionRules = {
    ...(auction.auctionRules || {}),

    paymentDue: {
      ...(auction.auctionRules?.paymentDue || {}),

      dueRule:
        auction.auctionRules?.paymentDue?.dueRule ||
        auction.terms?.payment?.dueRule ||
        "relative-business-days",

      dueText:
        auction.auctionRules?.paymentDue?.dueText ||
        auction.terms?.payment?.dueText ||
        "Full payment is due within 5 business days from the auction date.",

      relativeBusinessDays:
        auction.auctionRules?.paymentDue?.relativeBusinessDays ??
        5
    },

    removal: {
      ...(auction.auctionRules?.removal || {}),

      deadlineText:
        auction.auctionRules?.removal?.deadlineText ||
        auction.terms?.removal?.deadlineText ||
        "Purchases must be removed within 7 days of the sale date.",

      relativeDays:
        auction.auctionRules?.removal?.relativeDays ??
        auction.terms?.removal?.relativeDays ??
        7,

      storageFeeText:
        auction.auctionRules?.removal?.storageFeeText ||
        auction.terms?.removal?.storageFeeText ||
        "$200/day/item after 7 days.",

      storageFeePerDay:
        auction.auctionRules?.removal?.storageFeePerDay ??
        200,

      storageFeePerItem:
        auction.auctionRules?.removal?.storageFeePerItem ??
        true
    }
  };

  /*
   * Lyon native HTML does not publish these values.
   * Preserve any populated value, otherwise apply the
   * verified Lyon standard-term fallbacks required by AOF2.
   */
  auction.terms = {
    ...(auction.terms || {}),

    payment: {
      ...(auction.terms?.payment || {}),

      dueText:
        auction.terms?.payment?.dueText ||
        "Full payment is due within 5 business days from the auction date.",

      dueRule:
        auction.terms?.payment?.dueRule ||
        "relative-business-days"
    },

    removal: {
      ...(auction.terms?.removal || {}),

      deadlineText:
        auction.terms?.removal?.deadlineText ||
        "Purchases must be removed within 7 days of the sale date.",

      relativeDays:
        auction.terms?.removal?.relativeDays ??
        7,

      storageFeeText:
        auction.terms?.removal?.storageFeeText ||
        "$200/day/item after 7 days."
    }
  };

  return {
    source: {
      type: "lyon-auction",
      label: "Lyon Auction",
      url,
    },

    acquisition: {
      adapter: "lyon-auction",
      method: "static-html"
    },

    machine,
    auction,

    auctionEvent:
      auction.event,

    auctionLot:
      auction.lot,

    auctionTerms:
      auction.terms,

    media: photos,

    confidence: {
      title:
        title
          ? "parsed"
          : "missing",

      description:
        description
          ? "parsed"
          : "missing",

      photos:
        photos.length
          ? "parsed"
          : "missing",

      auction:
        lotNumber ||
        auctionDate ||
        saleLocationText
          ? "parsed"
          : "partial"
    }
  };
}

module.exports = {
  acquire
};
