/**
 * Ritchie Bros. auction adapter.
 *
 * Source of truth:
 *   __NEXT_DATA__.props.pageProps.data.results.records[0]
 *   __NEXT_DATA__.props.pageProps.items[0].item.listing
 *
 * This adapter transports only defined IXI auction facts.
 * It does not transport RB workflow states or infer machine condition.
 */

function clean(value = "") {
  return String(value ?? "")
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

function toNumber(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : null;
  }

  const normalized = String(value)
    .replace(/[$,\s]/g, "")
    .trim();

  if (!normalized) {
    return null;
  }

  const number = Number(normalized);

  return Number.isFinite(number)
    ? number
    : null;
}

function toIso(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return "";
  }

  let candidate = value;

  if (typeof candidate === "number") {
    /*
     * RB numeric timestamps are milliseconds.
     * This also safely handles second timestamps if RB changes shape.
     */
    if (candidate > 0 && candidate < 100000000000) {
      candidate *= 1000;
    }
  }

  const date = new Date(candidate);

  return Number.isNaN(date.getTime())
    ? ""
    : date.toISOString();
}

function extractNextData(html = "") {
  const source = String(html || "");

  /*
   * Allows direct testing with the extracted JSON file as well as
   * normal production parsing from rendered HTML.
   */
  const trimmed = source.trim();

  if (
    trimmed.startsWith("{") &&
    trimmed.endsWith("}")
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Continue to HTML extraction.
    }
  }

  const match = source.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );

  if (!match?.[1]) {
    return null;
  }

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function getRbObjects(root = {}) {
  const pageProps =
    root?.props?.pageProps || {};

  const record =
    pageProps?.data?.results?.records?.[0] ||
    {};

  const itemWrapper =
    pageProps?.items?.[0] ||
    {};

  const item =
    itemWrapper?.item ||
    itemWrapper ||
    {};

  const listing =
    item?.listing ||
    {};

  const storageLocation =
    item?.asset_storage_location ||
    {};

  const yard =
    pageProps?.yard ||
    {};

  return {
    pageProps,
    record,
    item,
    listing,
    storageLocation,
    yard
  };
}

