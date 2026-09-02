"use strict";

/*
 * IXI FINANCIAL EXPENSE FACTORY
 *
 * PURPOSE
 * -------
 *
 * Create canonical IXI Financial Documents
 * for EXPENSE activity.
 *
 *
 * THIS FILE OWNS:
 *
 * - expense document construction
 * - expense line construction
 * - reference attribution
 * - canonical IDs
 * - totals
 * - expense metadata normalization
 *
 *
 * THIS FILE DOES NOT:
 *
 * - persist
 * - authorize
 * - calculate recursive scope
 * - calculate snapshots
 * - calculate lifecycle
 *
 *
 * FLOW
 * ----
 *
 * Expense Face / API
 *      ↓
 * Expense Factory
 *      ↓
 * canonical Financial Document
 *      ↓
 * Financial Service
 *      ↓
 * DynamoDB
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

function normalizeFinancialReference(
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


function normalizeFinancialReferences(
  references = []
) {
  const map =
    new Map();

  safeArray(
    references
  ).forEach(
    reference => {
      const normalized =
        normalizeFinancialReference(
          reference
        );

      if (
        !normalized
      ) {
        return;
      }

      const key =
        [
          normalized.passportId,
          normalized.role
        ].join("|");

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
   EXPENSE LINE
   ========================================================= */

function createExpenseLine({
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
  employeePassportId = "",
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
    normalizeFinancialReferences([
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

      employeePassportId
        ? {
            passportId:
              employeePassportId,

            role:
              "employee"
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
      "expense",

    description:
      clean(
        description ||
        "EXPENSE"
      ),

    category:
      clean(
        category
      ),

    costCode:
      clean(
        costCode
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
   EXPENSE DOCUMENT
   ========================================================= */

function createExpenseDocument({
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
  vendorPassportId = "",
  employeePassportId = "",
  paymentMethod = "",
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
    normalizeFinancialReferences([
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

      employeePassportId
        ? {
            passportId:
              employeePassportId,

            role:
              "employee"
          }
        : null
    ].filter(Boolean));


  let resolvedLines =
    safeArray(
      lines
    ).map(
      line =>
        createExpenseLine({
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
   * Convenience mode:
   *
   * If caller supplies no explicit lines,
   * build one expense line from amount/rate.
   */
  if (
    resolvedLines.length ===
      0
  ) {
    resolvedLines = [
      createExpenseLine({
        financialDocumentId:
          resolvedDocumentId,

        description:
          description ||
          "EXPENSE",

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

        employeePassportId
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
      "expense",

    documentNumber:
      clean(
        documentNumber
      ),

    financialState:
      clean(
        financialState ||
        "incurred"
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
   SIMPLE EXPENSE COMMAND
   ========================================================= */

function createSimpleExpense({
  passportId = "",
  passportRole = "asset",
  amount = 0,
  description = "",
  occurredAt = "",
  currency = "USD",
  employeePassportId = "",
  vendorPassportId = "",
  category = "",
  costCode = "",
  metadata = {}
} = {}) {
  return createExpenseDocument({
    amount,

    description,

    occurredAt,

    currency,

    employeePassportId,

    vendorPassportId,

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
  normalizeFinancialReference,
  normalizeFinancialReferences,

  createExpenseLine,
  createExpenseDocument,
  createSimpleExpense
};
