"use strict";

/*
 * IXI FINANCIAL INVOICE FACTORY
 *
 * PURPOSE
 * -------
 *
 * Create canonical IXI Financial Documents
 * representing customer invoices / revenue.
 *
 *
 * ECONOMIC MEANING
 * ----------------
 *
 * An Invoice represents REVENUE.
 *
 * It does NOT represent cash collected.
 *
 *
 * LIFECYCLE
 * ---------
 *
 * INVOICE
 *    ↓
 * PAYMENT / RECEIPT
 *
 *
 * Example:
 *
 * INVOICE     $25,000
 * RECEIPT     $10,000
 *
 * revenue      $25,000
 * collected    $10,000
 * receivable   $15,000
 *
 *
 * THIS FACTORY DOES NOT:
 *
 * - persist
 * - authorize
 * - calculate lifecycle
 * - calculate snapshots
 * - discover hierarchy
 */


const crypto =
  require("crypto");


/* =========================================================
   HELPERS
   ========================================================= */

function clean(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


function safeArray(
  value
) {
  return Array.isArray(
    value
  )
    ? value
    : [];
}


function safeObject(
  value
) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}


function safeNumber(
  value,
  fallback = 0
) {
  const number =
    Number(
      value
    );

  return Number.isFinite(
    number
  )
    ? number
    : fallback;
}


function roundMoney(
  value
) {
  return Math.round(
    (
      safeNumber(
        value,
        0
      ) +
      Number.EPSILON
    ) *
    100
  ) / 100;
}


function nowIso() {
  return new Date()
    .toISOString();
}


function randomId(
  prefix
) {
  return `${prefix}_${crypto
    .randomBytes(12)
    .toString("hex")}`;
}


function normalizeCurrency(
  value
) {
  const currency =
    clean(
      value ||
      "USD"
    ).toUpperCase();

  return /^[A-Z]{3}$/.test(
    currency
  )
    ? currency
    : "USD";
}


/* =========================================================
   REFERENCES
   ========================================================= */

function normalizeReference(
  input = {}
) {
  const source =
    safeObject(
      input
    );

  const passportId =
    clean(
      source.passportId
    );

  const role =
    clean(
      source.role
    );

  if (
    !passportId ||
    !role
  ) {
    return null;
  }

  return {
    passportId,

    role,

    label:
      clean(
        source.label
      ),

    objectType:
      clean(
        source.objectType
      ),

    metadata: {
      ...safeObject(
        source.metadata
      )
    }
  };
}


function normalizeReferences(
  references = []
) {
  const map =
    new Map();

  safeArray(
    references
  ).forEach(
    reference => {
      const normalized =
        normalizeReference(
          reference
        );

      if (
        !normalized
      ) {
        return;
      }

      const key =
        `${normalized.passportId}|${normalized.role}`;

      if (
        !map.has(
          key
        )
      ) {
        map.set(
          key,
          normalized
        );
      }
    }
  );

  return Array.from(
    map.values()
  );
}


/* =========================================================
   INVOICE LINE
   ========================================================= */

function createInvoiceLine({
  financialDocumentId = "",
  financialLineId = "",

  description = "",

  quantity = 1,
  rate = 0,
  amount = null,

  currency = "USD",

  occurredAt = "",

  references = [],

  category = "",
  revenueCode = "",
  itemCode = "",
  unitOfMeasure = "",

  customerPassportId = "",

  metadata = {}
} = {}) {

  const resolvedQuantity =
    safeNumber(
      quantity,
      1
    );

  const resolvedRate =
    roundMoney(
      rate
    );

  const resolvedAmount =
    amount === null ||
    amount === undefined
      ? roundMoney(
          resolvedQuantity *
          resolvedRate
        )
      : roundMoney(
          amount
        );

  const lineReferences =
    normalizeReferences([
      ...safeArray(
        references
      ),

      customerPassportId
        ? {
            passportId:
              customerPassportId,

            role:
              "customer"
          }
        : null
    ].filter(Boolean));


  return {
    financialLineId:
      clean(
        financialLineId
      ) ||
      randomId(
        "ifl"
      ),

    financialDocumentId:
      clean(
        financialDocumentId
      ),

    lineType:
      "invoice",

    description:
      clean(
        description ||
        "INVOICE ITEM"
      ),

    category:
      clean(
        category
      ),

    revenueCode:
      clean(
        revenueCode
      ),

    itemCode:
      clean(
        itemCode
      ),

    unitOfMeasure:
      clean(
        unitOfMeasure
      ),

    quantity:
      resolvedQuantity,

    rate:
      resolvedRate,

    amount:
      resolvedAmount,

    currency:
      normalizeCurrency(
        currency
      ),

    direction:
      "inflow",

    occurredAt:
      clean(
        occurredAt
      ) ||
      nowIso(),

    references:
      lineReferences,

    metadata: {
      ...safeObject(
        metadata
      )
    }
  };
}


/* =========================================================
   INVOICE DOCUMENT
   ========================================================= */

