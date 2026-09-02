const cheerio = require("cheerio");

const {
  applyAuctionDoctrine
} = require("../doctrine/applyAuctionDoctrine");

const {
  applyIdentityToParsedListing
} = require("./applyIdentityToParsedListing");

const PROXIBID_HOSTS = new Set([
  "www.proxibid.com",
  "proxibid.com"
]);

function cleanText(value = "") {
  return String(value || "")
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

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = String(value)
    .replace(/[$,%\s,]/g, "")
    .trim();

  if (!normalized) return null;

  const result = Number(normalized);

  return Number.isFinite(result)
    ? result
    : null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const cleaned = cleanText(value);

    if (cleaned) {
      return cleaned;
    }
  }

  return "";
}

function firstMatch(text, patterns = []) {
  const source = String(text || "");

  for (const pattern of patterns) {
    const match = source.match(pattern);

    if (match?.[1]) {
      return cleanText(match[1]);
    }
  }

  return "";
}

function normalizeAbsoluteUrl(value, baseUrl = "https://www.proxibid.com") {
  const input = cleanText(value);

  if (!input) return "";

  try {
    return new URL(input, baseUrl).toString();
  } catch {
    return "";
  }
}

function isProxibidUrl(url = "") {
  try {
    return PROXIBID_HOSTS.has(
      new URL(url).hostname.toLowerCase()
    );
  } catch {
    return false;
  }
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

function normalizeImageUrl(value = "") {
  const absoluteUrl =
    normalizeAbsoluteUrl(value);

  if (!absoluteUrl) return "";

  try {
    const parsed = new URL(absoluteUrl);

    if (
      parsed.hostname.toLowerCase() !==
      "images.proxibid.com"
    ) {
      return "";
    }

    parsed.protocol = "https:";

    let pathname = parsed.pathname;

    /*
     * Proxibid pages may reference fonts and other assets
     * from images.proxibid.com. Only actual image files
     * belong in the machine gallery.
     */
    if (
      !/\.(?:jpe?g|png|webp|gif|avif)$/i.test(
        pathname
      )
    ) {
      return "";
    }

    pathname = pathname
      .replace(
        /\/(?:Thumb|Thumbnail|LotSelector|FullSize)\//i,
        "/FullDetail/"
      )
      .replace(
        /\/FullDetail\/+/i,
        "/FullDetail/"
      );

    parsed.pathname = pathname;

    return parsed.toString();
  } catch {
    return "";
  }
}

function getElementText($, selectors = []) {
  for (const selector of selectors) {
    const value = cleanText(
      $(selector)
        .first()
        .text()
    );

    if (value) {
      return value;
    }
  }

  return "";
}

function getMetaContent($, selectors = []) {
  for (const selector of selectors) {
    const value = cleanText(
      $(selector)
        .first()
        .attr("content")
    );

    if (value) {
      return value;
    }
  }

  return "";
}

function extractScriptValue(html, patterns = []) {
  return firstMatch(html, patterns);
}

function parseAuctionContext(html) {
  const auctionId = extractScriptValue(html, [
    /auctionId\s*:\s*["']([^"']+)["']/i,
    /["']auctionId["']\s*:\s*["']([^"']+)["']/i
  ]);

  const auctionHouseId = extractScriptValue(html, [
    /auctionHouseId\s*:\s*["']([^"']+)["']/i,
    /["']auctionHouseId["']\s*:\s*["']([^"']+)["']/i
  ]);

  const auctionHouseName = extractScriptValue(html, [
    /auctionHouseName\s*:\s*["']([^"']+)["']/i,
    /["']auctionHouseName["']\s*:\s*["']([^"']+)["']/i
  ]);

  const auctionType = extractScriptValue(html, [
    /auctionType\s*:\s*["']([^"']+)["']/i,
    /["']auctionType["']\s*:\s*["']([^"']+)["']/i
  ]);

  const lotId = extractScriptValue(html, [
    /\bvar\s+lotId\s*=\s*["']?(\d+)["']?/i,
    /["']lotId["']\s*:\s*["']?(\d+)["']?/i
  ]);

  return {
    auctionId,
    auctionHouseId,
    auctionHouseName,
    auctionType,
    lotId
  };
}

function parseLabelValuePairs($, rootSelector) {
  const result = {};

  $(rootSelector).each((_, element) => {
    const area = $(element);
    const children = area.children();

    children.each((index, child) => {
      const node = $(child);

      if (
        child.tagName?.toLowerCase() !== "span"
      ) {
        return;
      }

      const label = cleanText(node.text());

      if (!label.endsWith(":")) {
        return;
      }

      let value = "";
      let sibling = node.next();

      while (sibling.length) {
        const siblingTag =
          sibling.get(0)?.tagName?.toLowerCase();

        if (siblingTag === "br") {
          break;
        }

        value = cleanText(
          `${value} ${sibling.text()}`
        );

        sibling = sibling.next();
      }

      const key = label
        .replace(/:\s*$/, "")
        .trim()
        .toLowerCase();

      if (key && value) {
        result[key] = value;
      }
    });
  });

  return result;
}

function parseTermsAreas($) {
  const pairs = parseLabelValuePairs(
    $,
    ".lotDetailTermsArea"
  );

  let specialTerms = "";

  $(".lotDetailTermsArea").each((_, element) => {
    const area = $(element);
    const text = cleanText(area.text());

    if (
      /^special terms\b/i.test(text) ||
      area.find(".lotDetailSpecialTermsArea").length
    ) {
      specialTerms = cleanText(
        area
          .find(".lotDetailSpecialTermsArea")
          .first()
          .text()
      );

      if (!specialTerms) {
        specialTerms = text.replace(
          /^special terms\s*/i,
          ""
        );
      }
    }
  });

  const allTermsText = unique(
    $(".lotDetailTermsArea")
      .map((_, element) =>
        cleanText($(element).text())
      )
      .get()
  ).join("\n\n");

  return {
    pairs,
    specialTerms,
    allTermsText
  };
}

function parseBuyerPremium({
  internetPremiumText,
  paymentInstructions
}) {
  const combinedText = cleanText(
    `${internetPremiumText} ${paymentInstructions}`
  );

  const purchaseTiers = [];

  const aboveMatch = combinedText.match(
    /for each unit\s+\$?\s*([\d,]+(?:\.\d+)?)\s+and above,\s+a\s+(\d+(?:\.\d+)?)\s*%\s+administration fee[\s\S]{0,180}?standard fee of\s+(\d+(?:\.\d+)?)\s*%[\s\S]{0,80}?credit card/i
  );

  if (aboveMatch) {
    purchaseTiers.push({
      minAmount: toNumber(aboveMatch[1]),
      maxAmount: null,
      cashCheckWireRatePercent:
        toNumber(aboveMatch[2]),
      creditCardRatePercent:
        toNumber(aboveMatch[3])
    });
  }

  const rangePattern =
    /for each unit\s+\$?\s*([\d,]+(?:\.\d+)?)\s*-\s*\$?\s*([\d,]+(?:\.\d+)?),\s+a\s+(\d+(?:\.\d+)?)\s*%\s+administration fee[\s\S]{0,180}?standard fee of\s+(\d+(?:\.\d+)?)\s*%[\s\S]{0,80}?credit card/gi;

  let rangeMatch;

  while (
    (rangeMatch =
      rangePattern.exec(combinedText)) !== null
  ) {
    purchaseTiers.push({
      minAmount:
        toNumber(rangeMatch[1]),

      maxAmount:
        toNumber(rangeMatch[2]),

      cashCheckWireRatePercent:
        toNumber(rangeMatch[3]),

      creditCardRatePercent:
        toNumber(rangeMatch[4])
    });
  }

  purchaseTiers.sort((left, right) => {
    return (
      (left.minAmount || 0) -
      (right.minAmount || 0)
    );
  });

  const internetMatch =
    combinedText.match(
      /additional\s+(\d+(?:\.\d+)?)\s*%\s+internet buyers?\s+fee[\s\S]{0,120}?\$?\s*([\d,]+(?:\.\d+)?)\s+per item cap/i
    );

  const internetAdditionalRatePercent =
    internetMatch
      ? toNumber(internetMatch[1])
      : null;

  const internetAdditionalCapAmount =
    internetMatch
      ? toNumber(internetMatch[2])
      : null;

  const onlineRateText = firstMatch(
    combinedText,
    [
      /online buyers? premium(?:\s+is|\s*:)?\s*(\d+(?:\.\d+)?)\s*%/i,
      /internet buyers?.{0,80}?total premium(?:\s+would be|\s*:)?\s*(\d+(?:\.\d+)?)\s*%/i,
      /internet premium.{0,80}?(\d+(?:\.\d+)?)\s*%/i
    ]
  );

  const ratePercent =
    toNumber(onlineRateText);

  const capText = firstMatch(
    combinedText,
    [
      /online buyers? premium.{0,100}?capped at\s*\$?\s*([\d,]+(?:\.\d+)?)/i,
      /total premium.{0,100}?capped at\s*\$?\s*([\d,]+(?:\.\d+)?)/i,
      /premium.{0,80}?capped at\s*\$?\s*([\d,]+(?:\.\d+)?)/i
    ]
  );

  const capAmount = toNumber(capText);

  const legacyTiers = [];

  const onSiteMatch = combinedText.match(
    /(\d+(?:\.\d+)?)\s*%\s*buyers? premium applies for on-site buyers.*?capped at\s*\$?\s*([\d,]+(?:\.\d+)?)/i
  );

  if (onSiteMatch) {
    legacyTiers.push({
      name: "onSite",
      ratePercent:
        toNumber(onSiteMatch[1]),
      capAmount:
        toNumber(onSiteMatch[2])
    });
  }

  if (
    internetAdditionalRatePercent !== null
  ) {
    legacyTiers.push({
      name: "internetAdditional",
      ratePercent:
        internetAdditionalRatePercent,
      capAmount:
        internetAdditionalCapAmount
    });
  }

  let type = "unknown";

  if (
    purchaseTiers.length > 0 ||
    /tiered/i.test(internetPremiumText)
  ) {
    type = "tiered";
  } else if (
    ratePercent !== null &&
    capAmount !== null
  ) {
    type = "capped";
  } else if (ratePercent !== null) {
    type = "flat";
  }

  return {
    type,

    ratePercent,
    capAmount,

    tiers:
      purchaseTiers.length > 0
        ? purchaseTiers
        : legacyTiers,

    purchaseTiers,

    internetAdditional: {
      ratePercent:
        internetAdditionalRatePercent,

      capAmount:
        internetAdditionalCapAmount,

      perItem:
        internetAdditionalCapAmount !== null
    },

    rawText: combinedText
  };
}



function parseTax({
  paymentInstructions,
  allTermsText
}) {
  const combinedText = cleanText(
    `${paymentInstructions} ${allTermsText}`
  );

  const rawText = firstMatch(
    combinedText,
    [
      /(sales tax\s*:?.{0,700}?)(?=motor vehicles?|no sale shall|currency type|shipping instructions|payment instructions|$)/i
    ]
  );

  const rateText = firstMatch(
    rawText,
    [
      /(?:sales tax|tax rate)\s*:?.{0,50}?(\d+(?:\.\d+)?)\s*%/i
    ]
  );

  const ratePercent =
    toNumber(rateText);

  let taxable = null;

  if (
    /all sales are subject to sales tax/i.test(
      combinedText
    ) ||
    /subject to state and local sales tax/i.test(
      combinedText
    ) ||
    /sales tax applies/i.test(
      combinedText
    )
  ) {
    taxable = true;
  }

  /*
   * Do not interpret "tax exempt entities" or
   * "sales tax exemptions" as meaning the sale
   * itself is tax-free.
   */
  if (
    /\bno sales tax\b/i.test(
      combinedText
    ) ||
    /\bsales tax will not be charged\b/i.test(
      combinedText
    )
  ) {
    taxable = false;
  }

  const exemptionAllowed =
    /valid exemption certificate/i.test(
      combinedText
    ) ||
    /tax exempt entities/i.test(
      combinedText
    );

  const exemptionCertificateRequired =
    /must present a copy of their certificate/i.test(
      combinedText
    ) ||
    /must have their exemption number and state form/i.test(
      combinedText
    );

  const exporterExemptionPossible =
    /bill of lading/i.test(
      combinedText
    ) &&
    /export/i.test(
      combinedText
    );

  const possessionInUnitedStatesTaxable =
    /if you take possession of your purchase in the united states,\s*you must pay sales tax/i.test(
      combinedText
    );

  return {
    taxable,
    ratePercent,
    jurisdiction: "",

    exemptionAllowed,
    exemptionCertificateRequired,
    exporterExemptionPossible,
    possessionInUnitedStatesTaxable,

    rawText:
      rawText ||
      (
        taxable === true
          ? "Sales tax applies. Rate depends on jurisdiction and exemption status."
          : ""
      )
  };
}



function parsePaymentDeadline({
  paymentInstructions,
  checkoutText,
  specialTerms,
  saleDateText
}) {
  const combinedText = cleanText(
    `${paymentInstructions} ${checkoutText} ${specialTerms}`
  );

  const dueText = firstMatch(
    combinedText,
    [
      /(full payment is due within\s+\d+\s+business days?[^.]*\.?)/i,
      /(purchases must be paid within\s+\d+\s+business days?[^.]*\.?)/i,
      /(purchases must be paid within\s+\d+\s+days?[^.]*\.?)/i,
      /(all purchases must be settled for sale day\.?)/i,
      /(payment[^.]{0,100}?due[^.]{0,160})/i,
      /(payment[^.]{0,100}?must be received[^.]{0,160})/i,
      /(invoice[^.]{0,100}?due[^.]{0,160})/i
    ]
  );

  const businessDaysMatch =
    combinedText.match(
      /(?:full payment is due|purchases must be paid)\s+within\s+(\d+)\s+business days?/i
    );

  const calendarDaysMatch =
    combinedText.match(
      /(?:full payment is due|purchases must be paid)\s+within\s+(\d+)\s+days?/i
    );

  const relativeBusinessDays =
    businessDaysMatch
      ? toNumber(businessDaysMatch[1])
      : null;

  const relativeDays =
    relativeBusinessDays === null &&
    calendarDaysMatch
      ? toNumber(calendarDaysMatch[1])
      : null;

  const creditCardLimitMatch =
    combinedText.match(
      /credit card payments? cannot exceed\s*\$?\s*([\d,]+(?:\.\d+)?)/i
    );

  const creditCardLimit =
    creditCardLimitMatch
      ? toNumber(
          creditCardLimitMatch[1]
        )
      : null;

  const saleDayMethods = [];

  if (
    /all payments\s*\(including cash,\s*certified check\s*&\s*credit card\)\s*will only be accepted on sale day/i.test(
      combinedText
    )
  ) {
    saleDayMethods.push(
      "Cash",
      "Certified Check",
      "Credit Card"
    );
  }

  const afterSaleMethods = [];

  if (
    /after the sale day,\s*all items must be paid for with wire transfer or credit card/i.test(
      combinedText
    )
  ) {
    afterSaleMethods.push(
      "Wire Transfer",
      "Credit Card"
    );
  }

  let dueRule = "";

  if (
    /settled for sale day/i.test(
      dueText
    )
  ) {
    dueRule = "sale-day";
  } else if (
    relativeBusinessDays !== null
  ) {
    dueRule =
      "relative-business-days";
  } else if (
    relativeDays !== null
  ) {
    dueRule =
      "relative-days";
  } else if (
    /within\s+\d+\s+hours?/i.test(
      dueText
    )
  ) {
    dueRule =
      "relative-hours";
  } else if (dueText) {
    dueRule =
      "source-text";
  }

  return {
    dueAt: null,
    dueText,
    dueRule,

    relativeBusinessDays,
    relativeDays,

    creditCardLimit,

    saleDayMethods,
    afterSaleMethods,

    saleDateText:
      cleanText(saleDateText),

    rawText:
      combinedText
  };
}


function parseRemovalDeadline({
  shippingInstructions,
  checkoutText,
  saleEndAt
}) {
  const combinedText = cleanText(
    `${shippingInstructions} ${checkoutText}`
  );

  const deadlineText = firstMatch(
    combinedText,
    [
      /(purchases must be removed[^.]*\.)/i,
      /(all equipment must be removed[^.]*\.)/i,
      /(items? must be removed[^.]*\.)/i,
      /(removal[^.]{0,160}?(?:within|by|before)[^.]*\.)/i
    ]
  );

  let relativeDays = null;

  const weeksMatch =
    combinedText.match(
      /removed\s+(?:within\s+)?(\d+|one|two|three|four)\s+weeks?\s+(?:after|of)\s+the\s+sale(?:\s+date)?/i
    );

  if (weeksMatch) {
    const wordMap = {
      one: 1,
      two: 2,
      three: 3,
      four: 4
    };

    const value =
      String(
        weeksMatch[1]
      ).toLowerCase();

    const weeks =
      wordMap[value] ||
      toNumber(value);

    if (weeks !== null) {
      relativeDays =
        weeks * 7;
    }
  }

  const daysMatch =
    combinedText.match(
      /removed\s+from the sale site\s+within\s+(\d+)\s+days?\s+of\s+the\s+sale\s+date/i
    ) ||
    combinedText.match(
      /removed\s+(?:from the sale site\s+)?within\s+(\d+)\s+days?\s+(?:after|of)\s+the\s+sale(?:\s+date)?/i
    ) ||
    combinedText.match(
      /remaining on the grounds after\s+(\d+)\s+days?/i
    );

  if (daysMatch) {
    relativeDays =
      toNumber(daysMatch[1]);
  }

  const storageFeeMatch =
    combinedText.match(
      /(?:storage fees?|late fee)[^$]{0,100}\$?\s*([\d,]+(?:\.\d+)?)\s+per day(?:\s+per item)?/i
    );

  const storageFeePerDay =
    storageFeeMatch
      ? toNumber(
          storageFeeMatch[1]
        )
      : null;

  const storageFeePerItem =
    /per day per item/i.test(
      combinedText
    );

  const buyerResponsibleForShipping =
    /shipping arrangements and cost are the buyers? sole responsibility/i.test(
      combinedText
    );

  const removalAtBuyerExpense =
    /removed at the buyers? expense/i.test(
      combinedText
    );

  let deadlineAt = null;

  if (
    saleEndAt &&
    relativeDays !== null
  ) {
    const date =
      new Date(saleEndAt);

    if (
      !Number.isNaN(
        date.getTime()
      )
    ) {
      date.setUTCDate(
        date.getUTCDate() +
        relativeDays
      );

      deadlineAt =
        date.toISOString();
    }
  }

  return {
    deadlineAt,
    deadlineText,
    relativeDays,

    storageFeePerDay,
    storageFeePerItem,

    buyerResponsibleForShipping,
    removalAtBuyerExpense,

    rawText:
      combinedText
  };
}


function parseAcceptedPayments(
  paymentOptions,
  paymentInstructions
) {
  const source = cleanText(
    `${paymentOptions}, ${paymentInstructions}`
  );

  const candidates = [
    ["Visa", /\bvisa\b/i],
    ["MasterCard", /\bmaster\s*card\b|\bmastercard\b/i],
    ["American Express", /\bamerican express\b|\bamex\b/i],
    ["Discover", /\bdiscover\b/i],
    ["Credit Card", /\bcredit card\b/i],
    ["Certified Check", /\bcertified check\b/i],
    ["Cashier's Check", /\bcashier'?s check\b/i],
    ["Check", /\bcheck\b/i],
    ["Wire Transfer", /\bwire transfer\b|\bwire\b/i],
    ["Cash", /\bcash\b/i]
  ];

  return candidates
    .filter(([, pattern]) =>
      pattern.test(source)
    )
    .map(([name]) => name);
}

function parseLocationAddress($, pairs) {
  const locationLink = $(
    "#locationLink"
  ).first();

  const displayText = firstNonEmpty(
    locationLink.text(),
    pairs.location
  );

  const href = normalizeAbsoluteUrl(
    locationLink.attr("href") || ""
  );

  let mapDestination = "";

  try {
    mapDestination =
      new URL(href).searchParams.get("daddr") || "";
  } catch {
    mapDestination = "";
  }

  /*
   * Prefer the visible address because Proxibid's map
   * destination may omit the ZIP code.
   */
  const fullAddress = firstNonEmpty(
    displayText,
    mapDestination
  );

  const parts = fullAddress
    .split(",")
    .map(cleanText)
    .filter(Boolean);

  const street =
    parts.length >= 3
      ? parts.slice(0, -2).join(", ")
      : "";

  const city =
    parts.length >= 2
      ? parts[parts.length - 2]
      : "";

  const stateZip =
    parts.length
      ? parts[parts.length - 1]
      : "";

  const stateZipMatch = stateZip.match(
    /^([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/i
  );

  return {
    fullAddress,
    street,
    city,
    state: stateZipMatch?.[1]?.toUpperCase() || "",
    postalCode: stateZipMatch?.[2] || "",
    country: "US",
    mapUrl: href
  };
}

function parseTitleParts(title = "") {
  const cleanedSourceTitle = cleanText(title)
    .replace(
      /^lot\s*#?\s*\d+\s*[-–—:]\s*/i,
      ""
    )
    .replace(
      /\s*\|\s*proxibid.*$/i,
      ""
    )
    .trim();

  const match = cleanedSourceTitle.match(
    /\b((?:19|20)\d{2})\s+([A-Za-z][A-Za-z0-9&.'/-]*)\s+(.+)$/i
  );

  if (!match) {
    return {
      title: cleanedSourceTitle,
      year: "",
      make: "",
      model: "",
      machineType: ""
    };
  }

  const year =
    cleanText(match[1]);

  const make =
    cleanText(match[2]).toUpperCase();

  let remainder =
    cleanText(match[3]);

  /*
   * Remove serial-number suffix before attempting to
   * identify the machine type or model.
   *
   * Handles both:
   *
   *   LOADER BACKHOE SN CAT0420...
   *   LOADERBACKHOESNCAT0420...
   */
  remainder = cleanText(
    remainder.replace(
      /(?:\s*(?:SERIAL(?:\s+NUMBER)?|S\/N|SN)\s*[:#-]?\s*[A-Z0-9*._/-]{4,}.*)$/i,
      ""
    )
  );

  /*
   * Strip only a recognized trailing equipment-type
   * phrase. The phrase is retained as category evidence,
   * but never becomes part of the model or canonical title.
   */
  const machineTypeMatch =
    remainder.match(
      /(HYDRAULIC\s*EXCAVATOR|TRACKED\s*EXCAVATOR|CRAWLER\s*EXCAVATOR|COMPACT\s*TRACK\s*LOADER|ARTICULATED\s*DUMP\s*TRUCK|BACKHOE\s*LOADER|LOADER\s*BACKHOE|WHEEL\s*LOADER|MOTOR\s*GRADER|SKID\s*STEER|DUMP\s*TRUCK|EXCAVATOR|BULLDOZER|DOZER|BACKHOE|LOADER|TELEHANDLER|FORKLIFT|TRENCHER|DRILL|ROLLER|COMPACTOR|SCRAPER|CRANE)$/i
    );

  let machineType = "";

  if (machineTypeMatch) {
    const compactType =
      cleanText(machineTypeMatch[1])
        .replace(/\s+/g, "")
        .toUpperCase();

    const machineTypeMap = {
      HYDRAULICEXCAVATOR:
        "HYDRAULIC EXCAVATOR",
      TRACKEDEXCAVATOR:
        "TRACKED EXCAVATOR",
      CRAWLEREXCAVATOR:
        "CRAWLER EXCAVATOR",
      COMPACTTRACKLOADER:
        "COMPACT TRACK LOADER",
      ARTICULATEDDUMPTRUCK:
        "ARTICULATED DUMP TRUCK",
      BACKHOELOADER:
        "BACKHOE LOADER",
      LOADERBACKHOE:
        "LOADER BACKHOE",
      WHEELLOADER:
        "WHEEL LOADER",
      MOTORGRADER:
        "MOTOR GRADER",
      SKIDSTEER:
        "SKID STEER",
      DUMPTRUCK:
        "DUMP TRUCK"
    };

    machineType =
      machineTypeMap[compactType] ||
      cleanText(machineTypeMatch[1])
        .toUpperCase();

    remainder = cleanText(
      remainder.slice(
        0,
        machineTypeMatch.index
      )
    );
  }

  /*
   * Remove trailing descriptive drive/configuration
   * tokens. These are specifications, not machine identity.
   *
   * Example:
   *
   *   420F24X4
   *       ↓
   *   420F2
   */
  let previous = "";

  while (
    remainder &&
    remainder !== previous
  ) {
    previous = remainder;

    remainder = cleanText(
      remainder.replace(
        /(?:\s*(?:4X4|4WD|4\s*WHEEL\s*DRIVE|AWD|2WD))$/i,
        ""
      )
    );
  }

  /*
   * The shared identity engine will apply manufacturer
   * grammar and final model canonicalization.
   */
  const model =
    cleanText(remainder);

  const canonicalTitle = [
    year,
    make,
    model
  ]
    .filter(Boolean)
    .join(" ");

  return {
    title:
      canonicalTitle ||
      cleanedSourceTitle,
    year,
    make,
    model,
    machineType
  };
}

function parseHours(text = "") {
  const source = String(text || "");

  /*
   * Auction descriptions may contain both total hours
   * and idle hours. Total/meter hours must always win.
   */
  const priorityPatterns = [
    /total\s+(?:hours?|hrs?)\s+(?:shown\s*)?[:#-]?\s*([\d,]+(?:\.\d+)?)/i,
    /(?:total|actual)\s+(?:machine\s+)?(?:hours?|hrs?)\s*[:#-]?\s*([\d,]+(?:\.\d+)?)/i,
    /hour\s*meter\s*[:#-]?\s*([\d,]+(?:\.\d+)?)/i,
    /meter\s+(?:shows|reads|reading)\s*[:#-]?\s*([\d,]+(?:\.\d+)?)/i
  ];

  for (const pattern of priorityPatterns) {
    const match = source.match(pattern);

    if (match?.[1]) {
      return toNumber(match[1]);
    }
  }

  /*
   * Remove idle-hour statements before using the
   * generic fallback so idle time is never mistaken
   * for the machine's operating-hour value.
   */
  const withoutIdleHours = source.replace(
    /idle\s+(?:hours?|hrs?)\s*[:#-]?\s*[\d,]+(?:\.\d+)?/gi,
    " "
  );

  const fallback = withoutIdleHours.match(
    /(?:hours?|hrs?|meter)\s*[:#-]?\s*([\d,]+(?:\.\d+)?)/i
  );

  return fallback
    ? toNumber(fallback[1])
    : null;
}

function parseSerialNumber(text = "") {
  const value = firstMatch(text, [
    /\bserial(?:\s*(?:number|no\.?|#))?\s*[:#=-]?\s*([A-Z0-9][A-Z0-9*._/-]{3,})\b/i,
    /\bs\/n\s*[:#=-]?\s*([A-Z0-9][A-Z0-9*._/-]{3,})\b/i,
    /\bsn\s*[:#=-]\s*([A-Z0-9][A-Z0-9*._/-]{3,})\b/i,
    /\bvin\s*[:#=-]?\s*([A-HJ-NPR-Z0-9]{8,17})\b/i
  ]);

  return cleanText(value)
    .replace(/^[#:=\-\s]+/, "")
    .replace(/[.,;:]+$/, "");
}

function parseStockNumber(text = "") {
  return firstMatch(text, [
    /(?:stock(?:\s+number)?|stk)\s*[:#-]?\s*([A-Z0-9._/-]+)/i
  ]);
}

function parseLotHeaderText($) {
  return firstNonEmpty(
    getElementText($, [
      ".lotNumber",
      ".lotHeaderLotNumber",
      "#lotNumber",
      "[class*='lotNumber']"
    ])
  );
}

function parseLotNumber($, html) {
  const headerText = parseLotHeaderText($);

  return firstNonEmpty(
    firstMatch(headerText, [
      /lot\s*#?\s*(\d+)/i,
      /^(\d+)/i
    ]),
    firstMatch(html, [
      /Lot\s*#\s*(\d+)/i,
      /lotNumber\s*[:=]\s*["']?([^"',;<\s]+)/i
    ])
  );
}

function parseSaleOrder($, html) {
  const headerText = parseLotHeaderText($);
  const pageText = cleanText($.root().text());

  const value = firstNonEmpty(
    getElementText($, [
      ".saleOrder",
      "[class*='saleOrder']"
    ]),
    firstMatch(headerText, [
      /sale order\s*:\s*(\d+)/i
    ]),
    firstMatch(pageText, [
      /sale order\s*:\s*(\d+)/i,
      /sale order\s+(\d+)\s+of\s+\d+/i
    ]),
    firstMatch(html, [
      /saleOrder\s*[:=]\s*["']?(\d+)/i,
      /sale\s*(?:<[^>]+>\s*)*order\s*(?:<[^>]+>\s*)*:\s*(?:<[^>]+>\s*)*(\d+)/i
    ])
  );

  return toNumber(value);
}

function parseBidInformation($, html) {
  const pageText = cleanText($.root().text());

  const currentBidText = firstNonEmpty(
    getElementText($, [
      ".currentBid",
      "#currentBid",
      "[class*='currentBid']",
      ".lotCurrentBid"
    ]),
    firstMatch(pageText, [
      /current bid\s*:?\s*\$?\s*([\d,]+(?:\.\d+)?)/i
    ])
  );

  const openingBidText = firstNonEmpty(
    getElementText($, [
      ".openingBid",
      "#openingBid",
      "[class*='openingBid']"
    ]),
    firstMatch(pageText, [
      /opening bid\s*:?\s*\$?\s*([\d,]+(?:\.\d+)?)/i,
      /starting bid\s*:?\s*\$?\s*([\d,]+(?:\.\d+)?)/i
    ])
  );

  const passed =
    /\bPASSED\b/i.test(pageText);

  const sold =
    /\bSOLD\b/i.test(pageText) &&
    !/not sold/i.test(pageText);

  const reserveNotMet =
    /reserve not met/i.test(pageText);

  let status = "unknown";

  if (sold) {
    status = "sold";
  } else if (passed) {
    status = "passed";
  } else if (reserveNotMet) {
    status = "reserve-not-met";
  } else if (
    currentBidText ||
    /\bbid now\b/i.test(pageText)
  ) {
    status = "open";
  }

  return {
    openingBid: toNumber(openingBidText),
    currentBid: toNumber(currentBidText),
    currency: "USD",
    status,
    reserveNotMet
  };
}


function parseAuctionDates($, html) {
  const pageText = cleanText(
    $.root().text()
  );

  const renderedDateTimeText =
    firstNonEmpty(
      getElementText($, [
        ".AuctionLotsList",
        ".auctionDate",
        ".auctionDateTime",
        ".AuctionInfoDate",
        "[class*='auctionDate']",
        "[class*='eventDate']"
      ]),
      firstMatch(pageText, [
        /((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+[A-Za-z]{3,9}\s+\d{1,2},?\s+(?:19|20)\d{2}\s*\|\s*\d{1,2}:\d{2}\s*(?:AM|PM)\s*(?:Central|Eastern|Mountain|Pacific))/i
      ])
    );

  const saleDateText =
    firstNonEmpty(
      firstMatch(renderedDateTimeText, [
        /((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+[A-Za-z]{3,9}\s+\d{1,2},?\s+(?:19|20)\d{2})/i
      ]),
      getElementText($, [
        ".auctionDate",
        ".auctionDateTime",
        ".AuctionInfoDate",
        "[class*='auctionDate']",
        "[class*='eventDate']"
      ]),
      firstMatch(pageText, [
        /((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+[A-Za-z]{3,9}\s+\d{1,2},?\s+(?:19|20)\d{2})/i,
        /([A-Za-z]{3,9}\s+\d{1,2},?\s+(?:19|20)\d{2})/i
      ]),
      firstMatch(html, [
        /auctionStartDate\s*[:=]\s*["']([^"']+)["']/i,
        /startDate\s*[:=]\s*["']([^"']+)["']/i
      ])
    );

  const saleTimeText =
    firstNonEmpty(
      firstMatch(renderedDateTimeText, [
        /(\d{1,2}:\d{2}\s*(?:AM|PM)\s*(?:Central|Eastern|Mountain|Pacific))/i
      ]),
      firstMatch(pageText, [
        /\|\s*(\d{1,2}:\d{2}\s*(?:AM|PM)\s*(?:Central|Eastern|Mountain|Pacific))/i
      ])
    );

  const timezone =
    /Central/i.test(saleTimeText)
      ? "America/Chicago"
      : /Eastern/i.test(saleTimeText)
        ? "America/New_York"
        : /Mountain/i.test(saleTimeText)
          ? "America/Denver"
          : /Pacific/i.test(saleTimeText)
            ? "America/Los_Angeles"
            : "";

  const startAt = firstNonEmpty(
    getMetaContent($, [
      "meta[itemprop='startDate']",
      "meta[property='auction:start_time']"
    ]),
    firstMatch(html, [
      /startDateTime\s*[:=]\s*["']([^"']+)["']/i,
      /auctionStart(?:Date)?\s*[:=]\s*["']([^"']+)["']/i
    ])
  );

  const endAt = firstNonEmpty(
    getMetaContent($, [
      "meta[itemprop='endDate']",
      "meta[property='auction:end_time']"
    ]),
    firstMatch(html, [
      /endDateTime\s*[:=]\s*["']([^"']+)["']/i,
      /auctionEnd(?:Date)?\s*[:=]\s*["']([^"']+)["']/i
    ])
  );

  return {
    saleDateText,
    saleTimeText,
    startsAt: startAt,
    endsAt: endAt,
    timezone
  };
}


function parsePhotos($, html) {
  const candidates = [];

  $("img").each((_, element) => {
    const node = $(element);

    candidates.push(
      node.attr("data-zoom-image"),
      node.attr("data-large-image"),
      node.attr("data-full"),
      node.attr("data-src"),
      node.attr("src")
    );

    const srcset = node.attr("srcset");

    if (srcset) {
      srcset
        .split(",")
        .forEach(item => {
          candidates.push(
            item.trim().split(/\s+/)[0]
          );
        });
    }
  });

  $("a").each((_, element) => {
    const href = $(element).attr("href");

    if (
      /images\.proxibid\.com/i.test(
        href || ""
      )
    ) {
      candidates.push(href);
    }
  });

  const htmlMatches =
    String(html || "").match(
      /https?:\/\/images\.proxibid\.com\/[^"'<>\\\s)]+/gi
    ) || [];

  candidates.push(...htmlMatches);

  const photos = unique(
    candidates
      .map(normalizeImageUrl)
      .filter(Boolean)
  );

return photos;

}

function parseEventTitle($) {
  return firstNonEmpty(
    getElementText($, [

 "#auctionTitleLink",
  ".moreInfoEventName",
  "#moreInfoEventName",
  ".AuctionLotsList #auctionTitleLink",
  ".breadCrumb a[href*='catalog.asp?aid=']",
  ".AuctionInfoTitle",
  ".auctionTitle",
  ".eventTitle",
  "[class*='auctionTitle']"
    ]),
    getMetaContent($, [
      "meta[property='og:site_name']"
    ])
  );
}

function parseMachine(
  $,
  html,
  sourceUrl = ""
) {
  const pageTitle = firstNonEmpty(
    getElementText($, [
      "h1.lotHeaderDescription",
      ".lotHeaderDescription",
      "h1"
    ]),
    getMetaContent($, [
      "meta[property='og:title']",
      "meta[name='twitter:title']"
    ]),
    $("title").text()
  );

  const titleParts =
    parseTitleParts(pageTitle);

  const description = firstNonEmpty(
    getElementText($, [
      ".LotDescriptionDescription",
      "#LotDescriptionDescription",
      ".lotDescriptionDescription",
      "[class*='LotDescriptionDescription']"
    ]),
    getMetaContent($, [
      "meta[property='og:description']",
      "meta[name='description']"
    ])
  );

  let decodedSourceUrl = "";

  try {
    decodedSourceUrl =
      decodeURIComponent(sourceUrl);
  } catch {
    decodedSourceUrl =
      String(sourceUrl || "");
  }

  const visiblePageText = cleanText(
    $("body").text()
  );

  const combinedText = cleanText(
    [
      pageTitle,
      description,
      decodedSourceUrl,
      visiblePageText
    ]
      .filter(Boolean)
      .join(" ")
  );

  const serialNumber = firstNonEmpty(
    parseSerialNumber(description),
    parseSerialNumber(pageTitle),
    parseSerialNumber(decodedSourceUrl),
    parseSerialNumber(visiblePageText)
  );

  const stockNumber = firstNonEmpty(
    parseStockNumber(description),
    parseStockNumber(pageTitle),
    parseStockNumber(visiblePageText)
  );

  return {
    title: titleParts.title,
    year: titleParts.year,
    make: titleParts.make,
    model: titleParts.model,
    machineType: titleParts.machineType,
    hours: parseHours(combinedText),
    serialNumber,
    stockNumber,
    description,
    condition: "",
    location: ""
  };
}

function createConfidence({
  machine,
  auctionEvent,
  auctionLot,
  media
}) {
  const checks = {
    title: Boolean(machine.title),
    year: Boolean(machine.year),
    make: Boolean(machine.make),
    model: Boolean(machine.model),
    company: Boolean(
      auctionEvent.companyName
    ),
    eventId: Boolean(
      auctionEvent.sourceEventId
    ),
    lotId: Boolean(
      auctionLot.sourceLotId
    ),
    lotNumber: Boolean(
      auctionLot.lotNumber
    ),
    photos: media.length > 0
  };

  const passed = Object.values(checks)
    .filter(Boolean)
    .length;

  const total =
    Object.keys(checks).length;

  return {
    score:
      Math.round((passed / total) * 100) / 100,
    checks
  };
}

function parseProxibidHtml({
  html,
  sourceUrl = ""
} = {}) {
  if (!html || typeof html !== "string") {
    throw new Error(
      "parseProxibidHtml requires rendered HTML"
    );
  }

  if (
    sourceUrl &&
    !isProxibidUrl(sourceUrl)
  ) {
    throw new Error(
      `Unsupported Proxibid URL: ${sourceUrl}`
    );
  }

  const $ = cheerio.load(html);

  const context =
    parseAuctionContext(html);

  const parsedMachine =
    parseMachine(
      $,
      html,
      sourceUrl
    );

  const {
    pairs,
    specialTerms,
    allTermsText
  } = parseTermsAreas($);

  const auctionDates =
    parseAuctionDates($, html);

  const location =
    parseLocationAddress($, pairs);

  parsedMachine.location = firstNonEmpty(
    [location.city, location.state]
      .filter(Boolean)
      .join(", "),
    location.fullAddress
  );

  const internetPremiumText =
    firstNonEmpty(
      pairs["internet premium capped"],
      pairs["internet premium"],
      pairs["buyer's premium"],
      pairs["buyers premium"]
    );

  const paymentOptions =
    firstNonEmpty(
      pairs["payment options"]
    );

  const paymentInstructions =
    firstNonEmpty(
      pairs["payment instructions"]
    );

  const shippingInstructions =
    firstNonEmpty(
      pairs["shipping instructions"]
    );

  const previewInformation =
    firstNonEmpty(
      pairs["preview date & times"],
      pairs["preview date and times"],
      pairs.preview
    );

  const checkoutInformation =
    firstNonEmpty(
      pairs["checkout date & times"],
      pairs["checkout date and times"],
      pairs.checkout
    );

  const participationRequirements =
    firstNonEmpty(
      pairs["participation requirements"]
    );

  const currency =
    firstNonEmpty(
      pairs["currency type"],
      "USD"
    );

  const buyerPremium =
    parseBuyerPremium({
      internetPremiumText,
      paymentInstructions
    });

  const tax = parseTax({
    paymentInstructions,
    allTermsText
  });

console.log(
  "PROXIBID TERMS DEBUG:",
  JSON.stringify(
    {
      internetPremiumText,
      paymentInstructions,
      shippingInstructions,
      checkoutInformation,
      specialTerms,
      allTermsText
    },
    null,
    2
  )
);

  const paymentDue =
    parsePaymentDeadline({
      paymentInstructions,
      checkoutText:
        checkoutInformation,
      specialTerms,
      saleDateText:
        auctionDates.saleDateText
    });

  const removal =
    parseRemovalDeadline({
      shippingInstructions,
      checkoutText:
        checkoutInformation,
      saleEndAt:
        auctionDates.endsAt ||
        auctionDates.startsAt
    });

console.log(
  "PROXIBID PARSED AUCTION:",
  JSON.stringify(
    {
      buyerPremium,
      tax,
      paymentDue,
      removal
    },
    null,
    2
  )
);

  const bidInformation =
    parseBidInformation($, html);

  const media =
    parsePhotos($, html);


  const machine =
    applyIdentityToParsedListing({
      source: "proxibid",
      sourceName: "Proxibid",
      url: sourceUrl,

      title:
        parsedMachine.title,

      description:
        parsedMachine.description,

      visibleText: cleanText(
        $("body").text()
      ),

      year:
        parsedMachine.year,

      make:
        parsedMachine.make,

      model:
        parsedMachine.model,

      sourceCategory:
        parsedMachine.machineType,

      parserCategory:
        parsedMachine.machineType,

      price:
        parsedMachine.price ||
        (
          bidInformation.currentBid !== null &&
          bidInformation.currentBid !== undefined
            ? String(
                bidInformation.currentBid
              )
            : bidInformation.openingBid !== null &&
              bidInformation.openingBid !== undefined
              ? String(
                  bidInformation.openingBid
                )
              : "1000"
        ),

      hours:
        parsedMachine.hours,

      location:
        parsedMachine.location,

      city:
        location.city,

      state:
        location.state,

      serialNumber:
        parsedMachine.serialNumber,

      stockNumber:
        parsedMachine.stockNumber,

      condition:
        parsedMachine.condition,

      photos:
        media
    });

  /*
   * The canonical IXI title must use the final resolved
   * identity, not the raw Proxibid source title.
   */
  machine.title = [
    machine.year,
    machine.make,
    machine.model
  ]
    .map(value =>
      cleanText(value)
    )
    .filter(Boolean)
    .join(" ");

  const normalizedAuctionType =
    /live/i.test(context.auctionType)
      ? "live"
      : /timed/i.test(context.auctionType)
        ? "timed"
        : cleanText(
            context.auctionType
          ).toLowerCase() || "unknown";

  const eventTitle =
    parseEventTitle($);

  const auctionEvent = {
    eventId:
      context.auctionId
        ? `proxibid-${context.auctionId}`
        : "",

    platform: "proxibid",

    sourceEventId:
      context.auctionId,

    sourceAuctionHouseId:
      context.auctionHouseId,

    companyName:
      context.auctionHouseName,

    eventTitle,

    auctionType:
      normalizedAuctionType,

    location,

    saleDateText:
      auctionDates.saleDateText,

saleTimeText:
  auctionDates.saleTimeText,

    startsAt:
      auctionDates.startsAt,

    endsAt:
      auctionDates.endsAt,

    timezone:
      auctionDates.timezone,

    currency,

    terms: {
      buyerPremium,
      tax,

      participationRequirements,

      payment: {
        dueAt:
          paymentDue.dueAt,

        dueText:
          paymentDue.dueText,

        dueRule:
          paymentDue.dueRule,

        options:
          parseAcceptedPayments(
            paymentOptions,
            paymentInstructions
          ),

        instructions:
          paymentInstructions,

        electronicPaymentFeePercent:
          toNumber(
            firstMatch(
              paymentInstructions,
              [
                /(\d+(?:\.\d+)?)\s*%\s*electronic fee/i
              ]
            )
          ),

        rawText:
          paymentDue.rawText
      },

      removal: {
        deadlineAt:
          removal.deadlineAt,

        deadlineText:
          removal.deadlineText,

        relativeDays:
          removal.relativeDays,

        instructions:
          firstNonEmpty(
            shippingInstructions,
            checkoutInformation
          ),

        rawText:
          removal.rawText
      },

      inspection: {
        datesText:
          previewInformation,

        instructions:
          previewInformation
      },

      checkout: {
        datesText:
          checkoutInformation,

        instructions:
          checkoutInformation
      },

      shipping: {
        available: null,

        buyerResponsible:
          /buyer is responsible/i.test(
            shippingInstructions
          ),

        instructions:
          shippingInstructions
      },

      specialTerms,

      fullTermsText:
        allTermsText
    }
  };

  const auctionLot = {
    eventId:
      auctionEvent.eventId,

    platform: "proxibid",

    sourceLotId:
      context.lotId,

    lotId:
      context.lotId
        ? `proxibid-lot-${context.lotId}`
        : "",

    lotNumber:
      parseLotNumber($, html),

    saleOrder:
      parseSaleOrder($, html),

    openingBid:
      bidInformation.openingBid ??
      bidInformation.currentBid ??
      1000,

    currentBid:
      bidInformation.currentBid,

    currency:
      currency || "USD",

    status:
      bidInformation.status,

    reserveNotMet:
      bidInformation.reserveNotMet,

    sourceUrl
  };

  const saleEvidence = [
    auctionLot.lotNumber
      ? "lot-number"
      : "",

    auctionLot.openingBid !== null &&
    auctionLot.openingBid !== undefined
      ? "opening-bid"
      : "",

    auctionLot.currentBid !== null &&
    auctionLot.currentBid !== undefined
      ? "current-bid"
      : "",

    auctionEvent.auctionType
      ? "auction-type"
      : "",

    auctionEvent.startsAt
      ? "auction-start"
      : "",

    auctionEvent.endsAt
      ? "auction-end"
      : ""
  ].filter(Boolean);

  const sale = {
    type: "auction",

    mechanism:
      auctionEvent.auctionType ||
      "auction",

    confidence:
      saleEvidence.length >= 2
        ? "high"
        : "medium",

    evidence:
      saleEvidence
  };

  const launchPolicy = {
    forcedDestination:
      "auction",

    allowedDestinations: [
      "auction"
    ],

    destinationLocked:
      true,

    reason:
      "Source page is an auction lot"
  };

  const reserveMet =
    auctionLot.reserveNotMet === true
      ? false
      : auctionLot.reserveNotMet === false
        ? true
        : null;

let normalizedAuction = {
    provider:
      "proxibid",

    platform:
      "proxibid",

    providerListingId:
      auctionLot.sourceLotId ||
      "",

    providerUrl:
      sourceUrl,

    company: {
      id:
        auctionEvent.sourceAuctionHouseId ||
        "",

      name:
        auctionEvent.companyName ||
        "",

      url:
        ""
    },

    event: {
      id:
        auctionEvent.sourceEventId ||
        "",

      name:
        auctionEvent.eventTitle ||
        "",

      format:
        auctionEvent.auctionType ||
        "",

      participation:
        auctionEvent.participation ||
        "",

      location:
        auctionEvent.location ||
        {
          label: "",
          city: "",
          state: "",
          country: "",
          address: "",
          postalCode: ""
        },

      dateText:
        auctionEvent.saleDateText ||
        "",

timeText:
  auctionEvent.saleTimeText || "",

      startsAt:
        auctionEvent.startsAt ||
        "",

      endsAt:
        auctionEvent.endsAt ||
        "",

      timezone:
        auctionEvent.timezone ||
        ""
    },

    lot: {
      id:
        auctionLot.lotId ||
        "",

      number:
        auctionLot.lotNumber ||
        "",

      saleOrder:
        auctionLot.saleOrder ??
        null,

      /*
       * Do not use event.endsAt as the lot close.
       * This remains blank until Proxibid provides
       * a verified lot-level closing timestamp.
       */
      scheduledCloseAt:
        auctionLot.scheduledCloseAt ||
        "",

      actualCloseAt:
        "",

      timezone:
        auctionLot.timezone ||
        auctionEvent.timezone ||
        "",

      openingBid:
        auctionLot.openingBid ??
        null,

      currentBid:
        auctionLot.currentBid ??
        null,

      bidCount:
        auctionLot.bidCount ??
        null,

      buyNowPrice:
        null,

      increment:
        auctionLot.bidIncrement ??
        null,

      reserveMet,

      currency:
        auctionLot.currency ||
        "USD",

      status:
        auctionLot.status ||
        "",

      machineLocation: {
        label:
          machine.location ||
          [
            machine.city,
            machine.state
          ]
            .filter(Boolean)
            .join(", "),

        city:
          machine.city ||
          "",

        state:
          machine.state ||
          "",

        country:
          "",

        address:
          "",

        postalCode:
          ""
      }
    },

    bidding: {
      openingBid:
        auctionLot.openingBid ??
        null,

      currentBid:
        auctionLot.currentBid ??
        null,

      bidCount:
        auctionLot.bidCount ??
        null,

      reserveMet,

      buyNowPrice:
        null,

      increment:
        auctionLot.bidIncrement ??
        null,

      currency:
        auctionLot.currency ||
        "USD"
    },

    timing: {
      timezone:
        auctionLot.timezone ||
        auctionEvent.timezone ||
        "",

      startsAt:
        auctionEvent.startsAt ||
        "",

      endsAt:
        auctionEvent.endsAt ||
        "",

      scheduledCloseAt:
        auctionLot.scheduledCloseAt ||
        "",

      actualCloseAt:
        "",

      updatedAt:
        ""
    },

    status: {
      value:
        auctionLot.status ||
        "",

      live:
        null,

      closed:
        null,

      pending:
        null,

      sold:
        null,

      extended:
        null
    },


    auctionRules: {
      buyerPremium,
      tax,
      paymentDue,
      removal
    },

    /*
     * Compatibility aliases for AOF2 and any existing
     * consumers that read these directly.
     */
    buyerPremium,
    tax,
    paymentDue,
    removal,

    terms:
      auctionEvent.terms ||
      null,

    source: {
      url:
        sourceUrl,

      type:
        "proxibid",

      platform:
        "proxibid",

      scrapedAt:
        "",

      updatedAt:
        "",

      parserVersion:
        "proxibid-auction-object-v1"
    }
  };

  normalizedAuction = applyAuctionDoctrine({
    auction: normalizedAuction,
    companyId:
      normalizedAuction?.company?.id ||
      auctionHouseName ||
      "",
    platformId: "proxibid"
  });

  const confidence =
    createConfidence({
      machine,
      auctionEvent,
      auctionLot,
      media
    });

  console.log(
    "PROXIBID AUCTION EVENT:",
    JSON.stringify(normalizedAuction.event, null, 2)
  );

  console.log(
    "PROXIBID NORMALIZED RULES:",
    JSON.stringify(
      normalizedAuction.auctionRules,
      null,
      2
    )
  );

  return {
    ok: true,

    source: {
      type:
        "proxibid",

      label:
        "Proxibid",

      platform:
        "proxibid",

      url:
        sourceUrl
    },

    acquisition: {
      adapter:
        "proxibid",

      method:
        "captured-html-parser",

      saleType:
        "auction",

      parserVersion:
        "proxibid-auction-object-v1"
    },

    sale,

    machine,

    media,

    /*
     * Permanent IXI Auction Object.
     */
    auction:
      normalizedAuction,

    /*
     * Compatibility objects retained while
     * the rest of IXI migrates to auction.
     */
    auctionEvent,

    auctionLot,

auctionTerms:
  normalizedAuction.terms,

    launchPolicy,

    confidence
  };
}

module.exports = {
  parseProxibidHtml,
  isProxibidUrl
};
