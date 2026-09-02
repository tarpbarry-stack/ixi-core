const { chromium } = require("playwright");

const { applyIdentityToParsedListing } =
  require("../parsers/applyIdentityToParsedListing");

const PLATFORM = "purplewave";
const SOURCE_LABEL = "Purple Wave";
const PARSER_VERSION = "purplewave-aof2-v1";

function clean(value = "") {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function first(...values) {
  for (const value of values.flat(Infinity)) {
    const normalized = clean(value);
    if (normalized) return normalized;
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

function toNumber(value) {
  const normalized = clean(value)
    .replace(/[,$%]/g, "")
    .replace(/[^\d.-]/g, "");

  if (!normalized) return null;

  const parsed = Number(normalized);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function matchFirst(text = "", patterns = []) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);

    if (match) {
      return clean(
        match[1] ?? match[0]
      );
    }
  }

  return "";
}

function parseJsonLdScripts(scripts = []) {
  const output = [];

  for (const rawScript of scripts) {
    try {
      const parsed = JSON.parse(rawScript);

      if (Array.isArray(parsed)) {
        output.push(...parsed);
      } else if (
        parsed &&
        Array.isArray(parsed["@graph"])
      ) {
        output.push(...parsed["@graph"]);
      } else if (parsed) {
        output.push(parsed);
      }
    } catch {
      // Ignore malformed JSON-LD.
    }
  }

  return output;
}

function findJsonLdType(records = [], type = "") {
  const wanted = clean(type).toLowerCase();

  return records.find(record => {
    const recordType = record?.["@type"];

    if (Array.isArray(recordType)) {
      return recordType.some(
        value =>
          clean(value).toLowerCase() === wanted
      );
    }

    return (
      clean(recordType).toLowerCase() === wanted
    );
  }) || null;
}

function parseSourceIds(url = "") {
  const match = String(url).match(
    /\/auction\/([^/]+)\/item\/([^/]+)/i
  );

  return {
    eventId: clean(match?.[1]),
    lotNumber: clean(match?.[2])
  };
}

function parseEventName(visibleText = "", title = "") {
  return first(
    matchFirst(visibleText, [
      /Home\s+(.+?Auction)\s+[12]\d{3}\s+/i,
      /^(.+?Auction)$/im
    ]),
    matchFirst(title, [
      /\|\s*(.+?Auction)$/i
    ])
  );
}

function parseDisplayedDate(visibleText = "") {
  return matchFirst(visibleText, [
    /\b(\d{2}\/\d{2}\/\d{2})\b/
  ]);
}

function parseCurrentBid(
  product = null,
  visibleText = ""
) {
  const structuredPrice =
    toNumber(product?.offers?.price);

  if (structuredPrice !== null) {
    return structuredPrice;
  }

  return toNumber(
    matchFirst(visibleText, [
      /Current\s+\$([\d,]+(?:\.\d{2})?)/i,
      /Current Bid\s+\$([\d,]+(?:\.\d{2})?)/i
    ])
  );
}

function parseBidCount(visibleText = "") {
  return toNumber(
    matchFirst(visibleText, [
      /Bids\s*\(([\d,]+)\)/i
    ])
  );
}

function parseBuyerPremium(visibleText = "") {
  const rawText = matchFirst(visibleText, [
    /(A\s+[\d.]+%\s+buyer's premium[^]*?calculated\.)/i,
    /(A\s+[\d.]+%\s+buyer premium[^]*?calculated\.)/i
  ]);

  const ratePercent = toNumber(
    matchFirst(rawText || visibleText, [
      /([\d.]+)%\s+buyer's premium/i,
      /([\d.]+)%\s+buyer premium/i
    ])
  );

  return {
    type:
      ratePercent !== null
        ? "percentage"
        : "unknown",

    ratePercent,
    capAmount: null,
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

function parsePayment(visibleText = "") {
  const dueText = matchFirst(visibleText, [
    /(Payments must be made within two business days after the auction\.)/i
  ]);

  return {
    dueText,
    deadline: "",
    methods: [],
    instructions: dueText,
    rawText: dueText
  };
}

function parseTax(visibleText = "") {
  const rawText = matchFirst(visibleText, [
    /(Sales tax is charged based on item location[^]*?state requirements\.)/i
  ]);

  return {
    taxable:
      rawText
        ? true
        : null,

    basis:
      rawText
        ? "Hammer price plus buyer premium"
        : "",

    ratePercent: null,
    exemptionAllowed: null,
    exemptionCertificateRequired: null,
    instructions: rawText,
    rawText
  };
}

function parseRemovalAndInspection(
  visibleText = ""
) {
  const inspectionText = matchFirst(
    visibleText,
    [
      /(Bidders are encouraged to ask questions before placing a bid\.[^]*?inspect the item in person\.)/i
    ]
  );

  const loginRequired =
    /CLICK HERE TO LOGIN AND VIEW MORE INFORMATION/i.test(
      visibleText
    );

  return {
    removal: {
      deadline: "",
      deadlineText: "",
      appointmentRequired: null,
      buyerResponsibleForLoading: null,
      buyerResponsibleForShipping: true,
      instructions:
        loginRequired
          ? "Seller and removal details require bidder login."
          : "",
      rawText:
        loginRequired
          ? "Seller / Removal Information requires bidder login."
          : ""
    },

    inspection: {
      available:
        !!inspectionText,
      datesText: "",
      appointmentRequired: true,
      instructions: inspectionText,
      rawText: inspectionText
    }
  };
}

function parseBiddingRules(visibleText = "") {
  const noReserveText = matchFirst(
    visibleText,
    [
      /(This item will sell without reserve to the highest bidder\.)/i,
      /(will sell to the highest bidder regardless of price\.)/i
    ]
  );

  return {
    reserveType:
      noReserveText
        ? "no_reserve"
        : "unknown",

    reserveMet:
      noReserveText
        ? true
        : null,

    bindingBid: true,
    bidIncrementsAvailable:
      /Bid Increments/i.test(visibleText),

    rawText: noReserveText
  };
}

function buildAuctionRules(auctionTerms) {
  const buyerPremium =
    auctionTerms.buyerPremium || {};

  return {
    buyerPremium: {
      ...buyerPremium,

      purchaseTiers:
        Array.isArray(buyerPremium.tiers)
          ? buyerPremium.tiers.map(tier => ({
              minAmount:
                tier.minAmount ?? 0,

              minAmountExclusive:
                tier.minAmountExclusive ?? null,

              maxAmount:
                tier.maxAmount ?? null,

              cashCheckWireRatePercent:
                tier.ratePercent ?? null,

              creditCardRatePercent: null,

              minimumFee:
                tier.minimumFee ?? null,

              flatFee:
                tier.flatFee ?? null,

              rawText:
                tier.rawText || ""
            }))
          : []
    },

    paymentDue: {
      ...auctionTerms.payment
    },

    tax: {
      ...auctionTerms.tax,

      exemptionAllowed:
        auctionTerms.tax
          ?.exemptionAllowed ?? null,

      exemptionCertificateRequired:
        auctionTerms.tax
          ?.exemptionCertificateRequired ?? null,

      exporterExemptionPossible: null,
      possessionInUnitedStatesTaxable: null
    },

    removal: {
      ...auctionTerms.removal
    }
  };
}

function filterPurpleWavePhotos(
  imageRecords = []
) {
  const urls = [];

  for (const image of imageRecords) {
    const candidates = [
      image?.currentSrc,
      image?.src,
      image?.dataSrc,
      image?.dataLarge,
      image?.dataZoom
    ];

    for (const candidate of candidates) {
      const url = clean(candidate);

      if (!url) continue;

      if (
        !/cloudfront\.net|purplewave\.com/i.test(
          url
        )
      ) {
        continue;
      }

      if (
        /logo|icon|avatar|sprite|banner|placeholder|payment|finance|tracking/i.test(
          url
        )
      ) {
        continue;
      }

      if (
        /\/i\/a\/|\/auction\//i.test(url) ||
        /\/[A-Z]{1,4}\d{3,}\.(?:jpe?g|png|webp)(?:\?|$)/i.test(
          url
        )
      ) {
        urls.push(url);
      }
    }
  }

  return unique(urls).slice(0, 40);
}

async function acquire(url) {
  let browser;

  const capturedAt = new Date();

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage"
      ]
    });

    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/149 Safari/537.36",

      viewport: {
        width: 1440,
        height: 1200
      },

      locale: "en-US"
    });

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    await page.waitForTimeout(7000);

    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(3000);

    const result = await page.evaluate(() => {
      const meta = name =>
        document.querySelector(
          `meta[property="${name}"]`
        )?.content ||
        document.querySelector(
          `meta[name="${name}"]`
        )?.content ||
        "";

      const jsonLdScripts = Array.from(
        document.querySelectorAll(
          'script[type="application/ld+json"]'
        )
      ).map(script =>
        script.textContent || ""
      );

      const links = Array.from(
        document.querySelectorAll("a")
      ).map(link => ({
        label:
          (
            link.innerText ||
            link.textContent ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim(),

        url: link.href || ""
      }));

      const images = Array.from(
        document.querySelectorAll("img")
      ).map(img => ({
        src: img.src || "",
        currentSrc: img.currentSrc || "",
        dataSrc:
          img.getAttribute("data-src") || "",
        dataLarge:
          img.getAttribute(
            "data-large-image"
          ) || "",
        dataZoom:
          img.getAttribute(
            "data-zoom-image"
          ) || "",
        alt: img.alt || ""
      }));

      return {
        finalUrl: location.href,

        title:
          document.querySelector("h1")
            ?.innerText ||
          meta("og:title") ||
          document.title ||
          "",

        description:
          meta("description") ||
          meta("og:description") ||
          "",

        visibleText:
          document.body?.innerText || "",

        jsonLdScripts,
        links,
        images
      };
    });

    const records =
      parseJsonLdScripts(
        result.jsonLdScripts
      );

    const product =
      findJsonLdType(records, "Product");

    const offer =
      product?.offers || {};

    const structuredLocation =
      offer?.availableAtOrFrom
        ?.address || {};

    const sourceIds =
      parseSourceIds(
        result.finalUrl || url
      );

    const combined = clean(
      [
        result.title,
        result.description,
        result.visibleText
      ].join(" ")
    );

    const year = first(
      product?.productionDate,
      matchFirst(result.title, [
        /\b(20\d{2}|19\d{2})\b/
      ])
    );

    const make = first(
      product?.brand?.name,
      matchFirst(result.title, [
        /\b(?:20\d{2}|19\d{2})\s+([A-Za-z-]+)/i
      ])
    );

    const model = first(
      product?.model,
      matchFirst(result.title, [
        /\b(?:20\d{2}|19\d{2})\s+[A-Za-z-]+\s+([A-Za-z0-9-]+)/i
      ])
    );

    const hours = matchFirst(combined, [
      /Hours\s*:\s*([\d,]+)\s+on meter/i,
      /([\d,]+)\s+hours/i
    ]);

    const serialNumber = first(
      product?.identifier?.value,
      matchFirst(combined, [
        /Serial\s*:\s*([A-Z0-9]+)/i,
        /VIN\s*:\s*([A-Z0-9]+)/i
      ])
    );

    const stockNumber = matchFirst(
      combined,
      [
        /Unit\s*#\s*:\s*([A-Z0-9-]+)/i,
        /Stock\s*#?\s*:\s*([A-Z0-9-]+)/i
      ]
    );

    const city = first(
      structuredLocation.addressLocality,
      matchFirst(result.visibleText, [
        /\b([A-Za-z .'-]+),\s*[A-Z]{2}\s+\d{5}\b/
      ])
    );

    const state = first(
      structuredLocation.addressRegion,
      matchFirst(result.visibleText, [
        /\b[A-Za-z .'-]+,\s*([A-Z]{2})\s+\d{5}\b/
      ])
    );

    const postalCode = first(
      structuredLocation.postalCode,
      matchFirst(result.visibleText, [
        /\b[A-Za-z .'-]+,\s*[A-Z]{2}\s+(\d{5})\b/
      ])
    );

    const country = first(
      structuredLocation.addressCountry,
      "US"
    );

    const locationLabel = [
      city,
      state
    ]
      .filter(Boolean)
      .join(", ");

    const sellerName = first(
      offer?.seller?.name,
      matchFirst(result.visibleText, [
        /\n([^\n]+)\s+\(All seller items\)/i
      ])
    );

    const eventName =
      parseEventName(
        result.visibleText,
        result.title
      );

    const dateText =
      parseDisplayedDate(
        result.visibleText
      );

    const startsAt =
      clean(offer?.validFrom);

    const scheduledCloseAt =
      clean(offer?.validThrough);

    const currentBid =
      parseCurrentBid(
        product,
        result.visibleText
      );

    const bidCount =
      parseBidCount(
        result.visibleText
      );

    const buyerPremium =
      parseBuyerPremium(
        result.visibleText
      );

    const payment =
      parsePayment(
        result.visibleText
      );

    const tax =
      parseTax(
        result.visibleText
      );

    const {
      removal,
      inspection
    } = parseRemovalAndInspection(
      result.visibleText
    );

    const biddingRules =
      parseBiddingRules(
        result.visibleText
      );

    const termsLinks = unique(
      result.links
        .filter(link =>
          /terms|payment details|removal/i.test(
            `${link.label} ${link.url}`
          )
        )
        .map(link => link.url)
    );

    const photos =
      filterPurpleWavePhotos(
        result.images
      );

    const machine =
      applyIdentityToParsedListing({
        source: PLATFORM,
        sourceName: SOURCE_LABEL,
        url,

        title: result.title,

        description:
          result.description,

        visibleText:
          result.visibleText,

        year,
        make,
        model,
        hours,

        price:
          currentBid !== null
            ? String(currentBid)
            : "",

        city,
        state,
        serialNumber,
        stockNumber,

        sourceCategory:
          first(
            product?.category,
            ""
          ),

        photos
      });

    const auctionTerms = {
      buyerPremium,

      tax,

      specialFees: {
        items: [],
        rawText: ""
      },

      participationRequirements: {
        registrationRequired: true,
        approvalRequired: null,
        depositRequired: null,
        instructions:
          "Purple Wave bidder registration is required to place bids.",
        rawText:
          "Purple Wave bidder registration is required to place bids."
      },

      payment,

      removal,

      inspection,

      checkout: {
        datesText: "",
        instructions:
          payment.instructions
      },

      shipping: {
        available: true,
        buyerResponsible: true,
        instructions:
          "Shipping and transportation are the buyer's responsibility unless separately arranged."
      },

      termsLinks,

      documents: [],

      biddingRules,

      legalNotices: {
        asIsWhereIs: null,
        bindingBid: true,
        rawText:
          biddingRules.rawText
      },

      specialTerms: {
        sellerName,
        noReserve:
          biddingRules.reserveType ===
          "no_reserve",
        rawText:
          biddingRules.rawText
      },

      fullTermsText: [
        buyerPremium.rawText,
        payment.rawText,
        tax.rawText,
        removal.rawText,
        inspection.rawText,
        biddingRules.rawText
      ]
        .filter(Boolean)
        .join(" ")
    };

    const auctionRules =
      buildAuctionRules(
        auctionTerms
      );

    const canonicalLotId =
      sourceIds.lotNumber
        ? `${PLATFORM}-${sourceIds.lotNumber}`
        : "";

    const auctionEvent = {
      id:
        sourceIds.eventId
          ? `${PLATFORM}-${sourceIds.eventId}`
          : "",

      sourceEventId:
        sourceIds.eventId,

      name: eventName,

      format: "timed_auction",
      participation: "online",
      scope: "nationwide",

      location: {
        type: "nationwide",
        scope: "nationwide",
        label: "NATIONWIDE EVENT",
        city: "",
        state: "",
        country: "US",
        address: "",
        postalCode: ""
      },

      dateText,
      startsAt,
      endsAt:
        scheduledCloseAt,

      timezone:
        scheduledCloseAt
          ? "UTC"
          : ""
    };

    const auctionLot = {
      id: canonicalLotId,

      sourceLotId:
        sourceIds.lotNumber,

      lotId: canonicalLotId,

      lotNumber:
        sourceIds.lotNumber,

      number:
        sourceIds.lotNumber,

      saleOrder: null,

      scheduledCloseAt,
      actualCloseAt: "",

      timezone:
        scheduledCloseAt
          ? "UTC"
          : "",

      openingBid: null,
      currentBid,
      bidCount,
      watcherCount: null,
      nextBid: null,
      buyNowPrice: null,
      increment: null,

      reserveMet:
        biddingRules.reserveType ===
        "no_reserve"
          ? true
          : null,

      currency:
        offer?.priceCurrency ||
        "USD",

      status:
        scheduledCloseAt
          ? "scheduled"
          : "",

      machineLocation: {
        label: locationLabel,
        city,
        state,
        country,
        address: "",
        postalCode
      },

      seller: {
        name: sellerName
      },

      sourceUrl:
        result.finalUrl || url
    };

    const auction = {
      provider: PLATFORM,
      platform: PLATFORM,

      providerListingId:
        canonicalLotId,

      providerUrl:
        result.finalUrl || url,

      company: {
        id: "purple-wave",
        name: SOURCE_LABEL,
        url:
          "https://www.purplewave.com"
      },

      event: auctionEvent,
      lot: auctionLot,

      bidding: {
        openingBid:
          auctionLot.openingBid,

        currentBid:
          auctionLot.currentBid,

        bidCount:
          auctionLot.bidCount,

        reserveMet:
          auctionLot.reserveMet,

        buyNowPrice:
          auctionLot.buyNowPrice,

        increment:
          auctionLot.increment,

        currency:
          auctionLot.currency
      },

      timing: {
        timezone:
          auctionEvent.timezone,

        startsAt:
          auctionEvent.startsAt,

        endsAt:
          auctionEvent.endsAt,

        scheduledCloseAt:
          auctionLot.scheduledCloseAt,

        actualCloseAt: "",
        updatedAt: ""
      },

      status: {
        value:
          auctionLot.status,

        live: null,
        closed: null,
        pending: null,
        sold: null,
        extended: null
      },

      terms:
        auctionTerms,

      auctionRules,

      source: {
        url:
          result.finalUrl || url,

        type: PLATFORM,
        platform: PLATFORM,

        scrapedAt:
          capturedAt.toISOString(),

        updatedAt: "",
        parserVersion:
          PARSER_VERSION
      }
    };

    const sale = {
      type: "auction",
      mechanism: "timed_auction",
      confidence: "high",

      evidence: [
        "Purple Wave auction URL",
        "JSON-LD SellByAuction offer",
        sourceIds.lotNumber
          ? `Purple Wave lot ${sourceIds.lotNumber}`
          : ""
      ].filter(Boolean)
    };

    return {
      ok: true,

      source: {
        type: PLATFORM,
        label: SOURCE_LABEL,
        platform: PLATFORM,
        url:
          result.finalUrl || url
      },

      acquisition: {
        adapter:
          PARSER_VERSION,

        method:
          "rendered-browser-dom",

        source: PLATFORM,
        platform: PLATFORM,

        saleType:
          "auction",

        parserVersion:
          PARSER_VERSION,

        captureProvider:
          "playwright",

        capturedAt:
          capturedAt.toISOString(),

        requestedUrl: url,

        finalUrl:
          result.finalUrl || url,

        status:
          response?.status() || null
      },

      sale,
      machine,
      media: photos,
      inspection,

      auctionEvent,
      auctionLot,
      auction,
      auctionTerms,

      launchPolicy: {
        forcedDestination:
          "auction",

        allowedDestinations: [
          "auction"
        ],

        destinationLocked: true,

        reason:
          "Purple Wave source pages are auction lots"
      },

      rawAuctionEvidence: {
        structuredDataFound:
          !!product,

        businessFunction:
          clean(
            offer?.businessFunction
          ),

        sourceEventId:
          sourceIds.eventId,

        sourceListingId:
          sourceIds.lotNumber,

        lotNumber:
          sourceIds.lotNumber,

        eventName,
        dateText,
        startsAt,
        scheduledCloseAt,
        currentBid,
        bidCount,
        sellerName,
        locationLabel,

        buyerPremiumText:
          buyerPremium.rawText,

        paymentText:
          payment.rawText,

        taxText:
          tax.rawText,

        removalText:
          removal.rawText,

        inspectionText:
          inspection.rawText,

        biddingRulesText:
          biddingRules.rawText
      },

      confidence: {
        title:
          result.title
            ? "parsed"
            : "missing",

        description:
          result.description
            ? "parsed"
            : "missing",

        structuredData:
          product
            ? "parsed"
            : "missing",

        event:
          eventName
            ? "parsed"
            : "missing",

        lotNumber:
          sourceIds.lotNumber
            ? "parsed"
            : "missing",

        currentBid:
          currentBid !== null
            ? "parsed"
            : "missing",

        buyerPremium:
          buyerPremium.ratePercent !== null
            ? "parsed"
            : "missing",

        payment:
          payment.dueText
            ? "parsed"
            : "missing",

        tax:
          tax.rawText
            ? "parsed"
            : "missing",

        machineLocation:
          locationLabel
            ? "parsed"
            : "missing",

        photos:
          photos.length
            ? "parsed"
            : "missing"
      }
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  acquire,
  buildAuctionRules
};
