"use strict";

/*
 * IXI FINANCIAL PURCHASE ORDER FACTORY
 *
 * PURPOSE
 * -------
 *
 * Creates canonical IXI Financial Documents
 * representing PURCHASE ORDERS.
 *
 *
 * ECONOMIC MEANING
 * ----------------
 *
 * Purchase Order:
 *
 *     COMMITTED COST
 *
 * It is NOT automatically incurred cost.
 *
 *
 * LIFECYCLE
 * ---------
 *
 * PO
 *   ↓
 * BILL / SUPPLIER INVOICE
 *   ↓
 * PAYMENT
 *
 *
 * Example:
 *
 * PO       $20,000
 * BILL     $18,750
 * PAYMENT  $10,000
 *
 * Financial state:
 *
 * commitment          $20,000
 * remaining commitment $1,250
 * incurred            $18,750
 * paid                $10,000
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
   PURCHASE ORDER LINE
   ========================================================= */

function createPurchaseOrderLine({
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

  itemCode = "",
  unitOfMeasure = "",

  vendorPassportId = "",

  requestedByPassportId = "",

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

      vendorPassportId
        ? {
            passportId:
              vendorPassportId,

            role:
              "vendor"
          }
        : null,

      requestedByPassportId
        ? {
            passportId:
              requestedByPassportId,

            role:
              "requested-by"
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
      "purchase-order",

    description:
      clean(
        description ||
        "PURCHASE ORDER ITEM"
      ),

    category:
      clean(
        category
      ),

    costCode:
      clean(
        costCode
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

    /*
     * PO lines represent future expected
     * outflow.
     *
     * The Lifecycle Engine determines that
     * this is commitment rather than incurred
     * cost from documentType.
     */
    direction:
      "outflow",

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
   PURCHASE ORDER DOCUMENT
   ========================================================= */

function createPurchaseOrderDocument({
  financialDocumentId = "",

  documentNumber = "",

  financialState = "committed",

  currency = "USD",

  occurredAt = "",

  expectedAt = "",

  description = "",

  memo = "",

  references = [],

  lines = [],

  amount = null,

  quantity = 1,

  rate = 0,

  category = "",

  costCode = "",

  vendorPassportId = "",

  requestedByPassportId = "",

  approvedByPassportId = "",

  paymentTerms = "",

  shippingTerms = "",

  sourceSystem = "",

  sourceDocumentId = "",

  externalReference = "",

  purchaseOrderRecord = {},

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

      requestedByPassportId
        ? {
            passportId:
              requestedByPassportId,

            role:
              "requested-by"
          }
        : null,

      approvedByPassportId
        ? {
            passportId:
              approvedByPassportId,

            role:
              "approved-by"
          }
        : null
    ].filter(Boolean));


  let resolvedLines =
    safeArray(
      lines
    ).map(
      line =>
        createPurchaseOrderLine({
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


  /*
   * Convenience single-line PO.
   */
  if (
    resolvedLines.length ===
      0
  ) {

    resolvedLines = [
      createPurchaseOrderLine({
        financialDocumentId:
          resolvedDocumentId,

        description:
          description ||
          "PURCHASE ORDER",

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

        vendorPassportId,

        requestedByPassportId
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


  return {
    financialDocumentId:
      resolvedDocumentId,

    documentType:
      "purchase-order",

    documentNumber:
      clean(
        documentNumber
      ),

    financialState:
      clean(
        financialState ||
        "committed"
      ).toLowerCase(),

    currency:
      resolvedCurrency,

    occurredAt:
      resolvedOccurredAt,

    expectedAt:
      clean(
        expectedAt
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

    shippingTerms:
      clean(
        shippingTerms
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

    purchaseOrderRecord: {
      ...safeObject(
        purchaseOrderRecord
      )
    },

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
   SIMPLE PURCHASE ORDER
   ========================================================= */

function createSimplePurchaseOrder({
  passportId = "",

  passportRole = "asset",

  amount = 0,

  description = "",

  documentNumber = "",

  occurredAt = "",

  expectedAt = "",

  currency = "USD",

  vendorPassportId = "",

  requestedByPassportId = "",

  category = "",

  costCode = "",

  metadata = {}
} = {}) {

  return createPurchaseOrderDocument({
    documentNumber,

    amount,

    description,

    occurredAt,

    expectedAt,

    currency,

    vendorPassportId,

    requestedByPassportId,

    category,

    costCode,

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

  createPurchaseOrderLine,
  createPurchaseOrderDocument,
  createSimplePurchaseOrder
};
