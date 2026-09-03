"use strict";

/*
 * IXI FINANCIAL PAYMENT FACTORY
 *
 * PURPOSE
 * -------
 *
 * Create canonical IXI Financial Documents
 * representing PAYMENTS.
 *
 *
 * ECONOMIC MEANING
 * ----------------
 *
 * Payment does NOT create incurred cost.
 *
 * It settles an existing obligation.
 *
 *
 * OUTBOUND:
 *
 * PO
 *  ↓
 * BILL
 *  ↓
 * PAYMENT
 *
 *
 * INBOUND:
 *
 * INVOICE
 *   ↓
 * PAYMENT
 *
 *
 * paymentDirection:
 *
 * outflow = money paid
 * inflow  = money collected
 *
 *
 * LINKAGE
 * -------
 *
 * sourceFinancialDocumentId
 *
 * points to the Bill / Invoice being settled.
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


function normalizePaymentDirection(
  value
) {
  const direction =
    clean(
      value ||
      "outflow"
    ).toLowerCase();


  if (
    direction === "inflow"
  ) {
    return "inflow";
  }


  return "outflow";
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
   PAYMENT LINE
   ========================================================= */

function createPaymentLine({
  financialDocumentId = "",
  financialLineId = "",

  description = "",

  amount = 0,

  currency = "USD",

  paymentDirection = "outflow",

  occurredAt = "",

  references = [],

  paymentMethod = "",

  transactionReference = "",

  metadata = {}
} = {}) {

  const direction =
    normalizePaymentDirection(
      paymentDirection
    );


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
      "payment",

    description:
      clean(
        description ||
        (
          direction === "inflow"
            ? "PAYMENT RECEIVED"
            : "PAYMENT"
        )
      ),

    quantity:
      1,

    rate:
      roundMoney(
        amount
      ),

    amount:
      roundMoney(
        Math.abs(
          safeNumber(
            amount,
            0
          )
        )
      ),

    currency:
      normalizeCurrency(
        currency
      ),

    direction,

    occurredAt:
      clean(
        occurredAt
      ) ||
      nowIso(),

    references:
      normalizeReferences(
        references
      ),

    paymentMethod:
      clean(
        paymentMethod
      ),

    transactionReference:
      clean(
        transactionReference
      ),

    metadata: {
      ...safeObject(
        metadata
      )
    }
  };
}


/* =========================================================
   PAYMENT DOCUMENT
   ========================================================= */

