const cheerio = require("cheerio");

const {
  applyAuctionDoctrine
} = require("../doctrine/applyAuctionDoctrine");

const {
  applyIdentityToParsedListing
} = require("./applyIdentityToParsedListing");

const AUCTIONTIME_HOSTS = new Set([
  "auctiontime.com",
  "www.auctiontime.com"
]);

const PARSER_VERSION =
  "auctiontime-embedded-state-aof2-v1";

function cleanText(value = "") {
  return String(value ?? "")
    .replace(/\\u0022/gi, '"')
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0027/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlText($, value = "") {
  if (!value) return "";

  return cleanText(
    $("<div>")
      .html(String(value))
      .text()
  );
}

const US_STATE_CODES = {
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

function normalizeStateCode(value = "") {
  const normalized =
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();

  if (/^[A-Z]{2}$/.test(normalized)) {
    return normalized;
  }

  return US_STATE_CODES[normalized] || normalized;
}

function firstNonEmpty(...values) {
  for (const value of values.flat(Infinity)) {
    const cleaned = cleanText(value);

    if (cleaned) {
      return cleaned;
    }
  }

  return "";
}

function toNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const normalized = String(value)
    .replace(/[,$%\s]/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();

  if (!normalized) return null;

  const parsed = Number(normalized);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function unique(values = []) {
  return [
    ...new Set(
      values
        .map(value => cleanText(value))
        .filter(Boolean)
    )
  ];
}

function isPlainObject(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function isAuctionTimeUrl(url = "") {
  try {
    return AUCTIONTIME_HOSTS.has(
      new URL(url).hostname.toLowerCase()
    );
  } catch {
    return false;
  }
}

function normalizeUrl(value = "") {
  const input = cleanText(value);

  if (!input) return "";

  try {
    const parsed = new URL(
      input,
      "https://www.auctiontime.com"
    );

    parsed.protocol = "https:";

    return parsed.toString();
  } catch {
    return "";
  }
}

function parseBalancedObject(
  source = "",
  startIndex = -1
) {
  if (
    startIndex < 0 ||
    source[startIndex] !== "{"
  ) {
    return "";
  }

  let depth = 0;
  let quote = "";
  let escaped = false;

  for (
    let index = startIndex;
    index < source.length;
    index += 1
  ) {
    const character = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === quote) {
        quote = "";
      }

      continue;
    }

    if (
      character === '"' ||
      character === "'"
    ) {
      quote = character;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(
          startIndex,
          index + 1
        );
      }
    }
  }

  return "";
}

function parseJsonCandidate(value = "") {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractApplicationState(html = "") {
  const source = String(html || "");

  const markers = [
    "React.createElement(App,",
    "React.createElement(App ,",
    "hydrate(React.createElement(App,",
    'BodyComponent":'
  ];

  for (const marker of markers) {
    let markerIndex = source.indexOf(marker);

    while (markerIndex >= 0) {
      let objectStart = -1;

      if (marker === 'BodyComponent":') {
        objectStart =
          source.lastIndexOf(
            "{",
            markerIndex
          );
      } else {
        objectStart =
          source.indexOf(
            "{",
            markerIndex + marker.length
          );
      }

      if (objectStart >= 0) {
        const candidate =
          parseBalancedObject(
            source,
            objectStart
          );

        const parsed =
          parseJsonCandidate(candidate);

        if (
          parsed &&
          typeof parsed === "object"
        ) {
          return parsed;
        }
      }

      markerIndex = source.indexOf(
        marker,
        markerIndex + marker.length
      );
    }
  }

  return null;
}

function walkObjects(
  value,
  visitor,
  seen = new Set()
) {
  if (
    value === null ||
    value === undefined ||
    typeof value !== "object"
  ) {
    return null;
  }

  if (seen.has(value)) {
    return null;
  }

  seen.add(value);

  const result = visitor(value);

  if (result) {
    return result;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = walkObjects(
        item,
        visitor,
        seen
      );

      if (found) {
        return found;
      }
    }

    return null;
  }

  for (const child of Object.values(value)) {
    const found = walkObjects(
      child,
      visitor,
      seen
    );

    if (found) {
      return found;
    }
  }

  return null;
}

function findObjectWithKey(
  root,
  key
) {
  return walkObjects(
    root,
    value => {
      if (
        isPlainObject(value) &&
        Object.prototype.hasOwnProperty.call(
          value,
          key
        )
      ) {
        return value;
      }

      return null;
    }
  );
}

function findValueByKey(
  root,
  wantedKeys = []
) {
  const wanted = new Set(
    wantedKeys.map(key =>
      String(key).toLowerCase()
    )
  );

  let answer;

  walkObjects(
    root,
    value => {
      if (!isPlainObject(value)) {
        return null;
      }

      for (
        const [key, child] of
        Object.entries(value)
      ) {
        if (
          wanted.has(
            String(key).toLowerCase()
          ) &&
          child !== null &&
          child !== undefined &&
          child !== ""
        ) {
          answer = child;
          return value;
        }
      }

      return null;
    }
  );

  return answer;
}

function findNamedObject(
  root,
  keys = []
) {
  const value = findValueByKey(
    root,
    keys
  );

  return isPlainObject(value)
    ? value
    : null;
}

function flattenSpecs(specGroups = []) {
  const output = {};

  for (const group of specGroups || []) {
    const specs =
      isPlainObject(group?.Specs)
        ? group.Specs
        : {};

    for (
      const [key, spec] of
      Object.entries(specs)
    ) {
      if (isPlainObject(spec)) {
        const value = firstNonEmpty(
          spec.Value,
          spec.ValueUnTranslated
        );

        if (value) {
          output[key] = value;
        }
      } else {
        const value = cleanText(spec);

        if (value) {
          output[key] = value;
        }
      }
    }
  }

  return output;
}

function parseListingId(sourceUrl = "") {
  const match =
    String(sourceUrl).match(
      /\/(\d{6,})(?:\/|$|\?)/i
    );

  return cleanText(match?.[1]);
}

function parseBuyerPremium(
  buyersPremiumData = {},
  termsText = ""
) {
  const premiumRanges =
    Array.isArray(
      buyersPremiumData.PremiumRanges
    )
      ? buyersPremiumData.PremiumRanges
      : [];

  const firstRange =
    premiumRanges[0] || {};

  const ratePercent = toNumber(
    firstNonEmpty(
      firstRange.BuyersPremiumFee,
      buyersPremiumData.BuyersPremiumFee,
      buyersPremiumData.RatePercent
    )
  );

  /*
   * AuctionTime exposes:
   *
   * OverallCap:
   *   Auction/account-level cap.
   *
   * InternetBidderCap:
   *   Cap applicable to the online buyer premium.
   */
  const capAmount = toNumber(
    firstNonEmpty(
      buyersPremiumData.InternetBidderCap,
      buyersPremiumData.CapAmount
    )
  );

  const winningBidRange =
    firstNonEmpty(
      firstRange.WinningBidRange
    );

  const rawText = firstNonEmpty(
    [
      ratePercent !== null
        ? `${ratePercent}% buyer's premium`
        : "",

      capAmount !== null
        ? `capped at USD $${capAmount.toLocaleString("en-US")}`
        : "",

      winningBidRange
        ? `winning bid range ${winningBidRange}`
        : ""
    ]
      .filter(Boolean)
      .join(", "),

    termsText.match(
      /(?:buyer'?s?\s+premium)[^.\n]*/i
    )?.[0]
  );

  let type = "unknown";

  if (
    ratePercent !== null &&
    capAmount !== null
  ) {
    type = "percentage_with_cap";
  } else if (ratePercent !== null) {
    type = "percentage";
  } else if (capAmount !== null) {
    type = "flat";
  }

  return {
    type,
    ratePercent,
    capAmount,
    minimumFee: null,

    tiers:
      ratePercent !== null
        ? [
            {
              minAmount: 0,
              minAmountExclusive: null,
              maxAmount: null,
              ratePercent,
              minimumFee: null,
              flatFee: null,
              rawText
            }
          ]
        : [],

    rawText
  };
}

function parseTermsText(
  root,
  auctionDetails = {}
) {
  const candidate = firstNonEmpty(
    auctionDetails.TermsAndConditions,
    auctionDetails.Terms,
    auctionDetails.TermsText,
    findValueByKey(
      root,
      [
        "TermsAndConditions",
        "TermsAndConditionsText",
        "AuctionTerms",
        "TermsText"
      ]
    )
  );

  if (typeof candidate === "string") {
    return cleanText(candidate);
  }

  if (Array.isArray(candidate)) {
    return cleanText(
      candidate
        .map(item =>
          typeof item === "string"
            ? item
            : JSON.stringify(item)
        )
        .join(" ")
    );
  }

  if (isPlainObject(candidate)) {
    return cleanText(
      firstNonEmpty(
        candidate.Text,
        candidate.DisplayText,
        candidate.Description,
        candidate.RawText,
        JSON.stringify(candidate)
      )
    );
  }

  return "";
}

function parsePayment(termsText = "") {
  const deadlineText = firstNonEmpty(
    termsText.match(
      /(?:payment|invoice)[^.]{0,180}(?:48\s+hours|two\s+business\s+days|2\s+business\s+days)[^.]*/i
    )?.[0]
  );

  const methods = [];

  if (/wire transfer/i.test(termsText)) {
    methods.push("Wire transfer");
  }

  if (/cashier'?s check/i.test(termsText)) {
    methods.push("Cashier's check");
  }

  if (/credit card/i.test(termsText)) {
    methods.push("Credit card");
  }

  return {
    dueText: deadlineText,
    deadline: "",
    methods,
    instructions: deadlineText,
    rawText: deadlineText
  };
}

function parseRemoval(termsText = "") {
  const rawText = firstNonEmpty(
    termsText.match(
      /(?:removal|remove|pickup|pick up)[^.]{0,260}(?:business\s+days|days|hours)[^.]*/i
    )?.[0]
  );

  const deadlineText = firstNonEmpty(
    rawText.match(
      /(?:within|no later than)[^.]{0,80}(?:business\s+days|days)/i
    )?.[0],
    rawText
  );

  const noticeRequiredHours =
    toNumber(
      termsText.match(
        /(\d+)\s*(?:hour|hours)[^.]{0,80}(?:notice|appointment)/i
      )?.[1]
    );

  return {
    deadlineText,
    deadline: "",
    noticeRequiredHours,
    appointmentRequired:
      /appointment|required notice/i.test(
        rawText
      )
        ? true
        : null,
    instructions: rawText,
    rawText
  };
}

function parseInspection(termsText = "") {
  const rawText = firstNonEmpty(
    termsText.match(
      /(?:inspection|inspect)[^.]{0,260}\./i
    )?.[0]
  );

  return {
    available:
      rawText
        ? true
        : null,
    appointmentRequired:
      /appointment/i.test(rawText)
        ? true
        : null,
    instructions: rawText,
    rawText
  };
}

function createConfidence({
  machine,
  auctionEvent,
  auctionLot,
  media
}) {
  const checks = [
    machine.year,
    machine.make,
    machine.model,
    machine.category,
    machine.serialNumber,
    auctionEvent.name,
    auctionLot.number,
    auctionLot.scheduledCloseAt,
    media.photos.length
  ];

  const present = checks.filter(
    value =>
      value !== null &&
      value !== undefined &&
      value !== "" &&
      value !== 0
  ).length;

  return {
    score:
      Math.round(
        (present / checks.length) * 100
      ),
    level:
      present >= 7
        ? "high"
        : present >= 4
          ? "medium"
          : "low"
  };
}

function parseAuctionTimeHtml({
  html = "",
  sourceUrl = ""
} = {}) {
  const $ = cheerio.load(
    String(html || "")
  );

  const applicationState =
    extractApplicationState(html);

  if (!applicationState) {
    return {
      ok: false,
      source: {
        type: "auctiontime",
        label: "AuctionTime",
        platform: "auctiontime",
        url: sourceUrl
      },
      acquisition: {
        adapter: "auctiontime",
        method:
          "captured-html-parser",
        saleType: "auction",
        parserVersion: PARSER_VERSION
      },
      error:
        "AuctionTime embedded application state was not found."
    };
  }

  const props =
    applicationState
      ?.BodyComponent
      ?.Props ||
    findNamedObject(
      applicationState,
      ["Props"]
    ) ||
    applicationState;

  const auctionDetails =
    findNamedObject(
      props,
      [
        "AuctionDetails",
        "AuctionDetail",
        "AuctionInfo"
      ]
    ) || {};

  const auctionBiddingData =
    isPlainObject(
      auctionDetails.AuctionBiddingData
    )
      ? auctionDetails.AuctionBiddingData
      : {};

  const buyersPremiumData =
    isPlainObject(
      auctionDetails.BuyersPremiumData
    )
      ? auctionDetails.BuyersPremiumData
      : {};

  const mediaModel =
    findNamedObject(
      props,
      [
        "MediaModel",
        "ListingMediaModel"
      ]
    ) || {};

  const contactInfo =
    findNamedObject(
      props,
      [
        "ContactInfo",
        "Seller",
        "SellerInfo"
      ]
    ) || {};

  const categoryInformation =
    findNamedObject(
      props,
      [
        "CategoryInformation"
      ]
    ) || {};

  const specGroups =
    findValueByKey(
      props,
      ["Specs"]
    );

  const specs = flattenSpecs(
    Array.isArray(specGroups)
      ? specGroups
      : []
  );

  const visibleText = cleanText(
    $("body").text()
  );

  const listingTitle = firstNonEmpty(
    findValueByKey(
      props,
      [
        "DisplayedListingTitle",
        "ListingTitle",
        "Subject",
        "PageHeader"
      ]
    ),
    $("title").text()
  );

  const year = firstNonEmpty(
    specs.Year,
    findValueByKey(
      props,
      ["Year"]
    ),
    listingTitle.match(
      /\b((?:19|20)\d{2})\b/
    )?.[1]
  );

  const make = decodeHtmlText(
    $,
    firstNonEmpty(
      findValueByKey(
        props,
        [
          "Manufacturer",
          "ListingManufacturer",
          "Make"
        ]
      ),
      specs.Manufacturer
    )
  );

  const model = decodeHtmlText(
    $,
    firstNonEmpty(
      findValueByKey(
        props,
        [
          "Model",
          "ListingModel"
        ]
      ),
      specs.Model
    )
  );

  const sourceCategory = decodeHtmlText(
    $,
    firstNonEmpty(
      categoryInformation.DisplayCategoryName,
      categoryInformation.CategoryName,
      categoryInformation.RouteCategoryName,
      findValueByKey(
        props,
        [
          "DisplayCategoryName",
          "CategoryName"
        ]
      )
    )
  );

  const description = decodeHtmlText(
    $,
    firstNonEmpty(
      findValueByKey(
        props,
        [
          "Description"
        ]
      ),
      specs.Description
    )
  );

  const serialNumber = firstNonEmpty(
    specs.SerialNumber,
    findValueByKey(
      props,
      [
        "SerialNumber",
        "VIN"
      ]
    )
  );

  const stockNumber = firstNonEmpty(
    specs.StockNumber,
    findValueByKey(
      props,
      ["StockNumber"]
    )
  );

  const hours = toNumber(
    firstNonEmpty(
      specs.Hours,
      findValueByKey(
        props,
        ["Hours"]
      )
    )
  );

  const condition = firstNonEmpty(
    specs.Condition,
    findValueByKey(
      props,
      [
        "Condition",
        "ListingCondition"
      ]
    )
  );

  const identity =
    applyIdentityToParsedListing({
      title: listingTitle,
      year,
      make,
      model,
      parserCategory:
        sourceCategory,
      sourceCategory,
      description,
      visibleText,
      url: sourceUrl,
      source: "auctiontime"
    });

  const locationObject =
    contactInfo.ListingLocation ||
    findNamedObject(
      props,
      [
        "ListingLocation",
        "MachineLocation"
      ]
    ) ||
    {};

  const machineLocation =
    firstNonEmpty(
      locationObject.FormattedLocation,
      locationObject.ShortLocation,
      locationObject.FullAddress,
      findValueByKey(
        props,
        [
          "MachineLocation",
          "ListingLocationText"
        ]
      )
    );

  const machineLocationData = {
    label: machineLocation,
    raw: machineLocation,
    display: machineLocation,

    city:
      firstNonEmpty(
        locationObject.City
      ),

    state:
      firstNonEmpty(
        locationObject.State
      ),

    stateCode:
      firstNonEmpty(
        locationObject.StateCode,
        locationObject.State
      ),

    country:
      firstNonEmpty(
        locationObject.Country
      ),

    countryCode:
      /^(?:usa|united states)$/i.test(
        firstNonEmpty(
          locationObject.Country
        )
      )
        ? "US"
        : firstNonEmpty(
            locationObject.CountryCode
          ),

    address:
      firstNonEmpty(
        locationObject.FullAddress
      ),

    postalCode:
      firstNonEmpty(
        locationObject.PostalCode
      )
  };

  const machine = {
    year:
      firstNonEmpty(
        identity.year,
        year
      ),

    make:
      firstNonEmpty(
        identity.make,
        make
      ),

    model:
      firstNonEmpty(
        identity.model,
        model
      ),

    category:
      firstNonEmpty(
        identity.category,
        sourceCategory
      ),

    sourceCategory,

    hours,

    serialNumber,
    stockNumber,
    condition,
    description,

    location: {
      display: machineLocation,
      city:
        firstNonEmpty(
          locationObject.City
        ),
      state:
        normalizeStateCode(
          firstNonEmpty(
            locationObject.State
          )
        ),
      postalCode:
        firstNonEmpty(
          locationObject.PostalCode
        ),
      country:
        firstNonEmpty(
          locationObject.Country
        )
    },

    city:
      firstNonEmpty(
        locationObject.City
      ),

    state:
      normalizeStateCode(
        firstNonEmpty(
          locationObject.State
        )
      ),

    identityResolution:
      identity.identityResolution ||
      null
  };

  const rawMedia =
    Array.isArray(mediaModel.Media)
      ? mediaModel.Media
      : [];

  const photos = unique(
    rawMedia
      .filter(item =>
        Number(item?.MediaType) === 0 ||
        /image/i.test(
          String(
            item?.MediaTypeName || ""
          )
        )
      )
      .map(item =>
        normalizeUrl(
          item?.FullScreenUrl
        )
      )
  );

  const videos = unique(
    rawMedia
      .filter(item =>
        Number(item?.MediaType) !== 0 &&
        /video/i.test(
          String(
            item?.MediaTypeName || ""
          )
        )
      )
      .map(item =>
        normalizeUrl(
          firstNonEmpty(
            item?.FullScreenUrl,
            item?.MediaUrl,
            item?.Url
          )
        )
      )
  );

  const mediaSummary = {
    photos,
    photoCount: photos.length,
    primaryPhoto:
      photos[0] || "",
    videos,
    videoCount: videos.length
  };

  const listingId = firstNonEmpty(
    findValueByKey(
      props,
      ["ListingID", "ListingId"]
    ),
    parseListingId(sourceUrl)
  );

  const eventId = firstNonEmpty(
    auctionBiddingData.EventID,
    auctionBiddingData.EventId,

    auctionDetails
      ?.BiddingSearchModel
      ?.AuctionTimeModels
      ?.[0]
      ?.EventID,

    auctionDetails.AuctionID,
    auctionDetails.AuctionId,

    auctionDetails.EventID,
    auctionDetails.EventId
  );

  const eventName = firstNonEmpty(
    auctionDetails.AuctionGroupName,
    auctionDetails.EventName,
    auctionDetails.AuctionName,
    findValueByKey(
      props,
      [
        "AuctionGroupName",
        "EventName"
      ]
    )
  );

  const lotNumber = firstNonEmpty(
    auctionDetails.LotNumber,
    auctionDetails.LotNo,
    findValueByKey(
      props,
      [
        "LotNumber",
        "LotNo"
      ]
    )
  );

  const currentBid = toNumber(
    firstNonEmpty(
      auctionBiddingData.CurrentBid,
      auctionDetails.CurrentBid,
      auctionDetails.HighBid,
      auctionDetails.CurrentPrice
    )
  );

  const openingBid = toNumber(
    firstNonEmpty(
      auctionBiddingData.StartingBid,
      auctionDetails.StartingBid,
      auctionDetails.OpeningBid,
      auctionDetails.MinimumBid
    )
  );

  const bidCount = toNumber(
    firstNonEmpty(
      auctionBiddingData.NumberOfBids,
      auctionDetails.NumberOfBids,
      auctionDetails.BidCount,
      auctionDetails.TotalBids
    )
  );

  const bidIncrement = toNumber(
    firstNonEmpty(
      auctionBiddingData.Increment,
      auctionDetails.BidIncrement,
      auctionDetails.CurrentBidIncrement,
      auctionDetails.Increment
    )
  );

  const scheduledCloseAt =
    firstNonEmpty(
      auctionBiddingData.ProjectedEndDateTime,
      auctionDetails.ProjectedEndDateTime,
      auctionDetails.WebEndDateTime,
      auctionDetails.EndDateTime,
      auctionDetails.ScheduledCloseAt,
      auctionDetails.CloseDateTime
    );

  const startsAt = firstNonEmpty(
    auctionDetails.AuctionDate,
    auctionDetails.StartDateTime,
    auctionDetails.StartsAt
  );

  const sourceTimezone =
    firstNonEmpty(
      auctionDetails.TimeZoneAbbreviation,
      auctionDetails.TimeZone,
      auctionDetails.Timezone,
      findValueByKey(
        props,
        [
          "TimeZoneAbbreviation",
          "TimeZone"
        ]
      )
    );

  const currency = firstNonEmpty(
    auctionBiddingData.CurrencyCode,
    buyersPremiumData.CurrencyCode,
    auctionDetails.Currency,
    auctionDetails.CurrencyCode,
    findValueByKey(
      props,
      [
        "DefaultCurrencyCode",
        "CurrencyCode"
      ]
    ),
    "USD"
  );

  const companyName = firstNonEmpty(
    auctionDetails.AuctioneerName,
    auctionDetails.AuctionCompanyName,
    auctionDetails.SellerName,
    contactInfo.CompanyName,
    contactInfo.ParentAccountName
  );

  const companyId = firstNonEmpty(
    auctionDetails.AuctioneerID,
    auctionDetails.AuctioneerId,
    auctionDetails.DealerID,
    auctionDetails.DealerId,
    contactInfo.CRMID,
    contactInfo.SettingsCRMID
  );

  const termsText =
    parseTermsText(
      props,
      auctionDetails
    );

  const buyerPremium =
    parseBuyerPremium(
      buyersPremiumData,
      termsText
    );

  const paymentDue =
    parsePayment(termsText);

  const removal =
    parseRemoval(termsText);

  const inspection =
    parseInspection(termsText);

  const tax = {
    taxable: null,
    basis: "",
    ratePercent: null,
    exemptionAllowed: null,
    exemptionCertificateRequired: null,
    instructions: "",
    rawText: ""
  };

  /*
   * AuctionTime event doctrine:
   *
   * AuctionTime listings belong to the recurring nationwide
   * Weekly Auction. The individual machine closing timestamp
   * belongs to the lot, not to the event schedule.
   */
  const auctionEventDate = scheduledCloseAt
    ? new Intl.DateTimeFormat(
        "en-US",
        {
          weekday: "long",
          month: "long",
          day: "numeric",
          timeZone: "America/Chicago"
        }
      ).format(
        new Date(scheduledCloseAt)
      )
    : "";

  const auctionEvent = {
    id: eventId,

    name: "Weekly Auction",
    eventName: "Weekly Auction",
    eventTitle: "Weekly Auction",

    company: "AuctionTime",
    companyName: "AuctionTime",
    companyId: "auctiontime",

    format: "Timed Online",
    auctionType: "Timed Online",

    participation: "Online",

    scope: "Nationwide",
    location: {
      raw: "Nationwide Event",
      display: "Nationwide Event",
      label: "Nationwide Event",
      city: "",
      state: "",
      stateCode: "",
      country: "US",
      countryCode: "US",
      address: "",
      postalCode: ""
    },

    date: auctionEventDate,
    dateText: auctionEventDate,
    saleDateText: auctionEventDate,

    time: "",
    timeText: "",
    saleTimeText: "",

    timezone: sourceTimezone,

    /*
     * Do not promote lot close time into the event schedule.
     */
    startsAt: "",
    endsAt: "",

    terms: termsText
      ? {
          rawText: termsText
        }
      : null
  };

  const auctionLot = {
    id: listingId,
    number: lotNumber,
    status: firstNonEmpty(
      auctionDetails.Status,
      auctionDetails.AuctionStatus
    ),

    openingBid,
    currentBid,
    bidCount,
    bidIncrement,
    currency,

    scheduledCloseAt,
    sourceTimezone,

    machineLocation:
      machineLocationData
  };

  const auctionTerms = {
    buyerPremium,
    tax,
    payment: paymentDue,
    paymentDue,
    removal,
    inspection,

    condition: {
      asIsWhereIs:
        /as[\s-]+is[\s,/-]+where[\s-]+is/i.test(
          termsText
        )
          ? true
          : null,
      rawText:
        firstNonEmpty(
          termsText.match(
            /as[\s-]+is[\s,/-]+where[\s-]+is/i
          )?.[0]
        )
    },

    rawText: termsText
  };

  let auction = {
    version: "aof2",

    company: {
      id: "auctiontime",
      name: "AuctionTime",
      platform: "auctiontime"
    },

    event: auctionEvent,
    lot: auctionLot,

    timing: {
      timezone: sourceTimezone,
      startsAt,
      endsAt: scheduledCloseAt,
      scheduledCloseAt,
      actualCloseAt: "",
      updatedAt: ""
    },

    status: {
      value: auctionLot.status,
      live: null,
      closed: null,
      pending: null,
      sold: null,
      extended: null
    },

    auctionRules: {
      buyerPremium,
      tax,
      paymentDue,
      removal,
      inspection
    },

    buyerPremium,
    tax,
    paymentDue,
    removal,
    inspection,

    terms: auctionTerms,

    source: {
      url: sourceUrl,
      type: "auctiontime",
      platform: "auctiontime",
      scrapedAt: "",
      updatedAt: "",
      parserVersion: PARSER_VERSION
    }
  };

  auction = applyAuctionDoctrine({
    auction,
    companyId:
      companyId ||
      companyName ||
      "auctiontime",
    platformId: "auctiontime"
  });

  const sale = {
    type: "auction",
    format:
      auctionEvent.format,
    currentBid,
    openingBid,
    currency
  };

  const launchPolicy = {
    saleType: "auction",
    visibility: "public",
    auction: true,
    requiresAuctionFacts: true
  };

  const confidence =
    createConfidence({
      machine,
      auctionEvent,
      auctionLot,
      media: mediaSummary
    });

  console.log(
    "AUCTIONTIME PARSER:",
    JSON.stringify(
      {
        listingId,
        eventId,
        lotNumber,
        make: machine.make,
        model: machine.model,
        category: machine.category,
        photos: photos.length,
        currentBid,
        openingBid,
        buyerPremium
      },
      null,
      2
    )
  );

  return {
    ok: true,

    source: {
      type: "auctiontime",
      label: "AuctionTime",
      platform: "auctiontime",
      url: sourceUrl
    },

    acquisition: {
      adapter: "auctiontime",
      method:
        "captured-html-parser",
      saleType: "auction",
      parserVersion: PARSER_VERSION
    },

    sale,
    machine,
    media: photos,

    auction,

    auctionEvent,
    auctionLot,

    auctionTerms:
      auction.terms ||
      auctionTerms,

    launchPolicy,
    confidence
  };
}

module.exports = {
  parseAuctionTimeHtml,
  isAuctionTimeUrl
};
