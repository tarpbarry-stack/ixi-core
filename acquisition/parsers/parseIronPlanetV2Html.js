const cheerio = require("cheerio");

const PLATFORM = "ironplanet";
const SOURCE_LABEL = "IronPlanet";
const PARSER_VERSION = "ironplanet-v2";

/* -------------------------------------------------------------------------- */
/* Core helpers                                                               */
/* -------------------------------------------------------------------------- */

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

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function toNumber(value) {
  const normalized = clean(value)
    .replace(/[,$%]/g, "")
    .replace(/[^\d.-]/g, "");

  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchFirst(text = "", patterns = []) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match) return clean(match[1] ?? match[0]);
  }
  return "";
}

function stripScriptsAndStyles(html = "") {
  const $ = cheerio.load(html || "");
  $("script, style, noscript, svg").remove();
  return clean($("body").text());
}

function collectCaptureStrings(value, output = [], seen = new Set()) {
  if (
    value === null ||
    value === undefined
  ) {
    return output;
  }

  if (typeof value === "string") {
    const normalized = clean(value);

    if (
      normalized &&
      normalized.length >= 2 &&
      !seen.has(normalized)
    ) {
      seen.add(normalized);
      output.push(normalized);
    }

    return output;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach(item => {
      collectCaptureStrings(
        item,
        output,
        seen
      );
    });

    return output;
  }

  if (typeof value === "object") {
    Object.values(value).forEach(item => {
      collectCaptureStrings(
        item,
        output,
        seen
      );
    });
  }

  return output;
}

function buildIronPlanetEvidenceText({
  html = "",
  capture = {}
} = {}) {
  const captureData =
    capture?.payload?.data ||
    capture?.data ||
    {};

  const evidence = [
    stripScriptsAndStyles(html),

    capture?.html,
    capture?.rawHtml,
    capture?.markdown,
    capture?.text,
    capture?.content,
    capture?.rawText,

    captureData?.html,
    captureData?.rawHtml,
    captureData?.markdown,
    captureData?.text,
    captureData?.content,
    captureData?.rawText,

    ...collectCaptureStrings(capture)
  ]
    .filter(Boolean)
    .map(value => {
      const stringValue =
        String(value || "");

      /*
       * HTML values need their tags removed before joining
       * into the searchable evidence corpus.
       */
      if (
        /<\/?[a-z][\s\S]*>/i.test(
          stringValue
        )
      ) {
        return stripScriptsAndStyles(
          stringValue
        );
      }

      return clean(stringValue);
    })
    .filter(Boolean);

  return unique(evidence).join(" ");
}

function absoluteUrl(value = "", baseUrl = "") {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return "";
  }
}

function isIronPlanetUrl(url = "") {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      hostname === "ironplanet.com" ||
      hostname === "www.ironplanet.com" ||
      hostname.endsWith(".ironplanet.com")
    );
  } catch {
    return /ironplanet\.com/i.test(url);
  }
}

/* -------------------------------------------------------------------------- */
/* Embedded JSON evidence                                                     */
/* -------------------------------------------------------------------------- */

function extractJsonScripts($) {
  const scripts = [];

  $("script").each((_, node) => {
    const type = clean($(node).attr("type")).toLowerCase();
    const id = clean($(node).attr("id"));
    const body = $(node).html() || "";

    if (
      id === "__NEXT_DATA__" ||
      type.includes("json") ||
      /^\s*[\[{]/.test(body)
    ) {
      try {
        scripts.push({
          id,
          type,
          value: JSON.parse(body)
        });
      } catch {
        // Ignore script tags that are not valid JSON.
      }
    }
  });

  return scripts;
}

function walk(value, visitor, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walk(item, visitor, `${path}[${index}]`);
    });
    return;
  }

  if (!value || typeof value !== "object") return;

  visitor(value, path);

  Object.entries(value).forEach(([key, child]) => {
    walk(child, visitor, `${path}.${key}`);
  });
}

function collectStructuredCandidates($) {
  const candidates = [];

  extractJsonScripts($).forEach(script => {
    walk(script.value, (object, path) => {
      const serialized = JSON.stringify(object);

      if (
        /itemNumber|item_number|serialNumber|serial_number|meterReading|operatingHours|currentBid|transaction fee|payment details|ironclad|inspection/i.test(
          serialized
        )
      ) {
        candidates.push({
          scriptId: script.id,
          path,
          object
        });
      }
    });
  });

  return candidates;
}

function pickStructured(candidates = [], keys = []) {
  const wanted = new Set(
    keys.map(key => String(key).toLowerCase())
  );

  for (const candidate of candidates) {
    for (const [key, value] of Object.entries(candidate.object || {})) {
      if (
        wanted.has(String(key).toLowerCase()) &&
        value !== null &&
        value !== undefined &&
        clean(
          typeof value === "object"
            ? JSON.stringify(value)
            : value
        )
      ) {
        return {
          value,
          path: `${candidate.path}.${key}`
        };
      }
    }
  }

  return {
    value: "",
    path: ""
  };
}

/* -------------------------------------------------------------------------- */
/* DOM extraction                                                             */
/* -------------------------------------------------------------------------- */

function extractLabelValue($, labels = []) {
  const wanted = labels.map(label =>
    clean(label).replace(/:$/, "").toLowerCase()
  );

  let found = "";

  $("body *").each((_, node) => {
    if (found) return false;

    const ownText = clean(
      $(node)
        .clone()
        .children()
        .remove()
        .end()
        .text()
    )
      .replace(/:$/, "")
      .toLowerCase();

    if (!wanted.includes(ownText)) return;

    found = first(
      $(node).next().text(),
      $(node).parent().find("strong, b").first().text(),
      $(node).parent().text().replace(
        new RegExp(`^\\s*${clean($(node).text())}\\s*:?[\\s-]*`, "i"),
        ""
      )
    );
  });

  return clean(found);
}