function createPaymentDocument({
  financialDocumentId = "",

  documentNumber = "",

  financialState = "paid",

  paymentDirection = "outflow",

  currency = "USD",

  occurredAt = "",

  description = "",

  memo = "",

  references = [],

  lines = [],

  amount = 0,

  payerPassportId = "",

  payeePassportId = "",

  employeePassportId = "",

  sourceFinancialDocumentId = "",

  relatedFinancialDocumentIds = [],

  paymentMethod = "",

  transactionReference = "",

  bankReference = "",

  checkNumber = "",

  sourceSystem = "",

  sourceDocumentId = "",

  externalReference = "",

  treasuryMovement = {},

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


  const resolvedDirection =
    normalizePaymentDirection(
      paymentDirection
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

      payerPassportId
        ? {
            passportId:
              payerPassportId,

            role:
              "payer"
          }
        : null,

      payeePassportId
        ? {
            passportId:
              payeePassportId,

            role:
              "payee"
          }
        : null,

      employeePassportId
        ? {
            passportId:
              employeePassportId,

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
        createPaymentLine({
          ...safeObject(
            line
          ),

          financialDocumentId:
            resolvedDocumentId,

          currency:
            line?.currency ||
            resolvedCurrency,

          paymentDirection:
            line?.paymentDirection ||
            line?.direction ||
            resolvedDirection,

          occurredAt:
            line?.occurredAt ||
            resolvedOccurredAt,

          references:
            line?.references ||
            documentReferences,

          paymentMethod:
            line?.paymentMethod ||
            paymentMethod,

          transactionReference:
            line?.transactionReference ||
            transactionReference
        })
    );


  if (
    resolvedLines.length ===
      0
  ) {

    resolvedLines = [
      createPaymentLine({
        financialDocumentId:
          resolvedDocumentId,

        description:
          description ||
          (
            resolvedDirection ===
              "inflow"
              ? "PAYMENT RECEIVED"
              : "PAYMENT"
          ),

        amount,

        currency:
          resolvedCurrency,

        paymentDirection:
          resolvedDirection,

        occurredAt:
          resolvedOccurredAt,

        references:
          documentReferences,

        paymentMethod,

        transactionReference
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

  const movementSource = safeObject(treasuryMovement);
  const transactionClass = clean(movementSource.transactionClass).toLowerCase();
  const normalizedTreasuryMovement = transactionClass ? {
    schema: "ixi-treasury-movement-v2",
    transactionClass,
    cashAccountFinancialDocumentId: clean(movementSource.cashAccountFinancialDocumentId),
    fromCashAccountFinancialDocumentId: clean(movementSource.fromCashAccountFinancialDocumentId),
    toCashAccountFinancialDocumentId: clean(movementSource.toCashAccountFinancialDocumentId),
    entityPassportId: clean(movementSource.entityPassportId),
    actorPassportId: clean(movementSource.actorPassportId),
    reason: clean(movementSource.reason),
    evidenceReference: clean(movementSource.evidenceReference || transactionReference),
    openingSource: clean(movementSource.openingSource),
    bookEntryStatus: "posted",
    bankSettlementStatus: clean(bankReference) ? "referenced" : "unverified",
    nonRevenue: true,
    nonExpense: true
  } : null;


  return {
    financialDocumentId:
      resolvedDocumentId,

    documentType:
      "payment",

    documentNumber:
      clean(
        documentNumber
      ),

    financialState:
      clean(
        financialState ||
        "paid"
      ).toLowerCase(),

    paymentDirection:
      resolvedDirection,

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

    paymentMethod:
      clean(
        paymentMethod
      ),

    transactionReference:
      clean(
        transactionReference
      ),

    bankReference:
      clean(
        bankReference
      ),

    checkNumber:
      clean(
        checkNumber
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
     * Bill or Invoice being settled.
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
                "settles"
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

    ...(normalizedTreasuryMovement ? {
      treasuryMovement: normalizedTreasuryMovement,
      accountingTreatment: {
        classification: transactionClass === "account-transfer" ? "internal-cash-transfer" : "treasury-cash-event",
        economicEvent: true,
        createsCashEvent: true,
        createsRevenue: false,
        createsExpense: false,
        companyCashNetChange: transactionClass === "account-transfer" ? 0 : (resolvedDirection === "inflow" ? total : -total)
      }
    } : {}),

    metadata: {
      ...safeObject(
        metadata
      )
    }
  };
}


/* =========================================================
   SIMPLE OUTBOUND PAYMENT
   ========================================================= */

function createSimplePayment({
  passportId = "",

  passportRole = "asset",

  amount = 0,

  description = "",

  documentNumber = "",

  occurredAt = "",

  currency = "USD",

  payerPassportId = "",

  payeePassportId = "",

  employeePassportId = "",

  sourceFinancialDocumentId = "",

  paymentMethod = "",

  transactionReference = "",

  checkNumber = "",

  metadata = {}
} = {}) {

  return createPaymentDocument({
    documentNumber,

    amount,

    description,

    occurredAt,

    currency,

    paymentDirection:
      "outflow",

    payerPassportId,

    payeePassportId,

    employeePassportId,

    sourceFinancialDocumentId,

    paymentMethod,

    transactionReference,

    checkNumber,

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
   SIMPLE INBOUND PAYMENT
   ========================================================= */

function createSimpleReceipt({
  passportId = "",

  passportRole = "customer",

  amount = 0,

  description = "",

  documentNumber = "",

  occurredAt = "",

  currency = "USD",

  payerPassportId = "",

  payeePassportId = "",

  employeePassportId = "",

  sourceFinancialDocumentId = "",

  paymentMethod = "",

  transactionReference = "",

  metadata = {}
} = {}) {

  return createPaymentDocument({
    documentNumber,

    amount,

    description,

    occurredAt,

    currency,

    paymentDirection:
      "inflow",

    payerPassportId,

    payeePassportId,

    employeePassportId,

    sourceFinancialDocumentId,

    paymentMethod,

    transactionReference,

    references: [
      {
        passportId:
          clean(
            passportId
          ),

        role:
          clean(
            passportRole ||
            "customer"
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
  normalizePaymentDirection,

  normalizeReference,
  normalizeReferences,

  createPaymentLine,
  createPaymentDocument,

  createSimplePayment,
  createSimpleReceipt
};
