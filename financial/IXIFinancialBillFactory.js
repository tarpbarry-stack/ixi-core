"use strict";

/*
 * IXI FINANCIAL BILL FACTORY
 *
 * PURPOSE
 * -------
 *
 * Create canonical IXI Financial Documents
 * representing vendor bills / supplier
 * invoices.
 *
 *
 * ECONOMIC MEANING
 * ----------------
 *
 * A Bill represents INCURRED COST.
 *
 * When linked to a Purchase Order:
 *
 * PO commitment is consumed by the Bill.
 *
 *
 * EXAMPLE
 * -------
 *
 * PO      20,000
 * BILL    18,750
 *
 * commitment            20,000
 * remaining commitment   1,250
 * incurred              18,750
 *
 *
 * LINKAGE
 * -------
 *
 * sourceFinancialDocumentId
 *
 * points to the PO being fulfilled.
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
   BILL LINE
   ========================================================= */

function createBillLine({
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
      "bill",

    description:
      clean(
        description ||
        "BILL ITEM"
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
   BILL DOCUMENT
   ========================================================= */

function createBillDocument({
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

  costCode = "",

  vendorPassportId = "",

  receivedByPassportId = "",

  sourceFinancialDocumentId = "",

  relatedFinancialDocumentIds = [],

  paymentTerms = "",

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

      receivedByPassportId
        ? {
            passportId:
              receivedByPassportId,

            role:
              "received-by"
          }
        : null
    ].filter(Boolean));


  let resolvedLines =
    safeArray(
      lines
    ).map(
      line =>
        createBillLine({
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
      createBillLine({
        financialDocumentId:
          resolvedDocumentId,

        description:
          description ||
          "BILL",

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
      "bill",

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

    /*
     * This is the lifecycle link to the PO.
     */
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
                "fulfills"
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
   SUPPLIER INVOICE ALIAS
   ========================================================= */

function createSupplierInvoiceDocument(
  input = {}
) {
  const document =
    createBillDocument(
      input
    );


  return {
    ...document,

    documentType:
      "supplier-invoice",

    lines:
      document.lines.map(
        line => ({
          ...line,

          lineType:
            "supplier-invoice"
        })
      )
  };
}


/* =========================================================
   SIMPLE BILL
   ========================================================= */

function createSimpleBill({
  passportId = "",

  passportRole = "asset",

  amount = 0,

  description = "",

  documentNumber = "",

  occurredAt = "",

  dueDate = "",

  currency = "USD",

  vendorPassportId = "",

  receivedByPassportId = "",

  sourceFinancialDocumentId = "",

  category = "",

  costCode = "",

  metadata = {}
} = {}) {

  return createBillDocument({
    documentNumber,

    amount,

    description,

    occurredAt,

    dueDate,

    currency,

    vendorPassportId,

    receivedByPassportId,

    sourceFinancialDocumentId,

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

  createBillLine,
  createBillDocument,

  createSupplierInvoiceDocument,

  createSimpleBill
};
