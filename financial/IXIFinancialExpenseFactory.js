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


function normalizeExpenseDate(
  value
) {
  const candidate =
    clean(
      value
    );

  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    return `${candidate}T00:00:00.000Z`;
  }

  return candidate;
}


function normalizeAttachments(
  attachments = []
) {
  return safeArray(attachments)
    .map(attachment => {
      const source = safeObject(attachment);
      const fileName = clean(source.fileName);
      const storageKey = clean(source.storageKey || source.key);

      if (!fileName && !storageKey) return null;

      return {
        attachmentId:
          clean(source.attachmentId) || randomId("ifa"),
        type: clean(source.type || "receipt"),
        fileName,
        mimeType: clean(source.mimeType),
        size: Math.max(0, safeNumber(source.size, 0)),
        status: clean(source.status || "recorded"),
        storageKey,
        checksum: clean(source.checksum),
        metadata: {
          ...safeObject(source.metadata)
        }
      };
    })
    .filter(Boolean);
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
  vendor = "",
  expenseDate = "",
  paymentMethod = "",
  referenceNumber = "",
  notes = "",
  receiptRequired = false,
  attachments = [],
  relationships = {},
  reimbursement = {},
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
      normalizeExpenseDate(
        occurredAt || expenseDate
      )
    ) ||
    nowIso();

  const resolvedAttachments =
    normalizeAttachments(
      attachments
    );

  const reimbursementSource =
    safeObject(
      reimbursement
    );

  const reimbursementRequired =
    reimbursementSource.required === true ||
    clean(paymentMethod).toLowerCase() === "my-money";

  const hasDurableReceipt =
    resolvedAttachments.some(attachment =>
      Boolean(attachment.storageKey) &&
      ["uploaded", "available", "verified"].includes(
        clean(attachment.status).toLowerCase()
      )
    );


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
      ) ||
      `EXP-${resolvedDocumentId
        .replace(/^ifd_/, "")
        .slice(-8)
        .toUpperCase()}`,

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
        memo || notes
      ),

    paymentMethod:
      clean(
        paymentMethod
      ),

    externalReference:
      clean(
        externalReference || referenceNumber
      ),

    expense: {
      vendor: clean(vendor),
      category: clean(category),
      expenseDate: clean(expenseDate) || resolvedOccurredAt.slice(0, 10),
      paymentMethod: clean(paymentMethod).toLowerCase(),
      referenceNumber: clean(referenceNumber || externalReference),
      notes: clean(notes || memo),
      receiptRequired: receiptRequired === true,
      receiptStatus: hasDurableReceipt
        ? "attached"
        : resolvedAttachments.length
          ? "pending-upload"
          : "missing"
    },

    reimbursement: {
      ...reimbursementSource,
      required: reimbursementRequired,
      employeePassportId: reimbursementRequired
        ? clean(reimbursementSource.employeePassportId || employeePassportId)
        : "",
      amount: reimbursementRequired
        ? roundMoney(reimbursementSource.amount ?? total)
        : 0,
      currency: resolvedCurrency,
      status: reimbursementRequired
        ? clean(reimbursementSource.status || "owed").toLowerCase()
        : "not-applicable"
    },

    relationships: {
      ...safeObject(
        relationships
      )
    },

    attachments:
      resolvedAttachments,

    sourceSystem:
      clean(
        sourceSystem
      ),

    sourceDocumentId:
      clean(
        sourceDocumentId
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