function extractTitle($, candidates, visibleText) {
  const structured = pickStructured(candidates, [
    "title",
    "itemTitle",
    "listingTitle",
    "name"
  ]);

  const title = first(
    structured.value,
    $("h1").first().text(),
    $('meta[property="og:title"]').attr("content"),
    $('meta[name="twitter:title"]').attr("content"),
    $("title").text(),
    matchFirst(visibleText, [
      /\b((?:19|20)\d{2}\s+[A-Za-z][A-Za-z0-9 .&/-]+\s+[A-Za-z0-9][A-Za-z0-9 .&/-]+(?:Truck|Excavator|Loader|Dozer|Tractor|Crane|Forklift|Telehandler|Compactor))\b/i
    ])
  )
    .replace(/\s*\|\s*IronPlanet.*$/i, "")
    .replace(/\s*-\s*IronPlanet.*$/i, "");

  return {
    value: clean(title),
    path: structured.path
  };
}

function parseTitleParts(title = "") {
  const year = matchFirst(title, [
    /\b((?:19|20)\d{2})\b/
  ]);

  const remainder = clean(
    title.replace(new RegExp(`^${year}\\s+`, "i"), "")
  );

  const machineTypePattern =
    /\s+(?:Articulated Dump Truck|Dump Truck|Excavator|Wheel Loader|Crawler Tractor|Dozer|Backhoe Loader|Motor Grader|Telehandler|Forklift|Crane|Compactor|Skid Steer|Track Loader|Tractor)$/i;

  const identityText = remainder.replace(machineTypePattern, "");
  const tokens = identityText.split(/\s+/);

  return {
    year,
    make: tokens.length >= 2
      ? tokens.slice(0, tokens.length - 1).join(" ")
      : tokens[0] || "",
    model: tokens.length >= 2
      ? tokens[tokens.length - 1]
      : ""
  };
}

