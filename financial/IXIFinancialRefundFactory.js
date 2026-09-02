"use strict";

/*
 * IXI FINANCIAL REFUND FACTORY
 *
 * PURPOSE
 * -------
 *
 * Create canonical cash-reversal documents.
 *
 *
 * IMPORTANT
 * ---------
 *
 * A refund is a PAYMENT-family document.
 *
 * documentType = "payment"
 * paymentKind  = "refund"
 *
 *
 * WHY
 * ---
 *
 * Credit changes the economic obligation.
 *
 * Refund reverses cash already settled.
 *
 *
 * CUSTOMER REFUND
 * ---------------
 *
 * Previously:
 *
 * customer payment = inflow / collected
 *
 * Refund:
 *
 * cash goes back OUT
 * collected decreases
 *
 *
 * VENDOR REFUND
 * -------------
 *
 * Previously:
 *
 * vendor payment = outflow / paid
 *
 * Refund:
 *
 * cash comes back IN
 * paid decreases
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


function normalizeRefundSide(
  value
) {
  const side =
    clean(
      value ||
      "customer"
    ).toLowerCase();

  return (
    side === "vendor" ||
    side === "payable"
  )
    ? "vendor"
    : "customer";
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
   REFUND LINE
   ========================================================= */

function createRefundLine({
  financialDocumentId = "",
  financialLineId = "",
  description = "",
  amount = 0,
  currency = "USD",
  occurredAt = "",
  refundSide = "customer",
  references = [],
  metadata = {}
} = {}) {
  const resolvedSide =
    normalizeRefundSide(
      refundSide
    );

  const resolvedAmount =
    roundMoney(
      Math.abs(
        safeNumber(
          amount,
          0
        )
      )
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
      "refund",

    description:
      clean(
        description ||
        "REFUND"
      ),

    quantity:
      1,

    rate:
      resolvedAmount,

    amount:
      resolvedAmount,

    currency:
      normalizeCurrency(
        currency
      ),

    /*
     * Customer refund:
     * cash leaves us.
     *
     * Vendor refund:
     * cash returns to us.
     */
    direction:
      resolvedSide ===
        "customer"
        ? "outflow"
        : "inflow",

    occurredAt:
      clean(
        occurredAt
      ) ||
      nowIso(),

    references:
      normalizeReferences(
        references
      ),

    metadata: {
      ...safeObject(
        metadata
      )
    }
  };
}


/* =========================================================
   REFUND DOCUMENT
   ========================================================= */

function createRefundDocument({
  financialDocumentId = "",
  documentNumber = "",
  financialState = "paid",
  currency = "USD",
  occurredAt = "",
  description = "",
  memo = "",
  amount = 0,
  refundSide = "customer",
  paymentMethod = "",
  confirmationNumber = "",
  references = [],
  customerPassportId = "",
  vendorPassportId = "",
  entityPassportId = "",
  employeePassportId = "",
  machinePassportId = "",
  jobPassportId = "",
  sourceFinancialDocumentId = "",
  parentFinancialDocumentId = "",
  relatedFinancialDocumentIds = [],
  relationships = [],
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


  const resolvedSide =
    normalizeRefundSide(
      refundSide
    );


  const sourceId =
    clean(
      sourceFinancialDocumentId ||
      parentFinancialDocumentId
    );


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

      vendorPassportId
        ? {
            passportId:
              vendorPassportId,

            role:
              "vendor"
          }
        : null,

      entityPassportId
        ? {
            passportId:
              entityPassportId,

            role:
              "entity"
          }
        : null,

      employeePassportId
        ? {
            passportId:
              employeePassportId,

            role:
              "employee"
          }
        : null,

      machinePassportId
        ? {
            passportId:
              machinePassportId,

            role:
              "asset"
          }
        : null,

      jobPassportId
        ? {
            passportId:
              jobPassportId,

            role:
              "job"
          }
        : null
    ].filter(Boolean));


  const resolvedRelationships =
    [
      ...safeArray(
        relationships
      )
    ];


  if (
    sourceId &&
    !resolvedRelationships.some(
      relationship =>
        clean(
          relationship
            ?.financialDocumentId
        ) ===
          sourceId
    )
  ) {
    resolvedRelationships.push({
      financialDocumentId:
        sourceId,

      relationshipType:
        "refunds"
    });
  }


  const line =
    createRefundLine({
      financialDocumentId:
        resolvedDocumentId,

      description,

      amount,

      currency:
        resolvedCurrency,

      occurredAt:
        resolvedOccurredAt,

      refundSide:
        resolvedSide,

      references:
        documentReferences
    });


  return {
    financialDocumentId:
      resolvedDocumentId,

    /*
     * Remains PAYMENT family.
     */
    documentType:
      "payment",

    paymentKind:
      "refund",

    refundSide:
      resolvedSide,

    paymentDirection:
      line.direction,

    documentNumber:
      clean(
        documentNumber
      ),

    financialState:
      clean(
        financialState ||
        "paid"
      ).toLowerCase(),

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

    confirmationNumber:
      clean(
        confirmationNumber
      ),

    sourceFinancialDocumentId:
      sourceId,

    parentFinancialDocumentId:
      clean(
        parentFinancialDocumentId
      ),

    relatedFinancialDocumentIds:
      Array.from(
        new Set(
          safeArray(
            relatedFinancialDocumentIds
          )
            .map(
              clean
            )
            .filter(
              Boolean
            )
        )
      ),

    relationships:
      resolvedRelationships,

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

    references:
      documentReferences,

    lines: [
      line
    ],

    totals: {
      subtotal:
        line.amount,

      total:
        line.amount
    },

    metadata: {
      ...safeObject(
        metadata
      )
    }
  };
}


/* =========================================================
   CUSTOMER REFUND
   ========================================================= */

function createCustomerRefund({
  passportId = "",
  passportRole = "job",
  amount = 0,
  description = "",
  customerPassportId = "",
  entityPassportId = "",
  employeePassportId = "",
  sourceFinancialDocumentId = "",
  occurredAt = "",
  currency = "USD",
  metadata = {}
} = {}) {
  return createRefundDocument({
    refundSide:
      "customer",

    amount,

    description,

    customerPassportId,

    entityPassportId,

    employeePassportId,

    sourceFinancialDocumentId,

    occurredAt,

    currency,

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
   VENDOR REFUND
   ========================================================= */

function createVendorRefund({
  passportId = "",
  passportRole = "asset",
  amount = 0,
  description = "",
  vendorPassportId = "",
  entityPassportId = "",
  employeePassportId = "",
  sourceFinancialDocumentId = "",
  occurredAt = "",
  currency = "USD",
  metadata = {}
} = {}) {
  return createRefundDocument({
    refundSide:
      "vendor",

    amount,

    description,

    vendorPassportId,

    entityPassportId,

    employeePassportId,

    sourceFinancialDocumentId,

    occurredAt,

    currency,

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
  normalizeRefundSide,

  createRefundLine,
  createRefundDocument,

  createCustomerRefund,
  createVendorRefund
};