function sourceItemIdFromUrl(sourceUrl = "") {
  const match = String(sourceUrl || "").match(
    /\/(\d+)(?:[/?#]|$)/
  );

  return match?.[1] || "";
}

function normalizeAuctionType({
  record = {},
  listing = {}
} = {}) {
  /*
   * RB's buying_format may say "Live Auction" even when the
   * buyer-facing format is "Timed Auction".
   *
   * buyingFormatFacetLabel and TAL are the verified buyer-facing
   * source facts for the test listing.
   */
  const label = firstClean(
    record.buyingFormatFacetLabel,
    record.buying_format_facet_label
  );

  const formatCode = firstClean(
    listing.sale_format_id,
    record.saleFormatId,
    record.sale_format_id
  ).toUpperCase();

  if (
    /timed/i.test(label) ||
    formatCode === "TAL"
  ) {
    return "timed";
  }

  if (/hybrid/i.test(label)) {
    return "hybrid";
  }

  if (/live/i.test(label)) {
    return "live";
  }

  if (/online/i.test(label)) {
    return "online";
  }

  return "";
}

function eventDateText({
  record = {},
  listing = {}
} = {}) {
  const advertisedName = firstClean(
    record.eventAdvertisedName,
    record.saleEventName
  );

  const dateFromName = advertisedName.match(
    /\s-\s([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})\s*$/
  );

  if (dateFromName?.[1]) {
    return clean(dateFromName[1]);
  }

  const iso = firstClean(
    toIso(record.dateOfEvent),
    toIso(record.eventStartDate),
    toIso(listing.date_of_event)
  );

  if (!iso) {
    return "";
  }

  const date = new Date(iso);

  return new Intl.DateTimeFormat(
    "en-US",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC"
    }
  ).format(date);
}

function buildEventLocation({
  record = {},
  storageLocation = {},
  yard = {}
} = {}) {
  const city = firstClean(
    record.eventLocality,
    record.locationCity,
    record.itemSiteName,
    storageLocation?.address?.city,
    storageLocation.site_name,
    yard?.address?.city,
    yard.name
  );

  const state = firstClean(
    record.locationState,
    record.eventRegion,
    storageLocation?.address?.state,
    yard?.address?.state
  );

  const country = firstClean(
    record.locationCountry,
    record.eventCountry,
    storageLocation?.address?.country,
    yard?.address?.country
  );

  const label = [
    city,
    state,
    country
  ]
    .filter(Boolean)
    .join(", ");

  return {
    city,
    state,
    country,
    label
  };
}

function buildMachineLocation({
  machineLocation = "",
  record = {},
  storageLocation = {},
  yard = {}
} = {}) {
  const city = firstClean(
    storageLocation?.address?.city,
    storageLocation.site_name,
    record.locationCity,
    record.itemSiteName,
    yard?.address?.city,
    yard.name
  );

  const state = firstClean(
    storageLocation?.address?.state,
    record.locationState,
    yard?.address?.state
  );

  const country = firstClean(
    storageLocation?.address?.country,
    record.locationCountry,
    yard?.address?.country
  );

  const label = firstClean(
    machineLocation,
    [city, state].filter(Boolean).join(", "),
    [city, state, country].filter(Boolean).join(", ")
  );

  return {
    city,
    state,
    country,
    label
  };
}

function emptyAuctionTerms() {
  /*
   * RB terms and fees must be populated only from verified
   * listing/event-specific sources. Translation dictionaries
   * and generic page text are not valid evidence.
   */
  return {
    buyerPremium: {
      type: "tiered",
      region: "USA and Mexico",
      currency: "USD",
      effectiveFrom: "2025-01-01",
      reviewAfter: "2026-11-01",
      ratePercent: null,
      capAmount: 3750,
      tiers: [
        {
          minAmount: 0,
          maxAmount: 25000,
          ratePercent: 10,
          minimumFee: 100,
          flatFee: null
        },
        {
          minAmountExclusive: 25000,
          maxAmount: 75000,
          ratePercent: 5,
          minimumFee: 2500,
          flatFee: null
        },
        {
          minAmountExclusive: 75000,
          maxAmount: null,
          ratePercent: null,
          minimumFee: null,
          flatFee: 3750
        }
      ],
      rawText:
        "USA and Mexico: $25,000 or less — 10% with $100 minimum; over $25,000 through $75,000 — 5% with $2,500 minimum; over $75,000 — $3,750 flat fee."
    },

    tax: {
      taxable: null,
      ratePercent: null,
      jurisdiction: "",
      rawText: ""
    },

    specialFees: [],
    participationRequirements: "",

    payment: {
      dueAt: null,
      dueText: "",
      dueRule: "",
      options: [],
      instructions: "",
      electronicPaymentFeePercent: null,
      rawText: ""
    },

    removal: {
      deadlineAt: null,
      deadlineText: "",
      relativeDays: null,
      instructions: "",
      appointmentRequired: null,
      loadingAssistance: null,
      storageFeeText: "",
      rawText: ""
    },

    inspection: {
      datesText: "",
      instructions: ""
    },

    checkout: {
      datesText: "",
      instructions: ""
    },

    shipping: {
      available: null,
      buyerResponsible: null,
      instructions: ""
    },

    termsLinks: [],
    documents: [],
    specialTerms: "",
    fullTermsText: ""
  };
}


function stripRbMarkup(value = "") {
  return clean(
    String(value ?? "")
      .replace(/<[^>]+>/g, " ")
  );
}

function joinRbText(...values) {
  return values
    .flat()
    .map(value => stripRbMarkup(value))
    .filter(Boolean)
    .join(" ");
}

function getRbUnifiedBidding(root = {}) {
  const pageProps =
    root?.props?.pageProps || {};

  const nextI18Next =
    pageProps?._nextI18Next || {};

  const initialStore =
    nextI18Next?.initialI18nStore || {};

  const locale = firstClean(
    nextI18Next.initialLocale,
    root.locale,
    "en-US"
  );

  return (
    initialStore?.[locale]?.["unified-bidding"] ||
    initialStore?.["en-US"]?.["unified-bidding"] ||
    {}
  );
}


/*
 * Ritchie Bros. standard USA/Mexico transaction fees.
 * Effective for events opening on or after January 1, 2025.
 * Review when RB publishes its next annual schedule.
 */
const RB_USA_MEXICO_BUYER_FEES_2025 = {
  type: "tiered",
  region: "USA and Mexico",
  currency: "USD",
  effectiveFrom: "2025-01-01",
  reviewAfter: "2026-11-01",
  sourceUrl:
    "https://www.rbauction.com/buying/buyer-fees",
  ratePercent: null,
  capAmount: 3750,
  tiers: [
    {
      minAmount: 0,
      maxAmount: 25000,
      ratePercent: 10,
      minimumFee: 100,
      flatFee: null,
      rawText:
        "USD $25,000 or less: 10% of the winning bid, with a minimum fee of USD $100 per lot."
    },
    {
      minAmountExclusive: 25000,
      maxAmount: 75000,
      ratePercent: 5,
      minimumFee: 2500,
      flatFee: null,
      rawText:
        "Greater than USD $25,000 up to and including USD $75,000: 5% of the winning bid, with a minimum fee of USD $2,500 per lot."
    },
    {
      minAmountExclusive: 75000,
      maxAmount: null,
      ratePercent: null,
      minimumFee: null,
      flatFee: 3750,
      rawText:
        "Greater than USD $75,000: USD $3,750 per lot."
    }
  ],
  rawText:
    "USA and Mexico: USD $25,000 or less — 10% with a USD $100 minimum; over USD $25,000 through USD $75,000 — 5% with a USD $2,500 minimum; over USD $75,000 — USD $3,750 per lot."
};

function cloneRbBuyerFees(value) {
  return JSON.parse(JSON.stringify(value));
}

/*
 * RB AOF2 compatibility adapter.
 *
 * The canonical source remains auctionTerms.
 * This adapter exposes the same auctionRules contract already
 * consumed by the working Lyons/Proxibid AOF2 card.
 *
 * Do not move this logic into the frontend.
 * Do not modify Lyons/Proxibid to accommodate RB.
 */
function buildRbAof2CardRules(
  auctionTerms = {},
  auctionEndAt = ""
) {
  const buyerPremium =
    auctionTerms?.buyerPremium &&
    typeof auctionTerms.buyerPremium === "object"
      ? auctionTerms.buyerPremium
      : {};

  const sourceTiers =
    Array.isArray(buyerPremium.tiers)
      ? buyerPremium.tiers
      : [];

  const existingPurchaseTiers =
    Array.isArray(
      buyerPremium.purchaseTiers
    )
      ? buyerPremium.purchaseTiers
      : [];

  const purchaseTiers =
    existingPurchaseTiers.length > 0
      ? existingPurchaseTiers
      : sourceTiers.map(tier => ({
          minAmount:
            tier?.minAmount ??
            0,

          minAmountExclusive:
            tier?.minAmountExclusive ??
            null,

          maxAmount:
            tier?.maxAmount ??
            null,

          /*
           * The existing AOF2 buyer-premium card reads this
           * normalized rate field.
           */
          cashCheckWireRatePercent:
            tier?.cashCheckWireRatePercent ??
            tier?.ratePercent ??
            null,

          creditCardRatePercent:
            tier?.creditCardRatePercent ??
            null,

          minimumFee:
            tier?.minimumFee ??
            null,

          flatFee:
            tier?.flatFee ??
            null,

          rawText:
            tier?.rawText ??
            ""
        }));

  const payment =
    auctionTerms?.payment &&
    typeof auctionTerms.payment === "object"
      ? auctionTerms.payment
      : {};

  const tax =
    auctionTerms?.tax &&
    typeof auctionTerms.tax === "object"
      ? auctionTerms.tax
      : {};

  const removal =
    auctionTerms?.removal &&
    typeof auctionTerms.removal === "object"
      ? auctionTerms.removal
      : {};

  const shipping =
    auctionTerms?.shipping &&
    typeof auctionTerms.shipping === "object"
      ? auctionTerms.shipping
      : {};

  /*
   * Ritchie Bros. standard company-wide terms.
   *
   * When an explicit event removal deadline is published,
   * preserve it. Otherwise derive the storage-trigger deadline
   * from the auction event end date:
   *
   *   storage/removal deadline = auction end + 30 calendar days
   *   abandonment date        = auction end + 45 calendar days
   *
   * Standard published charges:
   *   storage: USD $25 per day
   *   overdue interest: 18% annually
   */
  function addCalendarDaysIso(value, days) {
    if (!value) return null;

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    date.setUTCDate(
      date.getUTCDate() + days
    );

    return date.toISOString();
  }

  function formatRbPolicyDate(value) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: "UTC",
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric"
      }
    ).format(date);
  }

  const publishedRemovalDeadline =
    removal.deadlineAt ||
    null;

  const derivedRemovalDeadline =
    publishedRemovalDeadline ||
    addCalendarDaysIso(
      auctionEndAt,
      30
    );

  const derivedAbandonmentAt =
    addCalendarDaysIso(
      auctionEndAt,
      45
    );

  const resolvedRemoval = {
    ...removal,

    deadlineAt:
      derivedRemovalDeadline,

    deadlineText:
      publishedRemovalDeadline
        ? (
            removal.deadlineText ||
            `Remove by ${formatRbPolicyDate(
              publishedRemovalDeadline
            )}.`
          )
        : derivedRemovalDeadline
          ? `Remove by ${formatRbPolicyDate(
              derivedRemovalDeadline
            )} before storage charges begin.`
          : (
              removal.deadlineText ||
              "Removal deadline unavailable."
            ),

    relativeDays:
      publishedRemovalDeadline
        ? (
            removal.relativeDays ??
            null
          )
        : derivedRemovalDeadline
          ? 30
          : null,

    deadlineDerived:
      !publishedRemovalDeadline &&
      Boolean(derivedRemovalDeadline),

    deadlineSource:
      publishedRemovalDeadline
        ? "rb-event-published"
        : derivedRemovalDeadline
          ? "rb-standard-policy"
          : "unavailable",

    storageFeePerDay:
      25,

    storageFeePerItem:
      true,

    storageFeeCurrency:
      "USD",

    storageStartsAt:
      derivedRemovalDeadline,

    storageStartsAfterDays:
      30,

    abandonmentAt:
      derivedAbandonmentAt,

    abandonmentAfterDays:
      45,

    removalAtBuyerExpense:
      removal.removalAtBuyerExpense ??
      true,

    buyerResponsibleForShipping:
      removal.buyerResponsibleForShipping ??
      shipping.buyerResponsible ??
      true,

    storageFeeText:
      [
        `Storage is USD $25 per day beginning ${
          derivedRemovalDeadline
            ? formatRbPolicyDate(
                derivedRemovalDeadline
              )
            : "30 days after the auction event ends"
        }.`,
        derivedAbandonmentAt
          ? `Purchases remaining after ${formatRbPolicyDate(
              derivedAbandonmentAt
            )} are considered abandoned.`
          : "Purchases remaining more than 45 days after the auction event ends are considered abandoned.",
        removal.storageFeeText || ""
      ]
        .filter(Boolean)
        .join(" "),

    rawText:
      [
        removal.rawText || "",
        "Ritchie Bros. standard policy: storage charges are USD $25 per day.",
        "Storage charges begin 30 calendar days after the auction event ends when no earlier event-specific removal deadline is published.",
        "Purchases remaining more than 45 days after the auction event ends are considered abandoned."
      ]
        .filter(Boolean)
        .join(" ")
  };

  /*
   * Enrich the canonical RB terms as well as the AOF2 adapter.
   * This keeps auctionTerms and auctionRules consistent.
   */
  auctionTerms.removal =
    resolvedRemoval;

  const existingSpecialFees =
    Array.isArray(auctionTerms.specialFees)
      ? auctionTerms.specialFees
      : [];

  const specialFeesWithoutStandardInterest =
    existingSpecialFees.filter(
      fee =>
        String(fee?.type || "")
          .toLowerCase() !== "interest"
    );

  auctionTerms.specialFees = [
    ...specialFeesWithoutStandardInterest,

    {
      type: "interest",
      amount: null,
      ratePercent: 18,
      ratePeriod: "annual",
      appliesAfterDays: 7,
      currency: "USD",
      source: "rb-standard-policy",
      rawText:
        "Interest accrues at 18% annually when payment is not made in full within 7 days after the auction."
    },

    {
      type: "storage",
      amount: 25,
      ratePercent: null,
      ratePeriod: "day",
      perItem: true,
      currency: "USD",
      appliesAfterDays: 30,
      startsAt:
        derivedRemovalDeadline,
      source: "rb-standard-policy",
      rawText:
        "Storage charges are USD $25 per day beginning 30 days after the auction event ends."
    }
  ];

  return {
    buyerPremium: {
      ...buyerPremium,
      purchaseTiers
    },

    /*
     * The existing card calls this paymentDue.
     * Preserve RB's exact rendered deadline text.
     */
    paymentDue: {
      dueAt:
        payment.dueAt ??
        null,

      dueText:
        payment.dueText ||
        "",

      dueRule:
        payment.dueRule ||
        "",

      relativeBusinessDays:
        payment.relativeBusinessDays ??
        null,

      options:
        Array.isArray(payment.options)
          ? payment.options
          : [],

      instructions:
        payment.instructions ||
        "",

      electronicPaymentFeePercent:
        payment.electronicPaymentFeePercent ??
        null,

      rawText:
        payment.rawText ||
        ""
    },

    tax: {
      taxable:
        tax.taxable ??
        null,

      ratePercent:
        tax.ratePercent ??
        null,

      jurisdiction:
        tax.jurisdiction ||
        "",

      exemptionAllowed:
        tax.exemptionAllowed ??
        null,

      exemptionCertificateRequired:
        tax.exemptionCertificateRequired ??
        null,

      exporterExemptionPossible:
        tax.exporterExemptionPossible ??
        null,

      possessionInUnitedStatesTaxable:
        tax.possessionInUnitedStatesTaxable ??
        null,

      rawText:
        tax.rawText ||
        ""
    },

    removal: {
      deadlineAt:
        resolvedRemoval.deadlineAt ??
        null,

      deadlineText:
        resolvedRemoval.deadlineText ||
        "",

      relativeDays:
        resolvedRemoval.relativeDays ??
        null,

      instructions:
        resolvedRemoval.instructions ||
        "",

      appointmentRequired:
        resolvedRemoval.appointmentRequired ??
        null,

      loadingAssistance:
        resolvedRemoval.loadingAssistance ??
        null,

      /*
       * RB confirms that storage fees may apply, but the
       * listing does not publish a numeric daily/item amount.
       * Never invent one.
       */
      storageFeePerDay:
        resolvedRemoval.storageFeePerDay ??
        null,

      storageFeePerItem:
        resolvedRemoval.storageFeePerItem ??
        null,

      storageFeeText:
        resolvedRemoval.storageFeeText ||
        "",

      removalAtBuyerExpense:
        resolvedRemoval.removalAtBuyerExpense ??
        shipping.buyerResponsible ??
        null,

      buyerResponsibleForShipping:
        shipping.buyerResponsible ??
        null,

      rawText:
        resolvedRemoval.rawText ||
        ""
    }
  };
}