function extractItemNumber($, candidates, visibleText, sourceUrl) {
  const structured = pickStructured(candidates, [
    "itemNumber",
    "item_number",
    "itemId",
    "itemID",
    "listingId",
    "listingID",
    "assetId"
  ]);

  const value = first(
    structured.value,
    extractLabelValue($, [
      "Item Number",
      "Item #"
    ]),
    matchFirst(visibleText, [
      /\bItem\s*Number\s*:?\s*(\d{5,})\b/i,
      /\bItem\s*#\s*:?\s*(\d{5,})\b/i
    ]),
    matchFirst(sourceUrl, [
      /\/(\d{6,})(?:[/?#]|$)/
    ])
  );

  return {
    value,
    path: structured.path
  };
}

function extractHours($, candidates, visibleText) {
  const structured = pickStructured(candidates, [
    "hours",
    "meterReading",
    "meter_reading",
    "operatingHours",
    "usage"
  ]);

  return first(
    structured.value,
    extractLabelValue($, [
      "Hours",
      "Meter Reading",
      "Usage"
    ]),
    matchFirst(visibleText, [
      /\b(?:Hours|Meter Reading)\s*:?\s*([\d,]+)\b/i,
      /\b([\d,]+)\s*(?:Hours|Hrs)\b/i
    ])
  ).replace(/,/g, "");
}

function extractSerialNumber($, candidates, visibleText) {
  const structured = pickStructured(candidates, [
    "serialNumber",
    "serial_number",
    "serial",
    "vin"
  ]);

  return first(
    structured.value,
    extractLabelValue($, [
      "Serial Number",
      "Serial #",
      "VIN"
    ]),
    matchFirst(visibleText, [
      /\bSerial\s*(?:Number|#)\s*:?\s*([A-Z0-9-]{8,})\b/i,
      /\bVIN\s*:?\s*([A-Z0-9-]{8,})\b/i
    ])
  ).toUpperCase();
}

function extractPrice($, candidates, visibleText) {
  const structured = pickStructured(candidates, [
    "currentBid",
    "current_bid",
    "price",
    "openingBid",
    "startPrice"
  ]);

  return first(
    structured.value,
    extractLabelValue($, [
      "Current Bid",
      "Opening Bid",
      "Price"
    ]),
    matchFirst(visibleText, [
      /\bCurrent\s+Bid\s*:?\s*(?:USD\s*)?\$?\s*([\d,]+(?:\.\d{2})?)/i,
      /\bOpening\s+Bid\s*:?\s*(?:USD\s*)?\$?\s*([\d,]+(?:\.\d{2})?)/i
    ])
  );
}

function extractDescription($, candidates, title) {
  const structured = pickStructured(candidates, [
    "description",
    "itemDescription",
    "listingDescription",
    "shortDescription"
  ]);

  return first(
    structured.value,
    $('meta[name="description"]').attr("content"),
    $('meta[property="og:description"]').attr("content"),
    $('[class*="description"]').first().text(),
    title
  );
}

function extractLocation($, candidates, visibleText) {
  const structured = pickStructured(candidates, [
    "location",
    "itemLocation",
    "yardLocation",
    "cityState"
  ]);

  let structuredLocation = "";

  if (
    structured.value &&
    typeof structured.value === "object"
  ) {
    structuredLocation = first(
      structured.value.label,
      [
        structured.value.city,
        structured.value.state,
        structured.value.country
      ].filter(Boolean).join(", ")
    );
  } else {
    structuredLocation = clean(structured.value);
  }

  const label = first(
    structuredLocation,
    extractLabelValue($, [
      "Location",
      "Item Location"
    ]),
    matchFirst(visibleText, [
      /\b(?:Item\s+)?Location\s*:?\s*([A-Za-z .'-]+,\s*[A-Za-z .'-]+(?:,\s*(?:United States|USA|Canada|Mexico))?)/i,
      /\bin\s+([A-Za-z .'-]+,\s*[A-Za-z .'-]+,\s*United States)\b/i
    ])
  )
    .replace(/,\s*United States$/i, "")
    .replace(/,\s*USA$/i, "");

  const parts = label
    .split(",")
    .map(clean)
    .filter(Boolean);

  return {
    label,
    city: parts[0] || "",
    state: parts[1] || "",
    country: parts[2] || ""
  };
}

/* -------------------------------------------------------------------------- */
/* Media                                                                      */
/* -------------------------------------------------------------------------- */

function normalizeImageUrl(value = "") {
  const decoded = clean(value)
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/");

  if (!/^https?:\/\//i.test(decoded)) return "";

  try {
    const parsed = new URL(decoded);
    const hostname = parsed.hostname.toLowerCase();

    if (
      hostname !== "cdn.ironpla.net" &&
      !hostname.endsWith(".ironpla.net") &&
      !hostname.includes("ironplanet")
    ) {
      return "";
    }

    if (
      !/\.(?:jpe?g|png|webp|avif)(?:$|\?)/i.test(parsed.href)
    ) {
      return "";
    }

    return parsed.href
      .replace(
        /-(?:thumb|tn|sm|md|lg)\.(jpe?g|png|webp)(?=$|\?)/i,
        "-hr.$1"
      )
      .replace(
        /\/(?:thumb|thumbnail|small|medium)\//i,
        "/"
      );
  } catch {
    return "";
  }
}

function extractPhotos($, html, candidates) {
  const urls = [];

  /*
   * Proven IronPlanet evidence sources from the original parser.
   */
  for (const match of String(html).matchAll(
    /"filename"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp))"/gi
  )) {
    urls.push(match[1]);
  }

  for (const match of String(html).matchAll(
    /"thumbUrl"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp))"/gi
  )) {
    urls.push(match[1]);
  }

  for (const match of String(html).matchAll(
    /https?:\/\/cdn\.ironpla\.net\/i\/[^"'\\\s<]+?\.(?:jpg|jpeg|png|webp)/gi
  )) {
    urls.push(match[0]);
  }

  /*
   * Keep structured evidence support in V2, but all values still
   * pass through the proven IronPlanet gallery filters below.
   */
  candidates.forEach(candidate => {
    walk(candidate.object, object => {
      Object.entries(object).forEach(([key, value]) => {
        if (!/image|photo|picture|media/i.test(key)) {
          return;
        }

        if (typeof value === "string") {
          urls.push(value);
          return;
        }

        if (Array.isArray(value)) {
          value.forEach(item => {
            if (typeof item === "string") {
              urls.push(item);
              return;
            }

            if (item && typeof item === "object") {
              urls.push(
                item.url,
                item.src,
                item.filename,
                item.thumbUrl,
                item.originalUrl,
                item.largeUrl,
                item.highResolutionUrl
              );
            }
          });
        }
      });
    });
  });

  const byImageId = new Map();

  for (
    const src of unique(
      urls
        .map(item => clean(item))
        .map(item => item.replace(/\\\//g, "/"))
        .filter(item =>
          item.includes("cdn.ironpla.net/i/")
        )
        .filter(item =>
          /\.(jpg|jpeg|png|webp)$/i.test(item)
        )
        .filter(item =>
          !item.toLowerCase().includes("sprite")
        )
        .filter(item =>
          !item.toLowerCase().includes("logo")
        )
        .filter(item =>
          !item.toLowerCase().includes("banner")
        )
        .filter(item =>
          !item.toLowerCase().includes("/hmpg/")
        )
        .filter(item =>
          !item.toLowerCase().includes("/howto/")
        )
        .filter(item =>
          !item.toLowerCase().includes("approvals")
        )
        .filter(item => {
          /*
           * Real IronPlanet inspection/gallery photos:
           *
           * https://cdn.ironpla.net/i/22420/993/<uuid>.jpg
           * https://cdn.ironpla.net/i/22420/993/<uuid>-hr.jpg
           */
          return /cdn\.ironpla\.net\/i\/\d+\/\d+\/[a-f0-9-]+(?:-hr)?\.(jpg|jpeg|png|webp)$/i.test(
            item
          );
        })
    )
  ) {
    const filename =
      src.split("/").pop() || "";

    const id = filename
      .replace(
        /\.(jpg|jpeg|png|webp)$/i,
        ""
      )
      .replace(
        /-(hr|large|medium|small|thumb|thumbnail)$/i,
        ""
      );

    if (!id) continue;

    const current =
      byImageId.get(id);

    /*
     * One URL per underlying image UUID.
     * Prefer the published high-resolution version.
     */
    if (
      !current ||
      /-hr\.(jpg|jpeg|png|webp)$/i.test(src)
    ) {
      byImageId.set(id, src);
    }
  }

  return [...byImageId.values()]
    .sort((a, b) => {
      const aHr =
        /-hr\.(jpg|jpeg|png|webp)$/i.test(a)
          ? 0
          : 1;

      const bHr =
        /-hr\.(jpg|jpeg|png|webp)$/i.test(b)
          ? 0
          : 1;

      return aHr - bHr;
    });
}

/* -------------------------------------------------------------------------- */
/* Payment, tax, terms                                                        */
/* -------------------------------------------------------------------------- */

function extractSection(
  visibleText,
  startLabel,
  endLabels = []
) {
  const endPattern = endLabels.length
    ? `(?=${endLabels.map(label => escapeRegex(label)).join("|")}|$)`
    : "$";

  const pattern = new RegExp(
    `(${escapeRegex(startLabel)}[\\s\\S]{0,7000}?)${endPattern}`,
    "i"
  );

  return matchFirst(visibleText, [pattern]);
}

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inferDate(monthDay = "", capturedAt = new Date()) {
  if (!monthDay) return null;

  if (/\b\d{4}\b/.test(monthDay)) {
    const parsed = new Date(`${monthDay} 12:00:00 UTC`);
    return Number.isNaN(parsed.getTime())
      ? null
      : parsed.toISOString().slice(0, 10);
  }

  const currentYear = capturedAt.getUTCFullYear();
  const parsed = new Date(
    `${monthDay}, ${currentYear} 12:00:00 UTC`
  );

  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString().slice(0, 10);
}

function buildBuyerPremium(rawText = "") {
  const hasTierTable =
    /\$1\s+to\s+\$25,?000/i.test(rawText) &&
    /\$25,?000\s+to\s+\$75,?000/i.test(rawText) &&
    /Above\s+\$75,?000/i.test(rawText);

  if (!hasTierTable) {
    return {
      type: "unknown",
      region: "",
      currency: "USD",
      ratePercent: null,
      capAmount: null,
      tiers: [],
      rawText: ""
    };
  }

  return {
    type: "tiered",
    region: "USA and Mexico",
    currency: "USD",
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
      "$1 to $25,000: 10% of final selling price, minimum $100. " +
      "$25,000 to $75,000: 5% of final selling price, minimum $2,500. " +
      "Above $75,000: $3,750."
  };
}

function extractPaymentDetails(
  evidenceText = "",
  capturedAt = new Date()
) {
  /*
   * IronPlanet/Firecrawl may return page fragments as separate
   * strings rather than one contiguous Payment Details section.
   *
   * Parse the verified facts from the complete evidence corpus.
   */
  const rawText = clean(evidenceText);

  const dueMonthDay = matchFirst(rawText, [
    /payment\s+is\s+due\s+on\s+or\s+before\s+([A-Z][a-z]+\s+\d{1,2}(?:,\s*\d{4})?)/i
  ]);

  const dueAt = inferDate(
    dueMonthDay,
    capturedAt
  );

  const relativeDays = toNumber(
    matchFirst(rawText, [
      /Within\s+(\d+)\s+days?\s+after\s+the\s+auction/i,
      /buyer\s+must\s+submit\s+full\s+payment[\s\S]{0,150}?within\s+(\d+)\s+days?/i,
      /payment\s+must\s+be\s+made\s+in\s+full\s+within\s+(\d+)\s+days?/i
    ])
  );

  const jurisdiction = matchFirst(rawText, [
    /subject\s+to\s+([A-Za-z .'-]+?)\s+sales\s+tax/i
  ]);

  const taxable =
    /subject\s+to\s+[A-Za-z .'-]+?\s+sales\s+tax/i.test(
      rawText
    )
      ? true
      : null;

  const hasFirstTier =
    /\$1\s+to\s+\$25,?000[\s\S]{0,180}?10%\s+of\s+the\s+final\s+selling\s+price[\s\S]{0,100}?(?:min(?:imum)?\s*\$?100|\$100)/i.test(
      rawText
    );

  const hasSecondTier =
    /\$25,?000\s+to\s+\$75,?000[\s\S]{0,180}?5%\s+of\s+the\s+final\s+selling\s+price[\s\S]{0,100}?(?:min(?:imum)?\s*\$?2,?500|\$2,?500)/i.test(
      rawText
    );

  const hasThirdTier =
    /Above\s+\$75,?000[\s\S]{0,120}?\$3,?750/i.test(
      rawText
    );

  const buyerPremium =
    hasFirstTier &&
    hasSecondTier &&
    hasThirdTier
      ? {
          type: "tiered",
          region: "USA and Mexico",
          currency: "USD",
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
            "$1 to $25,000: 10% of the final selling price, minimum $100. " +
            "$25,000 to $75,000: 5% of the final selling price, minimum $2,500. " +
            "Above $75,000: $3,750."
        }
      : {
          type: "unknown",
          region: "",
          currency: "USD",
          ratePercent: null,
          capAmount: null,
          tiers: [],
          rawText: ""
        };

  const wirePresent =
    /wire\s+transfer/i.test(rawText);

  const wireRecommended =
    /wire\s+transfer\s*\(recommended\)/i.test(
      rawText
    );

  const creditCardPresent =
    /credit\s+card/i.test(rawText);

  const creditCardAdditionalFee =
    /credit\s+card[\s\S]{0,120}?additional\s+fee/i.test(
      rawText
    );

  const options = [];

  if (wirePresent) {
    options.push({
      method: "wire_transfer",
      label: "Wire transfer",
      recommended: wireRecommended,
      additionalFee: false,
      additionalFeePercent: null
    });
  }

  if (creditCardPresent) {
    options.push({
      method: "credit_card",
      label: "Credit card",
      recommended: false,
      additionalFee: creditCardAdditionalFee,
      additionalFeePercent: null
    });
  }

  const bidsRetractable =
    /bids?\s+cannot\s+be\s+retracted/i.test(
      rawText
    )
      ? false
      : null;

  const bindingBusinessDays = toNumber(
    matchFirst(rawText, [
      /binding\s+until\s+(\d+)\s+business\s+days?\s+after\s+the\s+auction\s+ends/i
    ])
  );

  const lateFeePresent =
    /late\s+fees?/i.test(rawText);

  const defaultFeePresent =
    /failure\s+to\s+make\s+full\s+payment[\s\S]{0,120}?Default\s+Fee/i.test(
      rawText
    ) ||
    /Default\s+Fee/i.test(rawText);

  const specialFees = [];

  if (lateFeePresent) {
    specialFees.push({
      type: "late_fee",
      amount: null,
      ratePercent: null,
      rawText:
        "Late fees apply when full payment is not received by the due date."
    });
  }

  if (defaultFeePresent) {
    specialFees.push({
      type: "default_fee",
      amount: null,
      ratePercent: null,
      trigger: "failure_to_make_full_payment",
      rawText:
        "Failure to make full payment will result in a Default Fee."
    });
  }

  if (creditCardAdditionalFee) {
    specialFees.push({
      type: "credit_card_fee",
      amount: null,
      ratePercent: null,
      rawText:
        "An additional fee applies to credit card payments."
    });
  }

  const participationRequirements = [
    bidsRetractable === false
      ? "All bids cannot be retracted."
      : "",
    bindingBusinessDays !== null
      ? `Bids are binding until ${bindingBusinessDays} business days after the auction ends.`
      : ""
  ]
    .filter(Boolean)
    .join(" ");

  const section1031 = matchFirst(rawText, [
    /(For Buyers in the United States[\s\S]{0,1800}?section 1031[\s\S]{0,700}?(?:regulations\.|$))/i
  ]);

  return {
    buyerPremium,

    tax: {
      taxable,
      ratePercent: null,
      jurisdiction,
      rawText:
        taxable && jurisdiction
          ? `This item is subject to ${jurisdiction} sales tax.`
          : ""
    },

    specialFees,

    participationRequirements,

    payment: {
      dueAt,

      dueText:
        dueMonthDay
          ? `Payment is due on or before ${dueMonthDay}.`
          : "",

      dueRule:
        relativeDays !== null
          ? `Full payment, including applicable taxes and fees, is required within ${relativeDays} days after the auction.`
          : "",

      relativeDays,
      relativeBusinessDays: null,
      options,

      instructions:
        relativeDays !== null
          ? `The buyer must submit full payment, including applicable taxes and fees, within ${relativeDays} days after the auction to avoid late fees.`
          : "",

      electronicPaymentFeePercent: null,

      rawText: [
        relativeDays !== null
          ? `Full payment is required within ${relativeDays} days after the auction.`
          : "",
        dueMonthDay
          ? `Payment is due on or before ${dueMonthDay}.`
          : "",
        taxable && jurisdiction
          ? `This item is subject to ${jurisdiction} sales tax.`
          : "",
        wirePresent
          ? "Payment may be made by wire transfer."
          : "",
        creditCardPresent
          ? "Payment may be made by credit card."
          : "",
        creditCardAdditionalFee
          ? "An additional credit card fee applies."
          : ""
      ]
        .filter(Boolean)
        .join(" ")
    },

    biddingRules: {
      bidsRetractable,
      bindingUntilBusinessDaysAfterAuction:
        bindingBusinessDays
    },

    legalNotices:
      section1031
        ? [
            {
              type:
                "section_1031_like_kind_exchange",
              jurisdiction:
                "United States",
              rawText:
                section1031
            }
          ]
        : [],

    rawText
  };
}

function extractRemovalDetails(evidenceText = "") {
  const rawText = clean(evidenceText);

  const relativeBusinessDays = toNumber(
    matchFirst(rawText, [
      /must\s+be\s+picked\s+up\s+within\s+(\d+)\s+business\s+days?\s+of\s+the\s+auction/i
    ])
  );

  const buyerResponsibleForShipping =
    /Buyer\s+is\s+responsible\s+for\s+all\s+costs\s+related\s+to\s+transporting\s+the\s+item/i.test(
      rawText
    )
      ? true
      : null;

  const appointmentRequired =
    /You\s+must\s+call\s+at\s+least\s+24\s+hours\s+in\s+advance\s+to\s+schedule\s+pickup/i.test(
      rawText
    )
      ? true
      : null;

  const storageApplies =
    /buyer\s+will\s+incur\s+storage\s+charges/i.test(
      rawText
    );

  const noLoadingEquipment =
    /No\s+Loading\s+Dock,\s*Ramps,\s*or\s*Forklift\s+Available/i.test(
      rawText
    );

  const rampTrailerRequired =
    /Only\s+RGN\s+or\s+trailers\s+with\s+ramps\s+can\s+be\s+used\s+to\s+pick\s+up\s+this\s+item/i.test(
      rawText
    );

  const stepDeckRestricted =
    /Seller\s+will\s+not\s+allow\s+item\s+to\s+be\s+loaded\s+on\s+a\s+step-deck\s+or\s+flatbed\s+trailer\s+without\s+the\s+appropriate\s+ramps/i.test(
      rawText
    );

  const releaseRequired =
    /Driver\s+MUST\s+bring\s+a\s+copy\s+of\s+the\s+IronPlanet\s+Item\s+Release/i.test(
      rawText
    );

  const instructions = [
    buyerResponsibleForShipping
      ? "Buyer is responsible for all costs related to transporting the item."
      : "",

    relativeBusinessDays !== null
      ? `Item must be picked up within ${relativeBusinessDays} business days of the auction.`
      : "",

    storageApplies
      ? "Storage charges apply when the item is not picked up by the deadline."
      : "",

    appointmentRequired
      ? "Buyer must call at least 24 hours in advance to schedule pickup."
      : "",

    noLoadingEquipment
      ? "No loading dock, ramps, or forklift are available at this location."
      : "",

    rampTrailerRequired
      ? "Only an RGN or trailer with ramps may be used for pickup."
      : "",

    stepDeckRestricted
      ? "The seller will not load the item onto a step-deck or flatbed trailer without appropriate ramps."
      : "",

    releaseRequired
      ? "The driver must bring a copy of the IronPlanet Item Release."
      : ""
  ]
    .filter(Boolean)
    .join(" ");

  return {
    deadlineAt: null,

    deadlineText:
      relativeBusinessDays !== null
        ? `Pickup required within ${relativeBusinessDays} business days of the auction.`
        : "",

    relativeDays: null,
    relativeBusinessDays,

    instructions,

    appointmentRequired,

    loadingAssistance:
      noLoadingEquipment
        ? false
        : null,

    loadingDockAvailable:
      noLoadingEquipment
        ? false
        : null,

    rampsAvailable:
      noLoadingEquipment
        ? false
        : null,

    forkliftAvailable:
      noLoadingEquipment
        ? false
        : null,

    requiredTrailerType:
      rampTrailerRequired
        ? "RGN or trailer with ramps"
        : "",

    prohibitedTrailerTypes:
      stepDeckRestricted
        ? [
            "step-deck without ramps",
            "flatbed without ramps"
          ]
        : [],

    itemReleaseRequired:
      releaseRequired
        ? true
        : null,

    storageFeeText:
      storageApplies
        ? "Storage charges apply if the item is not picked up within 8 business days of the auction."
        : "",

    rawText: instructions,

    removalAtBuyerExpense:
      buyerResponsibleForShipping,

    buyerResponsibleForShipping
  };
}

function extractLinks($, sourceUrl) {
  const termsLinks = [];
  const documents = [];
  const inspectionLinks = [];

  $("a[href]").each((_, node) => {
    const href = clean($(node).attr("href"));
    const label = clean($(node).text());
    const url = absoluteUrl(href, sourceUrl);

    if (!url) return;

    if (
      /terms|payment|shipping|removal|buyer|fee|tax/i.test(
        `${label} ${href}`
      )
    ) {
      termsLinks.push(url);
    }

    if (/\.pdf(?:$|\?)/i.test(url)) {
      documents.push({
        label: label || "Document",
        url
      });
    }

    if (
      /inspection|ironclad assurance|report/i.test(
        `${label} ${href}`
      )
    ) {
      inspectionLinks.push({
        label: label || "Inspection Report",
        url
      });
    }
  });

  return {
    termsLinks: unique(termsLinks),

    documents: documents.filter(
      (document, index, all) =>
        all.findIndex(item => item.url === document.url) === index
    ),

    inspectionLinks: inspectionLinks.filter(
      (link, index, all) =>
        all.findIndex(item => item.url === link.url) === index
    )
  };
}

function normalizeIronPlanetTimezone(value = "") {
  const timezone = clean(value).toUpperCase();

  const offsets = {
    PDT: "-07:00",
    PST: "-08:00",
    MDT: "-06:00",
    MST: "-07:00",
    CDT: "-05:00",
    CST: "-06:00",
    EDT: "-04:00",
    EST: "-05:00"
  };

  return {
    abbreviation: timezone,
    offset: offsets[timezone] || ""
  };
}

function inferAuctionYear(monthDay = "", capturedAt = new Date()) {
  const parsedMonthDay = new Date(
    `${monthDay}, ${capturedAt.getUTCFullYear()} 12:00:00 UTC`
  );

  if (Number.isNaN(parsedMonthDay.getTime())) {
    return capturedAt.getUTCFullYear();
  }

  return capturedAt.getUTCFullYear();
}

function buildAuctionDateTime({
  monthDay = "",
  time = "",
  timezone = "",
  capturedAt = new Date()
} = {}) {
  if (!monthDay || !time) {
    return "";
  }

  const year = inferAuctionYear(
    monthDay,
    capturedAt
  );

  const zone =
    normalizeIronPlanetTimezone(
      timezone
    );

  const parsed = new Date(
    `${monthDay}, ${year} ${time} ${timezone}`
  );

  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  /*
   * Preserve a deterministic ISO-style local value if the
   * JavaScript runtime cannot parse the abbreviation.
   */
  const localParsed = new Date(
    `${monthDay}, ${year} ${time}`
  );

  if (Number.isNaN(localParsed.getTime())) {
    return "";
  }

  const yyyy = String(year);
  const mm = String(
    localParsed.getMonth() + 1
  ).padStart(2, "0");
  const dd = String(
    localParsed.getDate()
  ).padStart(2, "0");
  const hh = String(
    localParsed.getHours()
  ).padStart(2, "0");
  const min = String(
    localParsed.getMinutes()
  ).padStart(2, "0");

  return (
    `${yyyy}-${mm}-${dd}T${hh}:${min}:00` +
    `${zone.offset}`
  );
}

function extractAuctionHeader(
  evidenceText = "",
  capturedAt = new Date()
) {
  const rawText = clean(evidenceText);

  const dateMatch = rawText.match(
    /Auction\s+Date\s+([A-Z][a-z]{2}\s+\d{1,2}),\s*(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)\s*([A-Z]{3})/i
  );

  const monthDay =
    clean(dateMatch?.[1]);

  const startTime =
    clean(dateMatch?.[2]);

  const endTime =
    clean(dateMatch?.[3]);

  const timezone =
    clean(dateMatch?.[4]).toUpperCase();

  const startsAt = buildAuctionDateTime({
    monthDay,
    time: startTime,
    timezone,
    capturedAt
  });

  const endsAt = buildAuctionDateTime({
    monthDay,
    time: endTime,
    timezone,
    capturedAt
  });

  const openingBid = toNumber(
    matchFirst(rawText, [
      /Starting\s+Bid\s+US\s*\$?\s*([\d,]+(?:\.\d{2})?)/i
    ])
  );

  const increment = toNumber(
    matchFirst(rawText, [
      /Bid\s+Increment\s+US\s*\$?\s*([\d,]+(?:\.\d{2})?)/i
    ])
  );

  const watcherCount = toNumber(
    matchFirst(rawText, [
      /\b(\d+)\s+watchers?\b/i
    ])
  );

  return {
    dateText:
      dateMatch
        ? `${monthDay}, ${startTime} - ${endTime} ${timezone}`
        : "",

    startsAt,
    endsAt,
    timezone,

    openingBid,
    increment,
    watcherCount,

    rawText: first(
      dateMatch?.[0],
      openingBid !== null
        ? `Starting Bid US $${openingBid.toLocaleString("en-US")}`
        : "",
      increment !== null
        ? `Bid Increment US $${increment.toLocaleString("en-US")}`
        : ""
    )
  };
}

/* -------------------------------------------------------------------------- */
/* Canonical output                                                           */
/* -------------------------------------------------------------------------- */

function buildAuctionRules(auctionTerms) {
  const buyerPremium =
    auctionTerms.buyerPremium || {};

  return {
    buyerPremium: {
      ...buyerPremium,
      purchaseTiers: Array.isArray(buyerPremium.tiers)
        ? buyerPremium.tiers.map(tier => ({
            minAmount: tier.minAmount ?? 0,
            minAmountExclusive:
              tier.minAmountExclusive ?? null,
            maxAmount: tier.maxAmount ?? null,
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
      exemptionAllowed: null,
      exemptionCertificateRequired: null,
      exporterExemptionPossible: null,
      possessionInUnitedStatesTaxable: null
    },

    removal: {
      ...auctionTerms.removal
    }
  };
}

function parseIronPlanetV2Html({
  html = "",
  url = "",
  sourceUrl = "",
  capture = {},
  capturedAt = new Date()
} = {}) {
  if (!clean(html)) {
    throw new Error(
      "parseIronPlanetV2Html requires captured HTML."
    );
  }

  const resolvedUrl =
    clean(url || sourceUrl || capture?.url);

  if (
    resolvedUrl &&
    !isIronPlanetUrl(resolvedUrl)
  ) {
    throw new Error(
      `Not an IronPlanet URL: ${resolvedUrl}`
    );
  }

  url = resolvedUrl;

  const $ = cheerio.load(html);

  const visibleText =
    buildIronPlanetEvidenceText({
      html,
      capture
    });

  const candidates =
    collectStructuredCandidates($);

  const titleEvidence = extractTitle(
    $,
    candidates,
    visibleText
  );

  const title = titleEvidence.value;
  const titleParts = parseTitleParts(title);

  const itemEvidence = extractItemNumber(
    $,
    candidates,
    visibleText,
    url
  );

  const lotNumber = itemEvidence.value;

  const hours = extractHours(
    $,
    candidates,
    visibleText
  );

  const serialNumber = extractSerialNumber(
    $,
    candidates,
    visibleText
  );

  const priceText = extractPrice(
    $,
    candidates,
    visibleText
  );

  const currentBid = toNumber(priceText);

  const description = extractDescription(
    $,
    candidates,
    title
  );

  const location = extractLocation(
    $,
    candidates,
    visibleText
  );

  const photos = extractPhotos(
    $,
    html,
    candidates
  );

  const paymentDetails = extractPaymentDetails(
    visibleText,
    capturedAt instanceof Date
      ? capturedAt
      : new Date(capturedAt)
  );

  const removal = extractRemovalDetails(
    visibleText
  );

  const auctionHeader =
    extractAuctionHeader(
      visibleText,
      capturedAt instanceof Date
        ? capturedAt
        : new Date(capturedAt)
    );

  const linkEvidence = extractLinks(
    $,
    url
  );

  const assuranceName = matchFirst(visibleText, [
    /\b(IronClad Assurance(?:®)?)\b/i,
    /\b(Inspected and Guaranteed)\b/i
  ]);

  const inspection = {
    provider: SOURCE_LABEL,
    available:
      linkEvidence.inspectionLinks.length > 0 ||
      /inspection report|ironclad assurance|inspected and guaranteed/i.test(
        visibleText
      ),
    assuranceName,
    reportUrl:
      linkEvidence.inspectionLinks.find(link =>
        /inspection|report/i.test(link.label)
      )?.url || "",
    documentUrls:
      linkEvidence.inspectionLinks.map(
        link => link.url
      ),
    mediaUrls: [],
    rawText:
      assuranceName ||
      (
        /inspection report/i.test(
          visibleText
        )
          ? "IronPlanet inspection report available."
          : ""
      )
  };

  const auctionTerms = {
    buyerPremium:
      paymentDetails.buyerPremium,

    tax:
      paymentDetails.tax,

    specialFees:
      paymentDetails.specialFees,

    participationRequirements:
      paymentDetails.participationRequirements,

    payment:
      paymentDetails.payment,

    removal,

    inspection: {
      datesText: "",
      instructions:
        inspection.rawText
    },

    checkout: {
      datesText: "",
      instructions:
        paymentDetails.payment.instructions
    },

    shipping: {
      available: null,
      buyerResponsible:
        removal.buyerResponsibleForShipping,
      instructions: ""
    },

    termsLinks:
      linkEvidence.termsLinks,

    documents:
      linkEvidence.documents,

    biddingRules:
      paymentDetails.biddingRules,

    legalNotices:
      paymentDetails.legalNotices,

    specialTerms:
      paymentDetails.participationRequirements,

    fullTermsText: [
      paymentDetails.rawText,
      removal.rawText,
      inspection.rawText
    ]
      .filter(Boolean)
      .join(" ")
  };

  const auctionRules =
    buildAuctionRules(auctionTerms);

  const canonicalLotId = lotNumber
    ? `ironplanet-${lotNumber}`
    : "";

  const machine = {
    title,
    year: titleParts.year,
    make: titleParts.make.toUpperCase(),
    model: titleParts.model.toUpperCase(),
    category: first(
      extractLabelValue($, [
        "Category",
        "Equipment Type"
      ]),
      matchFirst(url, [
        /\/for-sale\/([^/]+)-/i
      ]).replace(/-/g, " ")
    ),
    price:
      currentBid !== null
        ? String(currentBid)
        : "",
    hours,
    location: location.label,
    city: location.city,
    state: location.state,
    serialNumber,
    stockNumber: "",
    description,
    photos
  };

  const auctionEvent = {
    id: "",
    name: "",
    format: "timed_auction",

    /*
     * Event participation is not a legal-terms display field.
     * IronPlanet bid restrictions remain under auctionTerms.
     */
    participation: "",

    location: {
      label: "",
      city: "",
      state: "",
      country: "",
      address: "",
      postalCode: ""
    },

    dateText:
      auctionHeader.dateText,

    startsAt:
      auctionHeader.startsAt,

    endsAt:
      auctionHeader.endsAt,

    timezone:
      auctionHeader.timezone
  };

  /*
   * IronPlanet labels this value "Item Number".
   * IXI preserves the existing canonical field name: lot.number.
   */
  const auctionLot = {
    id: canonicalLotId,
    sourceLotId: lotNumber,
    lotId: canonicalLotId,
    lotNumber,
    number: lotNumber,
    saleOrder: null,
    scheduledCloseAt: "",
    actualCloseAt: "",
    timezone: "",
    openingBid:
      auctionHeader.openingBid,

    currentBid,

    /*
     * Watchers are not bids. Keep bidCount null.
     */
    bidCount: null,

    watcherCount:
      auctionHeader.watcherCount,

    buyNowPrice: null,

    increment:
      auctionHeader.increment,

    reserveMet: null,
    currency: "USD",
    status: "",
    machineLocation: {
      label: location.label,
      city: location.city,
      state: location.state,
      country: location.country,
      address: "",
      postalCode: ""
    },
    sourceUrl: url
  };

  const auction = {
    provider: PLATFORM,
    platform: PLATFORM,
    providerListingId: canonicalLotId,
    providerUrl: url,

    company: {
      id: "ritchie-bros-auctioneers",
      name: SOURCE_LABEL,
      url: "https://www.ironplanet.com"
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
        auctionHeader.timezone,

      startsAt:
        auctionHeader.startsAt,

      endsAt:
        auctionHeader.endsAt,

      scheduledCloseAt:
        auctionHeader.endsAt,

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

    terms: auctionTerms,
    auctionRules,

    source: {
      url,
      type: PLATFORM,
      platform: PLATFORM,
      scrapedAt:
        (
          capturedAt instanceof Date
            ? capturedAt
            : new Date(capturedAt)
        ).toISOString(),
      updatedAt: "",
      parserVersion: PARSER_VERSION
    }
  };

  const confidenceChecks = {
    structuredData:
      candidates.length > 0,
    company: true,
    lotNumber:
      !!lotNumber,
    paymentDue:
      !!paymentDetails.payment.dueText,
    tax:
      paymentDetails.tax.taxable !== null,
    machineLocation:
      !!location.label
  };

  const passedChecks =
    Object.values(confidenceChecks)
      .filter(Boolean)
      .length;

  return {
    ok: true,

    source: {
      type: PLATFORM,
      label: SOURCE_LABEL,
      platform: PLATFORM,
      url
    },

    acquisition: {
      adapter: PARSER_VERSION,
      method: "captured-html-parser",
      source: PLATFORM,
      platform: PLATFORM,
      parserVersion: PARSER_VERSION
    },

    machine,
    media: photos,
    inspection,

    auctionEvent,
    auctionLot,
    auction,
    auctionTerms,

    launchPolicy: {
      forcedDestination: "auction",
      allowedDestinations: [
        "auction"
      ],
      destinationLocked: true
    },

    rawAuctionEvidence: {
      structuredDataFound:
        candidates.length > 0,

      sourcePaths: {
        title:
          titleEvidence.path,
        itemNumber:
          itemEvidence.path
      },

      sourceListingId:
        lotNumber,

      lotNumber,

      pagePaymentText:
        paymentDetails.rawText,

      pageRemovalText:
        removal.rawText,

      pageAuctionHeader: {
        dateText:
          auctionHeader.dateText,
        startsAt:
          auctionHeader.startsAt,
        endsAt:
          auctionHeader.endsAt,
        timezone:
          auctionHeader.timezone,
        openingBid:
          auctionHeader.openingBid,
        increment:
          auctionHeader.increment,
        watcherCount:
          auctionHeader.watcherCount
      },

      evidenceChecks: {
        paymentDetails:
          /Payment Details/i.test(
            visibleText
          ),

        paymentDueDate:
          /payment is due on or before/i.test(
            visibleText
          ),

        transactionFee:
          /Transaction Fee/i.test(
            visibleText
          ),

        georgiaSalesTax:
          /Georgia sales tax/i.test(
            visibleText
          ),

        defaultFee:
          /Default Fee/i.test(
            visibleText
          ),

        bindingTwoBusinessDays:
          /binding until 2 business days/i.test(
            visibleText
          ),

        removalDetails:
          /Removal Details/i.test(
            visibleText
          ),

        inspectionReport:
          /Inspection Report/i.test(
            visibleText
          )
      },

      sourceUrl:
        url
    },

    confidence: {
      auction: {
        score: Number(
          (
            passedChecks /
            Object.keys(confidenceChecks).length
          ).toFixed(2)
        ),
        checks:
          confidenceChecks
      },

      title:
        title ? "parsed" : "missing",

      price:
        currentBid !== null
          ? "parsed"
          : "missing",

      hours:
        hours ? "parsed" : "missing",

      serialNumber:
        serialNumber
          ? "parsed"
          : "missing",

      stockNumber:
        "missing",

      location:
        location.label
          ? "parsed"
          : "missing",

      photos:
        photos.length
          ? "parsed"
          : "missing"
    }
  };
}

module.exports = {
  parseIronPlanetV2Html,
  isIronPlanetUrl,

  _internals: {
    extractPaymentDetails,
    extractRemovalDetails,
    extractPhotos,
    extractItemNumber,
    collectStructuredCandidates,
    buildAuctionRules
  }
};