function createInvoiceDocument({
  financialDocumentId = "",

  documentNumber = "",

  financialState = "billed",

  currency = "USD",

  occurredAt = "",

  dueDate = "",

  description = "",

  memo = "",

  references = [],

  lines = [],

  amount = null,

  quantity = 1,

  rate = 0,

  category = "",

  revenueCode = "",

  customerPassportId = "",

  issuedByPassportId = "",

  paymentTerms = "",

  sourceFinancialDocumentId = "",

  relatedFinancialDocumentIds = [],

  sourceSystem = "",

  sourceDocumentId = "",

  externalReference = "",

  metadata = {}
} = {}) {

  const resolvedDocumentId =
    clean(
      financialDocumentId
    ) ||
    randomId(
      "ifd"
    );


  const resolvedCurrency =
    normalizeCurrency(
      currency
    );


  const resolvedOccurredAt =
    clean(
      occurredAt
    ) ||
    nowIso();


  const documentReferences =
    normalizeReferences([
      ...safeArray(
        references
      ),

      customerPassportId
        ? {
            passportId:
              customerPassportId,

            role:
              "customer"
          }
        : null,

      issuedByPassportId
        ? {
            passportId:
              issuedByPassportId,

            role:
              "issued-by"
          }
        : null
    ].filter(Boolean));


  let resolvedLines =
    safeArray(
      lines
    ).map(
      line =>
        createInvoiceLine({
          ...safeObject(
            line
          ),

          financialDocumentId:
            resolvedDocumentId,

          currency:
            line?.currency ||
            resolvedCurrency,

          occurredAt:
            line?.occurredAt ||
            resolvedOccurredAt,

          references:
            line?.references ||
            documentReferences
        })
    );


  if (
    resolvedLines.length ===
      0
  ) {

    resolvedLines = [
      createInvoiceLine({
        financialDocumentId:
          resolvedDocumentId,

        description:
          description ||
          "INVOICE",

        quantity,

        rate,

        amount,

        currency:
          resolvedCurrency,

        occurredAt:
          resolvedOccurredAt,

        references:
          documentReferences,

        category,

        revenueCode,

        customerPassportId
      })
    ];
  }


  const total =
    roundMoney(
      resolvedLines.reduce(
        (
          sum,
          line
        ) =>
          sum +
          safeNumber(
            line?.amount,
            0
          ),
        0
      )
    );


  const sourceId =
    clean(
      sourceFinancialDocumentId
    );


  const relatedIds =
    Array.from(
      new Set(
        [
          ...safeArray(
            relatedFinancialDocumentIds
          ),

          sourceId
        ]
          .map(
            clean
          )
          .filter(
            Boolean
          )
      )
    );


  return {
    financialDocumentId:
      resolvedDocumentId,

    documentType:
      "invoice",

    documentNumber:
      clean(
        documentNumber
      ),

    financialState:
      clean(
        financialState ||
        "billed"
      ).toLowerCase(),

    currency:
      resolvedCurrency,

    occurredAt:
      resolvedOccurredAt,

    dueDate:
      clean(
        dueDate
      ),

    description:
      clean(
        description
      ),

    memo:
      clean(
        memo
      ),

    paymentTerms:
      clean(
        paymentTerms
      ),

    sourceSystem:
      clean(
        sourceSystem
      ),

    sourceDocumentId:
      clean(
        sourceDocumentId
      ),

    externalReference:
      clean(
        externalReference
      ),

    sourceFinancialDocumentId:
      sourceId,

    relatedFinancialDocumentIds:
      relatedIds,

    relationships:
      sourceId
        ? [
            {
              financialDocumentId:
                sourceId,

              relationshipType:
                "derived-from"
            }
          ]
        : [],

    references:
      documentReferences,

    lines:
      resolvedLines,

    totals: {
      subtotal:
        total,

      total:
        total
    },

    metadata: {
      ...safeObject(
        metadata
      )
    }
  };
}


/* =========================================================
   SIMPLE INVOICE
   ========================================================= */

function createSimpleInvoice({
  passportId = "",

  passportRole = "job",

  amount = 0,

  description = "",

  documentNumber = "",

  occurredAt = "",

  dueDate = "",

  currency = "USD",

  customerPassportId = "",

  issuedByPassportId = "",

  category = "",

  revenueCode = "",

  paymentTerms = "",

  metadata = {}
} = {}) {

  return createInvoiceDocument({
    documentNumber,

    amount,

    description,

    occurredAt,

    dueDate,

    currency,

    customerPassportId,

    issuedByPassportId,

    category,

    revenueCode,

    paymentTerms,

    references: [
      {
        passportId:
          clean(
            passportId
          ),

        role:
          clean(
            passportRole ||
            "job"
          )
      }
    ],

    metadata
  });
}


/* =========================================================
   EXPORTS
   ========================================================= */

module.exports = {
  normalizeReference,
  normalizeReferences,

  createInvoiceLine,
  createInvoiceDocument,
  createSimpleInvoice
};