function isRbUsaOrMexicoYard(yard = {}) {
  const text = [
    yard?.country,
    yard?.countryCode,
    yard?.state,
    yard?.city,
    yard?.label,
    yard?.name,
    yard?.address
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    /\busa\b/.test(text) ||
    /\bunited states\b/.test(text) ||
    /\bmexico\b/.test(text)
  );
}


function decodeRbCapturedHtml(value = "") {
  return clean(
    String(value ?? "")
      .replace(/\\u003c/gi, "<")
      .replace(/\\u003e/gi, ">")
      .replace(/\\u0026/gi, "&")
      .replace(/\\u0022/gi, '"')
      .replace(/\\u0027/gi, "'")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
  );
}

function firstRbCapturedMatch(source = "", patterns = []) {
  const text =
    String(source || "");

  for (const pattern of patterns) {
    const match =
      text.match(pattern);

    if (!match) continue;

    return decodeRbCapturedHtml(
      stripRbMarkup(
        match[1] || match[0]
      )
    );
  }

  return "";
}

function extractRbCapturedAof2(html = "") {
  const source =
    String(html || "");

  const paymentDueDate =
    firstRbCapturedMatch(source, [
      /Items must be paid in full by\s*<strong>([^<]+)<\/strong>/i
    ]);

  const removalDeadlineText =
    firstRbCapturedMatch(source, [
      /(Items must be removed by\s*<strong>[^<]+<\/strong>[^<.]*(?:\.)?)/i,
      /(Items must be removed by\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[^<.]+(?:\.)?)/i
    ]);

  const removalDeadlineDate =
    removalDeadlineText
      ? firstRbCapturedMatch(
          removalDeadlineText,
          [
            /\b((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4})\b/i,
            /\b([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\b/i
          ]
        )
      : "";

  const inspectionAddress =
    firstRbCapturedMatch(source, [
      /data-testid="inspections-info-card"[\s\S]{0,3000}?<div[^>]*>([^<]*\d{3,}[^<]*)<\/div>/i
    ]);

  const contactPhone =
    firstRbCapturedMatch(source, [
      /data-testid="contact-info-card"[\s\S]{0,2500}?(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})/i
    ]);

  return {
    paymentDueDate:
      paymentDueDate || null,

    removalDeadlineDate:
      removalDeadlineDate || null,

    removalDeadlineText,

    inspectionAddress,

    contactPhone
  };
}

function buildRbAuctionTerms({
  root = {},
  yard = {},
  html = ""
} = {}) {
  const terms =
    emptyAuctionTerms();

  const bidding =
    getRbUnifiedBidding(root);

  const captured =
    extractRbCapturedAof2(html);

  const termsTitle = firstClean(
    bidding[
      "additional_information.terms.title"
    ]
  );

  const termsText = stripRbMarkup(
    bidding[
      "additional_information.terms.text"
    ]
  );

  const feesTitle = firstClean(
    bidding[
      "additional_information.fees.title"
    ]
  );

  const feesText = stripRbMarkup(
    bidding[
      "additional_information.fees.text"
    ]
  );

  const paymentTitle = firstClean(
    bidding[
      "additional_information.payment.title"
    ]
  );

  const paymentText = stripRbMarkup(
    bidding[
      "additional_information.payment.text"
    ]
  );

  const purchaseRemoval = stripRbMarkup(
    bidding[
      "shipping.list.purchase_removal"
    ]
  );

  const pickupWindow = stripRbMarkup(
    bidding[
      "shipping.list.pickup_window"
    ]
  );

  const releaseTicket = stripRbMarkup(
    bidding[
      "shipping.list.release_ticket"
    ]
  );

  const shippingPartners = stripRbMarkup(
    bidding[
      "shipping.list.partners"
    ]
  );

  const inspectionText = stripRbMarkup(
    bidding[
      "inspection.inspection_available"
    ]
  );

  const bidConfirmation = stripRbMarkup(
    bidding[
      "confirmation_box.confirm_message_bidding_and_sale"
    ]
  );

  const estimatedFees = stripRbMarkup(
    bidding[
      "confirmation_box.estimated_fees_message"
    ]
  );

  const buyerFeesFallback = stripRbMarkup(
    bidding[
      "confirmation_box.buyer_fees_error_message"
    ]
  );

  const pickupHoursFrom =
    firstClean(yard.pickupHoursFrom);

  const pickupHoursTo =
    firstClean(yard.pickupHoursTo);

  const pickupHoursText =
    pickupHoursFrom && pickupHoursTo
      ? `Pickup hours: ${pickupHoursFrom}–${pickupHoursTo}.`
      : "";

  terms.buyerPremium.rawText =
    feesText;

  terms.tax.rawText =
    firstClean(
      estimatedFees,
      buyerFeesFallback
    );

  terms.payment.dueText =
    paymentText;

  terms.payment.dueRule =
    purchaseRemoval;

  terms.payment.instructions =
    joinRbText(
      paymentTitle,
      paymentText,
      purchaseRemoval
    );

  terms.payment.rawText =
    joinRbText(
      paymentText,
      purchaseRemoval
    );

  terms.removal.deadlineText =
    pickupWindow;

  /*
   * The source says eight BUSINESS days. Preserve the exact
   * wording in deadlineText and rawText rather than converting
   * it to a calendar deadline.
   */
  terms.removal.relativeDays = null;

  terms.removal.instructions =
    joinRbText(
      purchaseRemoval,
      releaseTicket,
      pickupHoursText
    );

  terms.removal.storageFeeText =
    pickupWindow;

  terms.removal.rawText =
    joinRbText(
      pickupWindow,
      purchaseRemoval,
      releaseTicket,
      pickupHoursText
    );

  terms.inspection.instructions =
    inspectionText;

  terms.checkout.instructions =
    purchaseRemoval;

  terms.shipping.available =
    Boolean(shippingPartners);

  terms.shipping.buyerResponsible =
    null;

  terms.shipping.instructions =
    shippingPartners;

  terms.specialTerms =
    bidConfirmation;

  terms.fullTermsText =
    joinRbText(
      termsTitle,
      termsText,
      feesTitle,
      feesText
    );


  /*
   * Verified listing/event AOF2 values.
   * Unknown dates and rates remain null.
   */
  terms.tax.taxable =
    null;

  terms.tax.ratePercent =
    null;

  terms.tax.jurisdiction =
    firstClean(
      yard?.state,
      yard?.country
    );

  terms.tax.rawText =
    "Tax rate not listed. See auction terms.";

  terms.payment.dueAt =
    null;

  terms.payment.dueText =
    captured.paymentDueDate
      ? `Items must be paid in full by ${captured.paymentDueDate}.`
      : "";

  terms.payment.dueRule =
    captured.paymentDueDate
      ? `Payment due ${captured.paymentDueDate}.`
      : "";

  terms.payment.instructions =
    joinRbText(
      terms.payment.dueText,
      "Late fees will be applied after the due date.",
      purchaseRemoval
    );

  terms.payment.rawText =
    joinRbText(
      terms.payment.dueText,
      "Late fees will be applied after the due date.",
      "Payment must be made in full within 7 days after the auction before interest accrues.",
      purchaseRemoval
    );

  terms.removal.deadlineAt =
    captured.removalDeadlineDate || null;

  terms.removal.deadlineText =
    firstClean(
      captured.removalDeadlineText,
      "Machine removal date not listed."
    );

  terms.removal.relativeDays =
    null;

  terms.removal.instructions =
    joinRbText(
      purchaseRemoval,
      releaseTicket,
      "Equipment must be removed from the auction site through the truck gate.",
      "A bill of lading must be completed for equipment transported to a foreign country.",
      pickupHoursText
    );

  terms.removal.storageFeeText =
    joinRbText(
      "Purchases not picked up by the removal deadline may be moved and subject to third-party hauling and storage fees.",
      "If not removed within 30 days after the auction event ends, storage fees apply.",
      "Purchases left more than 45 days after the auction event will be considered abandoned."
    );

  terms.removal.rawText =
    joinRbText(
      terms.removal.deadlineText,
      terms.removal.instructions,
      terms.removal.storageFeeText
    );

  terms.specialFees = [
    {
      type: "late_fee",
      amount: null,
      ratePercent: null,
      rawText:
        "Late fees will be applied after the payment due date."
    },
    {
      type: "interest",
      amount: null,
      ratePercent: null,
      rawText:
        "Interest accrues if payment is not made in full within 7 days after the auction."
    },
    {
      type: "storage",
      amount: null,
      ratePercent: null,
      rawText:
        terms.removal.storageFeeText
    }
  ];

  terms.participationRequirements =
    joinRbText(
      "Bids cannot be retracted.",
      "A submitted bid is binding.",
      "Everything sells as is, where is."
    );

  terms.inspection.instructions =
    joinRbText(
      captured.inspectionAddress
        ? `Inspection location: ${captured.inspectionAddress}.`
        : "",
      inspectionText,
      captured.contactPhone
        ? `Event site phone: ${captured.contactPhone}.`
        : ""
    );

  terms.shipping.buyerResponsible =
    true;

  terms.termsLinks = [
    "https://www.rbauction.com/legal-policies/terms-of-sale/latest",
    "https://www.rbauction.com/buying/buyer-fees",
    "https://www.rbauction.com/buying/read-before-you-bid",
    "https://www.rbauction.com/buying/payments"
  ];

  terms.specialTerms =
    joinRbText(
      bidConfirmation,
      "Bids cannot be retracted.",
      "Everything sells as is, where is.",
      "The successful bid is binding."
    );

  terms.fullTermsText =
    joinRbText(
      terms.fullTermsText,
      terms.specialTerms,
      terms.payment.rawText,
      terms.removal.rawText
    );

  return terms;
}

function parseAuctionFacts({
  html = "",
  sourceUrl = "",
  url = "",
  platform = "rbauction",
  defaultCompanyName = "Ritchie Bros.",
  machineLocation = ""
} = {}) {
  const finalUrl =
    sourceUrl ||
    url ||
    "";

  const root =
    extractNextData(html);

  const {
    record,
    item,
    listing,
    storageLocation,
    yard
  } = getRbObjects(root || {});

  const sourceListingId = firstClean(
    item.id,
    item.item_id,
    item.asset_id,
    record.itemId,
    record.itemID,
    record.assetId,
    sourceItemIdFromUrl(finalUrl)
  );

  const sourceEventId = firstClean(
    record.saleEventID,
    record.saleEventId,
    item.sale_event_guid,
    listing.sale_event_guid
  );

  const saleNumber = firstClean(
    record.saleNumber,
    listing.sale_number
  );

  const eventId = sourceEventId
    ? `rbauction-${sourceEventId}`
    : saleNumber
      ? `rbauction-sale-${saleNumber}`
      : "";

  const lotNumber = firstClean(
    listing.lot_number,
    record.lotNumber,
    record.lotNumberNumerical
  );

  const companyName = firstClean(
    record.buyingPlatform,
    listing.buying_platform,
    defaultCompanyName,
    "Ritchie Bros."
  );

  const eventName = firstClean(
    record.eventLocality,
    record.locationCity,
    record.itemSiteName,
    yard.name
  );

  const advertisedEventName = firstClean(
    record.eventAdvertisedName,
    record.saleEventName
  );

  const auctionType =
    normalizeAuctionType({
      record,
      listing
    });

  const startsAt = firstClean(
    toIso(record.eventStartDateTime),
    toIso(record.eventStartDate),
    toIso(record.dateOfEvent),
    toIso(listing.date_of_event)
  );

  const scheduledCloseAt = firstClean(
    toIso(listing.bidding_end_time),
    toIso(record.biddingEndTime)
  );

  const timezone = firstClean(
    record.eventTimeZone
  );

  const currency = firstClean(
    listing?.start_price?.currency,
    record.currency,
    "USD"
  );

  /*
   * Do not transport start_price as a listing price or current bid.
   * It is preserved only in raw evidence until IXI explicitly
   * defines how RB start-price data should be used.
   */
  const sourceStartPrice = firstDefined(
    listing?.start_price?.amount,
    record.startPrice
  );

const openingBid =
  toNumber(sourceStartPrice);

const currentBid =
  toNumber(
    firstDefined(
      listing?.current_bid?.amount,
      listing?.currentBid?.amount,
      listing?.current_bid,
      listing?.currentBid,
      record.currentBid,
      record.current_bid,
      record.highestBid,
      record.highest_bid
    )
  );

  const eventLocation =
    buildEventLocation({
      record,
      storageLocation,
      yard
    });

  const normalizedMachineLocation =
    buildMachineLocation({
      machineLocation,
      record,
      storageLocation,
      yard
    });

  const auctionTerms =
    buildRbAuctionTerms({
      root: root || {},
      yard,
      html
    });

  /*
   * Replace RB's generic fee sentence with its published USA/Mexico
   * transaction-fee schedule.
   */
  if (
    isRbUsaOrMexicoYard({
      ...yard,
      city:
        firstClean(
          yard?.city,
          eventLocation?.city
        ),
      state:
        firstClean(
          yard?.state,
          eventLocation?.state
        ),
      country:
        firstClean(
          yard?.country,
          eventLocation?.country
        ),
      label:
        firstClean(
          yard?.label,
          eventLocation?.label
        ),
      address:
        firstClean(
          yard?.address,
          eventLocation?.label
        )
    })
  ) {
    auctionTerms.buyerPremium =
      cloneRbBuyerFees(
        RB_USA_MEXICO_BUYER_FEES_2025
      );

    auctionTerms.buyerPremium.rawText =
      RB_USA_MEXICO_BUYER_FEES_2025.rawText;
  }

  const auctionRules =
    buildRbAof2CardRules(
      auctionTerms,
      scheduledCloseAt ||
      startsAt
    );

  const auctionEvent = {
    eventId,
    platform,
    sourceEventId,

    sourceAuctionHouseId:
      "ritchie-bros-auctioneers",

    companyName,

    company: {
      id: "ritchie-bros-auctioneers",
      name: companyName,
      url: "https://www.rbauction.com"
    },

    /*
     * AOF1 event name is the concise event identity:
     * "Las Vegas", not the combined advertised label.
     */
    eventTitle: eventName,
    eventName,

    advertisedEventName,

    auctionType,
    format: auctionType,

    location: eventLocation,
    saleDateText:
      eventDateText({
        record,
        listing
      }),

    startsAt,
    endsAt: scheduledCloseAt,
    timezone,
    currency,
    terms: auctionTerms,
    sourceUrl: finalUrl,

    saleNumber
  };

  const auctionLot = {
    eventId,
    platform,

    sourceLotId:
      sourceListingId,

    lotId:
      sourceListingId
        ? `rbauction-${sourceListingId}`
        : lotNumber
          ? `${eventId}-lot-${lotNumber}`
          : "",

    lotNumber,

    /*
     * Lot number is not automatically sale order unless RB provides
     * a separate verified sequence field.
     */
    saleOrder: null,

    scheduledCloseAt,
    actualCloseAt: "",

openingBid,
    currentBid,
    buyNowPrice: null,

    currency,

    /*
     * RB workflow statuses such as New, Published, Coming Soon,
     * In Yard, etc. are deliberately not transported.
     */
    status: "",

    reserveNotMet: null,
    machineLocation:
      normalizedMachineLocation,

    sourceUrl: finalUrl
  };

  const auction = {
    platform,

    /*
     * Compatibility contract consumed by the existing AOF2 card.
     * Canonical evidence remains in auctionTerms.
     */
    auctionRules,

    companyName,
    companyId:
      auctionEvent.sourceAuctionHouseId,

    eventId:
      auctionEvent.sourceEventId,

    eventTitle:
      auctionEvent.eventTitle,

    eventName:
      auctionEvent.eventName,

    advertisedEventName:
      auctionEvent.advertisedEventName,

    auctionType:
      auctionEvent.auctionType,

    format:
      auctionEvent.format,

    saleDateText:
      auctionEvent.saleDateText,

    startsAt:
      auctionEvent.startsAt,

    endsAt:
      auctionEvent.endsAt,

    timezone:
      auctionEvent.timezone,

    location:
      auctionEvent.location,

    lotId:
      auctionLot.sourceLotId,

    lotNumber:
      auctionLot.lotNumber,

    saleOrder: null,

openingBid,
currentBid,
    buyNowPrice: null,
    bidStatus: "",

    currency,
    sourceUrl: finalUrl,
    saleNumber
  };

  const launchPolicy = {
    forcedDestination: "auction",
    allowedDestinations: [
      "auction"
    ],
    destinationLocked: true
  };

  const confidenceChecks = {
    structuredData:
      Boolean(root),

    company:
      Boolean(companyName),

    eventId:
      Boolean(sourceEventId),

    eventName:
      Boolean(eventName),

    auctionType:
      Boolean(auctionType),

    eventLocation:
      Boolean(eventLocation.label),

    saleDate:
      Boolean(
        auctionEvent.saleDateText ||
        startsAt
      ),

    closeTime:
      Boolean(scheduledCloseAt),

    timezone:
      Boolean(timezone),

    lotNumber:
      Boolean(lotNumber)
  };

  const passedChecks =
    Object.values(confidenceChecks)
      .filter(Boolean)
      .length;

  return {
    auctionEvent,
    auctionLot,
    auctionTerms,
    auction,
    launchPolicy,

    auctionConfidence: {
      score: Number(
        (
          passedChecks /
          Object.keys(confidenceChecks).length
        ).toFixed(2)
      ),

      checks:
        confidenceChecks
    },

    rawAuctionEvidence: {
      structuredDataFound:
        Boolean(root),

      sourcePaths: {
        record:
          "$.props.pageProps.data.results.records[0]",

        listing:
          "$.props.pageProps.items[0].item.listing"
      },

      sourceListingId,
      sourceEventId,
      saleNumber,

      buyerFacingAuctionType:
        firstClean(
          record.buyingFormatFacetLabel,
          listing.sale_format_id
        ),

      ignoredBuyingFormat:
        firstClean(
          record.buyingFormat,
          listing.buying_format
        ),

      sourceStartPrice:
        toNumber(sourceStartPrice),

      sourceStartPriceCurrency:
        currency,

      advertisedEventName,
      eventName,
      eventLocation,
      lotNumber,
      scheduledCloseAt,
      timezone
    }
  };
}

module.exports = {
  parseAuctionFacts
};
