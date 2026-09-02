const {
  captureRenderedHtml
} = require("../capture/ixiCaptureGateway");

const termsPageCache = new Map();

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
  WYOMING: "WY",
  "DISTRICT OF COLUMBIA": "DC"
};

const VALID_STATE_CODES =
  new Set(Object.values(US_STATE_CODES));

function clean(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeStateCode(value = "") {
  const normalized =
    clean(value)
      .replace(/\./g, "")
      .toUpperCase();

  if (!normalized) {
    return "";
  }

  if (VALID_STATE_CODES.has(normalized)) {
    return normalized;
  }

  return US_STATE_CODES[normalized] || normalized;
}

function htmlToText(html = "") {
  return clean(
    String(html || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
  );
}

function normalizeLocation(result = {}) {
  const machine =
    result.machine || {};

  const rawState =
    machine.state ||
    result.location?.state ||
    result.auction?.event?.location?.state ||
    result.auctionEvent?.location?.state ||
    "";

  const stateCode =
    normalizeStateCode(rawState);

  if (stateCode) {
    machine.state = stateCode;
  }

  const city =
    clean(
      machine.city ||
      result.location?.city ||
      result.auction?.event?.location?.city ||
      result.auctionEvent?.location?.city ||
      ""
    );

  const eventLocation =
    result.auction?.event?.location ||
    result.auctionEvent?.location ||
    "";

  const eventLocationLabel =
    typeof eventLocation === "string"
      ? clean(eventLocation)
      : clean(
          eventLocation?.label ||
          eventLocation?.display ||
          eventLocation?.raw ||
          ""
        );

  const machineLocationLabel =
    typeof machine.location === "string"
      ? clean(machine.location)
      : clean(
          machine.location?.label ||
          machine.location?.display ||
          machine.location?.raw ||
          ""
        );

  const display =
    city && stateCode
      ? `${city.toUpperCase()}, ${stateCode}`
      : (
          eventLocationLabel ||
          machineLocationLabel
        );

  result.machine = machine;

  const locationObject = {
    raw:
      eventLocationLabel ||
      machineLocationLabel ||
      clean(
        [city, rawState]
          .filter(Boolean)
          .join(", ")
      ),

    city,
    stateCode,
    countryCode: "US",
    display
  };

  if (result.auction?.event) {
    result.auction.event.location =
      locationObject;
  }

  if (result.auctionEvent) {
    result.auctionEvent.location =
      locationObject;
  }

  return locationObject;
}

function getAuctionTerms(result = {}) {
  return (
    result.auction?.terms ||
    result.auctionTerms ||
    result.auctionEvent?.terms ||
    {}
  );
}

function getTermsLinks(terms = {}) {
  return unique(
    Array.isArray(terms.termsLinks)
      ? terms.termsLinks
          .map(link => {
            if (typeof link === "string") {
              return clean(link);
            }

            return clean(
              link?.url ||
              link?.href ||
              ""
            );
          })
      : []
  );
}

function rankTermsUrl(url = "") {
  const value =
    clean(url).toLowerCase();

  let score = 0;

  if (
    /\/pop\/terms_page\.jsp(?:$|\?)/.test(value)
  ) {
    score += 100;
  }

  if (/terms|conditions/.test(value)) {
    score += 30;
  }

  if (/noh1=yes/.test(value)) {
    score -= 5;
  }

  if (/privacy/.test(value)) {
    score -= 100;
  }

  if (/buyer-faq|shipping|financing/.test(value)) {
    score -= 40;
  }

  if (/#/.test(value)) {
    score -= 20;
  }

  return score;
}

function selectTermsUrl(terms = {}) {
  return getTermsLinks(terms)
    .map(url => ({
      url,
      score: rankTermsUrl(url)
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]
    ?.url || "";
}

async function captureTermsText(url = "") {
  if (!url) {
    return "";
  }

  if (termsPageCache.has(url)) {
    return termsPageCache.get(url);
  }

  try {
    const capture =
      await captureRenderedHtml({
        url,
        provider: "firecrawl"
      });

    const text =
      htmlToText(capture?.html || "");

    termsPageCache.set(url, text);

    return text;
  } catch (error) {
    console.warn(
      "AUCTION TERMS ENRICHMENT FAILED:",
      url,
      error?.message || error
    );

    termsPageCache.set(url, "");

    return "";
  }
}

function collectExistingTermsText(terms = {}) {
  return clean(
    [
      terms.participationRequirements,
      terms.specialTerms,
      terms.fullTermsText,
      terms.rawText,
      terms.termsText,
      terms.payment?.rawText,
      terms.removal?.rawText,
      terms.shipping?.rawText,
      terms.condition?.rawText
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function addBasicTerm(
  target,
  {
    code,
    label,
    evidence = "",
    sourceUrl = ""
  }
) {
  if (
    target.some(
      item => item.code === code
    )
  ) {
    return;
  }

  target.push({
    code,
    label,
    confirmed: true,
    evidence: clean(evidence),
    sourceUrl: clean(sourceUrl)
  });
}

function buildBasicTerms({
  terms = {},
  listingText = "",
  legalText = "",
  legalSourceUrl = ""
} = {}) {
  const basicTerms = [];

  addBasicTerm(
    basicTerms,
    {
      code: "as_is_where_is",
      label: "AS IS, WHERE IS",
      evidence: "IXI STANDARD AUCTION CONDITION",
      sourceUrl: ""
    }
  );

  const combinedText =
    clean(
      [
        listingText,
        legalText
      ]
        .filter(Boolean)
        .join(" ")
    );

  const biddingRules =
    terms.biddingRules || {};

  const removal =
    terms.removal || {};

  const condition =
    terms.condition || {};

  const asIsEvidence =
    combinedText.match(
      /\bAS[\s-]*IS[\s,;:/-]*(?:AND\s+)?WHERE[\s-]*IS\b/i
    )?.[0] ||
    combinedText.match(
      /\bSOLD[\s\S]{0,80}\bAS[\s-]*IS\b[\s\S]{0,80}\bWHERE[\s-]*IS\b/i
    )?.[0] ||
    "";

  if (
    condition.asIsWhereIs === true ||
    condition.asIs === true ||
    asIsEvidence
  ) {
    addBasicTerm(
      basicTerms,
      {
        code: "as_is_where_is",
        label: "AS IS, WHERE IS",
        evidence:
          condition.rawText ||
          asIsEvidence,
        sourceUrl:
          asIsEvidence &&
          legalText.includes(asIsEvidence)
            ? legalSourceUrl
            : ""
      }
    );
  }

  const bindingEvidence =
    combinedText.match(
      /\b(?:ALL\s+)?BIDS?[\s\S]{0,80}\bBINDING\b/i
    )?.[0] ||
    combinedText.match(
      /\bBINDING[\s\S]{0,40}\bBID\b/i
    )?.[0] ||
    "";

  if (
    Number.isFinite(
      Number(
        biddingRules
          .bindingUntilBusinessDaysAfterAuction
      )
    ) ||
    biddingRules.binding === true ||
    bindingEvidence
  ) {
    addBasicTerm(
      basicTerms,
      {
        code: "binding_bid",
        label: "ALL BIDS ARE BINDING",
        evidence:
          terms.participationRequirements ||
          terms.specialTerms ||
          bindingEvidence
      }
    );
  }

  const nonRetractableEvidence =
    combinedText.match(
      /\bBIDS?[\s\S]{0,40}\bCANNOT\s+BE\s+RETRACTED\b/i
    )?.[0] ||
    combinedText.match(
      /\bBIDS?[\s\S]{0,30}\bIRREVOCABLE\b/i
    )?.[0] ||
    "";

  if (
    biddingRules.bidsRetractable === false ||
    nonRetractableEvidence
  ) {
    addBasicTerm(
      basicTerms,
      {
        code: "bid_not_retractable",
        label: "BIDS CANNOT BE RETRACTED",
        evidence:
          terms.participationRequirements ||
          terms.specialTerms ||
          nonRetractableEvidence
      }
    );
  }

  const finalSaleEvidence =
    combinedText.match(
      /\bALL\s+SALES?\s+(?:ARE\s+)?FINAL\b/i
    )?.[0] ||
    combinedText.match(
      /\bFINAL\s+SALE\b/i
    )?.[0] ||
    "";

  if (
    terms.allSalesFinal === true ||
    finalSaleEvidence
  ) {
    addBasicTerm(
      basicTerms,
      {
        code: "all_sales_final",
        label: "ALL SALES FINAL",
        evidence: finalSaleEvidence
      }
    );
  }

  const buyerRemovalEvidence =
    combinedText.match(
      /\bBUYER[\s\S]{0,100}\bRESPONSIBLE[\s\S]{0,100}\b(?:REMOVAL|TRANSPORT|SHIPPING|PICKUP)\b/i
    )?.[0] ||
    "";

  if (
    removal.removalAtBuyerExpense === true ||
    removal.buyerResponsibleForShipping === true ||
    terms.shipping?.buyerResponsible === true ||
    buyerRemovalEvidence
  ) {
    addBasicTerm(
      basicTerms,
      {
        code:
          "buyer_responsible_for_removal",
        label:
          "BUYER RESPONSIBLE FOR REMOVAL",
        evidence:
          removal.rawText ||
          removal.instructions ||
          buyerRemovalEvidence
      }
    );
  }

  return basicTerms;
}

function applyTermsEverywhere(
  result,
  auctionTerms
) {
  result.auctionTerms =
    auctionTerms;

  if (result.auction) {
    result.auction.terms =
      auctionTerms;
  }

  if (result.auctionEvent) {
    result.auctionEvent.terms =
      auctionTerms;
  }

  if (result.auctionObject) {
    result.auctionObject.terms =
      auctionTerms;
  }
}

function normalizeSource(result = {}) {
  const sourceUrl =
    clean(
      result.source?.url ||
      result.machine?.url ||
      result.auction?.source?.listingUrl ||
      result.auction?.source?.url ||
      result.auctionLot?.sourceUrl ||
      ""
    );

  const sourceLabel =
    clean(
      result.source?.label ||
      result.source?.platform ||
      result.machine?.sourceName ||
      result.machine?.source ||
      ""
    );

  result.source = {
    ...(result.source || {}),
    url: sourceUrl
  };

  if (result.auction) {
    result.auction.source = {
      ...(result.auction.source || {}),
      provider:
        clean(
          result.auction.source?.provider ||
          result.source?.type ||
          result.source?.platform ||
          ""
        ),

      providerName:
        clean(
          result.auction.source?.providerName ||
          sourceLabel
        ),

      listingUrl: sourceUrl
    };
  }

  return {
    listingUrl: sourceUrl,
    providerName: sourceLabel
  };
}


const NATIONWIDE_EVENT_PROVIDERS = new Set([
  "ironplanet",
  "bidadoo",
  "copart",
  "purple wave",
  "purplewave",
  "auctiontime",
  "auction time"
]);

function normalizeProviderKey(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isNationwideEventProvider(result = {}) {
  const candidates = [
    result.source?.type,
    result.source?.label,
    result.source?.platform,
    result.machine?.source,
    result.machine?.sourceName,
    result.auction?.source?.provider,
    result.auction?.source?.providerName
  ]
    .map(normalizeProviderKey)
    .filter(Boolean);

  return candidates.some(candidate =>
    NATIONWIDE_EVENT_PROVIDERS.has(candidate)
  );
}

function hasRealEventLocation(event = {}) {
  const location = event?.location;

  if (!location) {
    return false;
  }

  if (typeof location === "string") {
    const value = clean(location);

    return (
      value &&
      !/NOT AVAILABLE|UNKNOWN|NATIONWIDE EVENT/i.test(value)
    );
  }

  const display = clean(location.display);
  const city = clean(location.city);

  return (
    city ||
    (
      display &&
      !/NOT AVAILABLE|UNKNOWN|NATIONWIDE EVENT/i.test(display)
    )
  );
}


function normalizeAuctionEventLocation(result = {}) {
  const event =
    result.auction?.event ||
    result.auctionEvent;

  if (!event) {
    return;
  }

  if (!isNationwideEventProvider(result)) {
    return;
  }

  const machine =
    result.machine || {};

  const machineCity =
    clean(machine.city)
      .toUpperCase();

  const machineState =
    normalizeStateCode(machine.state);

  const location =
    event.location || {};

  const eventCity =
    clean(
      typeof location === "object"
        ? location.city
        : ""
    )
      .toUpperCase();

  const eventState =
    normalizeStateCode(
      typeof location === "object"
        ? (
            location.state ||
            location.stateCode
          )
        : ""
    );

  const eventLabel =
    clean(
      typeof location === "string"
        ? location
        : (
            location.label ||
            location.display
          )
    )
      .toUpperCase();

  const machineLabel =
    clean(
      [
        machineCity,
        machineState
      ]
        .filter(Boolean)
        .join(", ")
    )
      .toUpperCase();

  const eventMatchesMachine =
    !!(
      machineCity &&
      machineState &&
      eventCity === machineCity &&
      eventState === machineState
    ) ||
    !!(
      machineLabel &&
      eventLabel === machineLabel
    );

  const realEventLocation =
    hasRealEventLocation(event);

  if (
    realEventLocation &&
    !eventMatchesMachine
  ) {
    return;
  }

  event.scope = "nationwide";

  event.location = {
    type: "nationwide",
    scope: "nationwide",
    label: "NATIONWIDE EVENT",
    display: "NATIONWIDE EVENT",
    city: "",
    state: "",
    stateCode: "",
    country: "US",
    countryCode: "US",
    address: "",
    postalCode: ""
  };

  if (result.auction?.event) {
    result.auction.event = event;
  }

  if (result.auctionEvent) {
    result.auctionEvent = event;
  }
}


async function normalizeAuctionContract(
  result = {}
) {
  if (
    !result ||
    typeof result !== "object"
  ) {
    return result;
  }

  const hasAuctionData =
    !!(
      result.auction ||
      result.auctionEvent ||
      result.auctionLot ||
      result.auctionTerms ||
      result.launchPolicy?.placement === "AUCT" ||
      result.launchPolicy?.auction === true
    );

  if (!hasAuctionData) {
    return result;
  }


normalizeSource(result);
normalizeLocation(result);
normalizeAuctionEventLocation(result);

  const terms =
    getAuctionTerms(result);

  const listingText =
    collectExistingTermsText(terms);

  let legalText = "";
  let legalSourceUrl = "";

  const initialBasicTerms =
    buildBasicTerms({
      terms,
      listingText
    });

  const hasAsIsWhereIs =
    initialBasicTerms.some(
      item =>
        item.code ===
        "as_is_where_is"
    );

  if (!hasAsIsWhereIs) {
    legalSourceUrl =
      selectTermsUrl(terms);

    if (legalSourceUrl) {
      legalText =
        await captureTermsText(
          legalSourceUrl
        );
    }
  }

  const basicTerms =
    buildBasicTerms({
      terms,
      listingText,
      legalText,
      legalSourceUrl
    });

  const normalizedTerms = {
    ...terms,

    basicTerms,

    legalTermsSource: {
      url: legalSourceUrl,
      enriched:
        !!legalText
    }
  };

  applyTermsEverywhere(
    result,
    normalizedTerms
  );

  return result;
}

module.exports = {
  normalizeAuctionContract,
  normalizeStateCode
};
