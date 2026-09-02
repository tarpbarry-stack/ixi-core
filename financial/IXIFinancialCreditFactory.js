"use strict";

/*
 * IXI FINANCIAL CREDIT FACTORY
 *
 * PURPOSE
 * -------
 *
 * Create canonical IXI Financial Documents
 * representing COST-SIDE CREDITS.
 *
 *
 * EXAMPLES
 * --------
 *
 * vendor credit memo
 * returned parts credit
 * purchase adjustment
 * overbilling correction
 *
 *
 * ECONOMIC MEANING
 * ----------------
 *
 * Credit reduces incurred cost.
 *
 *
 * ORIGINAL DOCUMENTS ARE NOT DELETED.
 *
 * Example:
 *
 * BILL       10,000
 * CREDIT      2,500
 *
 * incurred    7,500
 *
 *
 * LINKAGE
 * -------
 *
 * sourceFinancialDocumentId
 *
 * normally points to:
 *
 * bill
 * supplier-invoice
 * expense
 * work-order
 *
 *
 * IMPORTANT
 * ---------
 *
 * This factory currently owns COST-SIDE
 * credits only.
 *
 * Customer/revenue credit notes will get
 * their own revenue-side treatment rather
 * than silently reusing cost semantics.
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
   CREDIT LINE
   ========================================================= */

function createCostCreditLine({
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
  costCode = "",

  vendorPassportId = "",

  reasonCode = "",

  metadata = {}
} = {}) {

  const resolvedQuantity =
    Math.abs(
      safeNumber(
        quantity,
        1
      )
    );


  const resolvedRate =
    Math.abs(
      roundMoney(
        rate
      )
    );


  const resolvedAmount =
    amount === null ||
    amount === undefined
      ? roundMoney(
          resolvedQuantity *
          resolvedRate
        )
      : roundMoney(
          Math.abs(
            safeNumber(
              amount,
              0
            )
          )
        );


  const lineReferences =
    normalizeReferences([
      ...safeArray(
        references
      ),

      vendorPassportId
        ? {
            passportId:
              vendorPassportId,

            role:
              "vendor"
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
      "credit",

    description:
      clean(
        description ||
        "COST CREDIT"
      ),

    category:
      clean(
        category
      ),

    costCode:
      clean(
        costCode
      ),

    reasonCode:
      clean(
        reasonCode
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

    /*
     * A cost credit offsets prior outflow.
     *
     * Lifecycle recognizes documentType
     * "credit" and reduces incurred cost.
     *
     * Financial fact rollup sees the offset
     * as an inflow against prior outflow.
     */
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
   CREDIT DOCUMENT
   ========================================================= */

function createCostCreditDocument({
  financialDocumentId = "",

  documentNumber = "",

  financialState = "incurred",

  currency = "USD",

  occurredAt = "",

  description = "",

  memo = "",

  references = [],

  lines = [],

  amount = null,

  quantity = 1,

  rate = 0,

  category = "",

  costCode = "",

  reasonCode = "",

  vendorPassportId = "",

  recordedByPassportId = "",

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

      vendorPassportId
        ? {
            passportId:
              vendorPassportId,

            role:
              "vendor"
          }
        : null,

      recordedByPassportId
        ? {
            passportId:
              recordedByPassportId,

            role:
              "recorded-by"
          }
        : null
    ].filter(Boolean));


  let resolvedLines =
    safeArray(
      lines
    ).map(
      line =>
        createCostCreditLine({
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
      createCostCreditLine({
        financialDocumentId:
          resolvedDocumentId,

        description:
          description ||
          "COST CREDIT",

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

        costCode,

        reasonCode,

        vendorPassportId
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
          Math.abs(
            safeNumber(
              line?.amount,
              0
            )
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
      "credit",

    documentNumber:
      clean(
        documentNumber
      ),

    financialState:
      clean(
        financialState ||
        "incurred"
      ).toLowerCase(),

    creditType:
      "cost-credit",

    currency:
      resolvedCurrency,

    occurredAt:
      resolvedOccurredAt,

    description:
      clean(
        description
      ),

    memo:
      clean(
        memo
      ),

    reasonCode:
      clean(
        reasonCode
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
                "credits"
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
   SIMPLE COST CREDIT
   ========================================================= */

function createSimpleCostCredit({
  passportId = "",

  passportRole = "asset",

  amount = 0,

  description = "",

  documentNumber = "",

  occurredAt = "",

  currency = "USD",

  vendorPassportId = "",

  recordedByPassportId = "",

  sourceFinancialDocumentId = "",

  category = "",

  costCode = "",

  reasonCode = "",

  metadata = {}
} = {}) {

  return createCostCreditDocument({
    documentNumber,

    amount,

    description,

    occurredAt,

    currency,

    vendorPassportId,

    recordedByPassportId,

    sourceFinancialDocumentId,

    category,

    costCode,

    reasonCode,

    references: [
      {
        passportId:
          clean(
            passportId
          ),

        role:
          clean(
            passportRole ||
            "asset"
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

  createCostCreditLine,
  createCostCreditDocument,
  createSimpleCostCredit
};
