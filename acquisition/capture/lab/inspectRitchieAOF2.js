const fs = require("fs");

const payloadPath =
  process.argv[2] ||
  "/tmp/firecrawl-payload.json";

const payload = JSON.parse(
  fs.readFileSync(payloadPath, "utf8")
);

const data = payload?.data || {};

const rawHtml = String(data.rawHtml || "");
const html = String(data.html || "");
const markdown = String(data.markdown || "");

function decode(value = "") {
  return String(value)
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u0027/gi, "'")
    .replace(/\\u0022/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value = "") {
  return decode(
    String(value)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function firstMatch(source, patterns) {
  for (const pattern of patterns) {
    const match = source.match(pattern);

    if (match) {
      return decode(match[1] || match[0]);
    }
  }

  return null;
}

function allMatches(source, pattern, limit = 20) {
  const output = [];
  const regex = new RegExp(
    pattern.source,
    pattern.flags.includes("g")
      ? pattern.flags
      : `${pattern.flags}g`
  );

  let match;

  while (
    (match = regex.exec(source)) &&
    output.length < limit
  ) {
    const value = decode(match[1] || match[0]);

    if (value && !output.includes(value)) {
      output.push(value);
    }

    if (match.index === regex.lastIndex) {
      regex.lastIndex += 1;
    }
  }

  return output;
}

function contextMatches(source, terms, limitPerTerm = 5) {
  const output = [];

  for (const term of terms) {
    const lower = source.toLowerCase();
    const needle = term.toLowerCase();

    let start = 0;
    let found = 0;

    while (found < limitPerTerm) {
      const index = lower.indexOf(needle, start);

      if (index === -1) break;

      const context = decode(
        source.slice(
          Math.max(0, index - 220),
          Math.min(
            source.length,
            index + needle.length + 500
          )
        )
      );

      output.push({
        term,
        index,
        context
      });

      start = index + needle.length;
      found += 1;
    }
  }

  return output;
}

const renderedText = stripTags(html);

const paymentDueText = firstMatch(html, [
  /Items must be paid in full by\s*<strong>([^<]+)<\/strong>/i,
  /Items must be paid in full by\s+([^.<]+(?:\d{4}))/i
]);

const paymentDate = firstMatch(
  paymentDueText || renderedText,
  [
    /\b((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4})\b/i,
    /\b([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\b/i
  ]
);

const removalDeadlineText = firstMatch(html, [
  /Items must be removed by\s*<strong>([^<]+)<\/strong>/i,
  /Items must be removed by\s+([^.<]+(?:\d{4}))/i,
  /removed by\s*<strong>([^<]+)<\/strong>/i
]);

const removalDate = firstMatch(
  removalDeadlineText || renderedText,
  [
    /\b((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4})\b/i,
    /\b([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\b/i
  ]
);

const inspectionAddress = firstMatch(html, [
  /data-testid="inspections-info-card"[\s\S]{0,2500}?<div[^>]*>([^<]*\d{3,}[^<]*)<\/div>/i,
  /Additional information[\s\S]{0,3000}?Inspections[\s\S]{0,1000}?>([^<]*\d{3,}[^<]*)</i
]);

const contactPhone = firstMatch(html, [
  /data-testid="contact-info-card"[\s\S]{0,2000}?(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})/i,
  /Need additional information[\s\S]{0,1000}?(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})/i
]);

const visibleLinks = allMatches(
  html,
  /href="([^"]+)"/gi,
  500
);

const relevantLinks = visibleLinks.filter(url =>
  /buyer-fees|terms-of-sale|read-before-you-bid|payments|\/lp\/|shipping|pickup|storage/i.test(
    url
  )
);

const shippingBullets = allMatches(
  html,
  /<li[^>]*class="[^"]*MuiListItem[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
  100
)
  .map(stripTags)
  .filter(text =>
    /invoice|release ticket|pick up|shipping|transport|remove/i.test(
      text
    )
  );

const policyStrings = {
  bindingBid: firstMatch(rawHtml, [
    /Bids cannot be retracted\.[^"]*/i,
    /your bid is binding[^"]*/i,
    /all bids are final[^"]*/i
  ]),

  asIsWhereIs: firstMatch(rawHtml, [
    /Everything sells \\"as is, where is\\"[^"]*/i,
    /Everything sells "as is, where is"[^"]*/i,
    /as is, where is[^"]*/i
  ]),

  transactionFee: firstMatch(html, [
    /Successful buyers will be required to pay a buyer transaction fee\./i
  ]),

  paymentRendered: firstMatch(html, [
    /Items must be paid in full by[\s\S]{0,500}?Late fees[\s\S]{0,200}?due date\./i
  ]),

  paymentGeneric: firstMatch(rawHtml, [
    /Items must be paid in full by \{\{day\}\}\. Items cannot be collected until paid for in full\./i,
    /Items must be paid in full by[^"]*Late fees[^"]*/i
  ]),

  removalGeneric: firstMatch(rawHtml, [
    /Items must be removed by \{\{day\}\}\. Pickup instructions will be provided once items are paid/i
  ]),

  purchaseRemoval: firstMatch(rawHtml, [
    /Buyers cannot remove their purchases from the auction site until their invoice is paid in full\./i
  ]),

  releaseTicket: firstMatch(rawHtml, [
    /Drivers must bring a copy of the Ritchie Bros\. Auctioneers release ticket to pick up the item\./i,
    /A release ticket must be present before loading and\/or removal of any equipment\./i
  ]),

  removalGate: firstMatch(rawHtml, [
    /Equipment must be removed from the auction site through the truck gate\./i
  ]),

  foreignTransport: firstMatch(rawHtml, [
    /A bill of lading must be completed for any equipment being transported to a foreign country\./i
  ]),

  storageAbandonment: firstMatch(rawHtml, [
    /Purchases not picked up by the removal deadline may be moved[^"]*/i
  ]),

  storageFourteenDays: firstMatch(rawHtml, [
    /Assets must be collected in 14 days to avoid storage fees\./i
  ]),

  interest: firstMatch(rawHtml, [
    /You have 7 days from the end of the auction to pay in full before interest will accrue[^"]*/i
  ])
};

const report = {
  capture: {
    sourceURL:
      data.metadata?.sourceURL ||
      data.metadata?.url ||
      null,

    title:
      data.metadata?.title ||
      null,

    lengths: {
      rawHtml: rawHtml.length,
      html: html.length,
      markdown: markdown.length
    }
  },

  aof2: {
    transactionFee: {
      rawText: policyStrings.transactionFee,
      exactRateFound:
        /\b\d+(?:\.\d+)?\s*%/.test(
          policyStrings.transactionFee || ""
        ),
      buyerFeeLinks: relevantLinks.filter(url =>
        /buyer-fees/i.test(url)
      )
    },

    payment: {
      dueDate: paymentDate,
      renderedText:
        stripTags(policyStrings.paymentRendered || ""),
      genericText:
        policyStrings.paymentGeneric,
      interestText:
        policyStrings.interest,
      paymentLinks: relevantLinks.filter(url =>
        /payments|read-before-you-bid/i.test(url)
      )
    },

    removal: {
      deadlineDate: removalDate,
      renderedDeadlineText:
        stripTags(removalDeadlineText || ""),
      genericDeadlineText:
        policyStrings.removalGeneric,
      paidBeforeRemovalText:
        policyStrings.purchaseRemoval,
      releaseTicketText:
        policyStrings.releaseTicket,
      truckGateText:
        policyStrings.removalGate,
      foreignTransportText:
        policyStrings.foreignTransport,
      shippingBullets
    },

    storage: {
      abandonmentText:
        policyStrings.storageAbandonment,
      fourteenDayText:
        policyStrings.storageFourteenDays
    },

    terms: {
      bindingBidText:
        policyStrings.bindingBid,
      asIsWhereIsText:
        policyStrings.asIsWhereIs,
      termsLinks: relevantLinks.filter(url =>
        /terms-of-sale/i.test(url)
      )
    },

    inspection: {
      address:
        stripTags(inspectionAddress || ""),
      siteLinks: relevantLinks.filter(url =>
        /\/lp\//i.test(url)
      )
    },

    contact: {
      phone: contactPhone
    }
  },

  diagnostics: {
    renderedRemovalMatches: contextMatches(
      html,
      [
        "Items must be removed by",
        "Removal day",
        "removal deadline",
        "storage fees"
      ],
      10
    ),

    rawDataFieldMatches: contextMatches(
      rawHtml,
      [
        '"paymentDate"',
        '"removeDay"',
        '"remove_day"',
        '"removalDate"',
        '"paymentDueDate"',
        '"auctionEndDate"',
        '"eventEndDate"',
        '"transactionFee"',
        '"buyerPremium"',
        '"buyerFee"'
      ],
      10
    )
  }
};

console.log(
  JSON.stringify(report, null, 2)
);
