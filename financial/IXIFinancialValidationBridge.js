"use strict";

/*
 * IXI FINANCIAL VALIDATION BRIDGE
 *
 * PURPOSE
 * -------
 *
 * Server-side hard gate for IXI Financial
 * documents before persistence.
 *
 *
 * CORE RULE
 * ---------
 *
 * AWS MUST NOT ACCEPT MALFORMED
 * FINANCIAL RECORDS.
 *
 *
 * This mirrors the frontend Financial
 * validation doctrine without inventing
 * a second financial model.
 *
 *
 * VALIDATES
 * ---------
 *
 * - document identity
 * - document type
 * - financial state
 * - currency
 * - dates
 * - lines
 * - line IDs
 * - line/document ownership
 * - line currency
 * - references
 * - duplicate IDs
 * - totals
 *
 *
 * IMPORTANT
 * ---------
 *
 * This file does NOT:
 *
 * - persist
 * - authorize
 * - resolve AOS hierarchy
 * - generate rollups
 * - mutate malformed input
 */


/* =========================================================
   ENUMS
   ========================================================= */

const DOCUMENT_TYPES =
  new Set([
    "expense",
    "purchase-order",
    "work-order",
    "time-entry",
    "bill",
    "supplier-invoice",
    "invoice",
    "payment",
    "credit",
    "adjustment",
    "journal-entry",
    "period-close",
    "asset-acquisition",
    "rental",
    "quote",
    "settlement",
    "material-usage",
    "service-order",
    "purchase-requisition",
    "collection",
    "receipt",
    "reconciliation",
    "posting-rule",
    "technology-work-order",
    "freight-order"
  ]);


const FINANCIAL_STATES =
  new Set([
    "draft",
    "submitted",
    "approved",
    "rejected",
    "committed",
    "incurred",
    "billed",
    "partially-paid",
    "paid",
    "partially-collected",
    "collected",
    "void",
    "reversed",
    "posted",
    "closed",
    "planned",
    "receivable",
    "received",
    "credited"
  ]);


const DIRECTIONS =
  new Set([
    "inflow",
    "outflow",
    "neutral"
  ]);


/* =========================================================
   HELPERS
   ========================================================= */

function clean(value) {
  return String(value ?? "").trim();
}


function safeArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}


function safeObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}


function finiteNumber(value) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


function roundMoney(value) {
  const number =
    finiteNumber(value);

  if (number === null) {
    return null;
  }

  return Math.round(
    (number + Number.EPSILON) *
    100
  ) / 100;
}


function isValidCurrency(value) {
  return /^[A-Z]{3}$/.test(
    clean(value).toUpperCase()
  );
}


function isValidDate(value) {
  const text =
    clean(value);

  if (!text) {
    return true;
  }

  const date =
    new Date(text);

  return !Number.isNaN(
    date.getTime()
  );
}


function normalizeId(value) {
  return clean(value);
}


function isValidDocumentId(value) {
  const id =
    normalizeId(value);

  if (!id) {
    return false;
  }

  return (
    id.startsWith("ifd_") ||
    id.startsWith("ixi-fin-doc:") ||
    id.startsWith("financial-document:")
  );
}


function isValidLineId(value) {
  const id =
    normalizeId(value);

  if (!id) {
    return false;
  }

  return (
    id.startsWith("ifl_") ||
    id.startsWith("ixi-fin-line:") ||
    id.startsWith("financial-line:")
  );
}


/* =========================================================
   RESULT
   ========================================================= */

function createValidationResult({
  ok = true,
  errors = [],
  warnings = [],
  normalized = null
} = {}) {
  return {
    ok:
      Boolean(ok) &&
      safeArray(errors).length === 0,

    errors:
      safeArray(errors),

    warnings:
      safeArray(warnings),

    normalized
  };
}


/* =========================================================
   REFERENCE VALIDATION
   ========================================================= */

function validateReference(
  reference = {},
  path = "reference"
) {
  const source =
    safeObject(reference);

  const errors =
    [];

  const warnings =
    [];

  const passportId =
    clean(source.passportId);

  const role =
    clean(source.role);

  if (!passportId) {
    errors.push(
      `${path}.passportId is required.`
    );
  }

  if (!role) {
    errors.push(
      `${path}.role is required.`
    );
  }

  return createValidationResult({
    errors,
    warnings,
    normalized: {
      ...source,
      passportId,
      role
    }
  });
}


/* =========================================================
   LINE VALIDATION
   ========================================================= */

function validateLine(
  line = {},
  {
    expectedDocumentId = "",
    expectedCurrency = "",
    index = 0
  } = {}
) {
  const source =
    safeObject(line);

  const errors =
    [];

  const warnings =
    [];

  const path =
    `lines[${index}]`;

  const financialLineId =
    clean(
      source.financialLineId
    );

  const financialDocumentId =
    clean(
      source.financialDocumentId
    );

  const currency =
    clean(
      source.currency ||
      expectedCurrency
    ).toUpperCase();

  const direction =
    clean(
      source.direction ||
      "neutral"
    ).toLowerCase();

  const quantity =
    finiteNumber(
      source.quantity ?? 1
    );

  const rate =
    finiteNumber(
      source.rate ?? 0
    );

  const amount =
    finiteNumber(
      source.amount
    );

  if (!financialLineId) {
    errors.push(
      `${path}.financialLineId is required.`
    );
  } else if (
    !isValidLineId(
      financialLineId
    )
  ) {
    errors.push(
      `${path}.financialLineId is invalid.`
    );
  }

  if (!financialDocumentId) {
    errors.push(
      `${path}.financialDocumentId is required.`
    );
  }

  if (
    expectedDocumentId &&
    financialDocumentId !==
      expectedDocumentId
  ) {
    errors.push(
      `${path}.financialDocumentId does not match parent document.`
    );
  }

  if (!isValidCurrency(currency)) {
    errors.push(
      `${path}.currency must be a 3-letter currency code.`
    );
  }

  if (
    expectedCurrency &&
    currency !==
      expectedCurrency
  ) {
    errors.push(
      `${path}.currency does not match parent document currency.`
    );
  }

  if (quantity === null) {
    errors.push(
      `${path}.quantity must be numeric.`
    );
  } else if (quantity < 0) {
    errors.push(
      `${path}.quantity cannot be negative.`
    );
  }

  if (rate === null) {
    errors.push(
      `${path}.rate must be numeric.`
    );
  }

  if (amount === null) {
    errors.push(
      `${path}.amount must be numeric.`
    );
  }

  if (
    direction &&
    !DIRECTIONS.has(direction)
  ) {
    errors.push(
      `${path}.direction is invalid.`
    );
  }

  if (
    direction === "neutral" &&
    amount !== null &&
    amount !== 0
  ) {
    warnings.push(
      `${path} has a non-zero amount with neutral direction.`
    );
  }

  if (
    source.occurredAt &&
    !isValidDate(
      source.occurredAt
    )
  ) {
    errors.push(
      `${path}.occurredAt is not a valid date.`
    );
  }

  safeArray(
    source.references
  ).forEach(
    (
      reference,
      referenceIndex
    ) => {
      const result =
        validateReference(
          reference,
          `${path}.references[${referenceIndex}]`
        );

      errors.push(
        ...result.errors
      );

      warnings.push(
        ...result.warnings
      );
    }
  );

  return createValidationResult({
    errors,
    warnings,
    normalized: {
      ...source,

      financialLineId,
      financialDocumentId,

      currency,
      direction,

      quantity:
        quantity ?? 0,

      rate:
        rate ?? 0,

      amount:
        amount ?? 0,

      references:
        safeArray(
          source.references
        )
    }
  });
}


/* =========================================================
   DUPLICATE IDS
   ========================================================= */

function getDuplicateIds(
  values = []
) {
  const counts =
    new Map();

  safeArray(
    values
  ).forEach(
    value => {
      const id =
        clean(value);

      if (!id) {
        return;
      }

      counts.set(
        id,
        (
          counts.get(id) ||
          0
        ) + 1
      );
    }
  );

  return Array.from(
    counts.entries()
  )
    .filter(
      ([, count]) =>
        count > 1
    )
    .map(
      ([id]) =>
        id
    );
}


/* =========================================================
   TOTAL VALIDATION
   ========================================================= */

function calculateLineTotal(
  lines = []
) {
  return roundMoney(
    safeArray(lines)
      .reduce(
        (
          total,
          line
        ) => {
          const amount =
            finiteNumber(
              line?.amount
            );

          return (
            total +
            (
              amount === null
                ? 0
                : amount
            )
          );
        },
        0
      )
  );
}


/* =========================================================
   DOCUMENT VALIDATION
   ========================================================= */

function validateFinancialDocument(
  document = {}
) {
  const source =
    safeObject(document);

  const errors =
    [];

  const warnings =
    [];

  const financialDocumentId =
    clean(
      source.financialDocumentId
    );

  const documentType =
    clean(
      source.documentType
    ).toLowerCase();

  const financialState =
    clean(
      source.financialState ||
      "draft"
    ).toLowerCase();

  const currency =
    clean(
      source.currency ||
      "USD"
    ).toUpperCase();

  const lines =
    safeArray(
      source.lines
    );

  const references =
    safeArray(
      source.references
    );

  if (!financialDocumentId) {
    errors.push(
      "financialDocumentId is required."
    );
  } else if (
    !isValidDocumentId(
      financialDocumentId
    )
  ) {
    errors.push(
      "financialDocumentId is invalid."
    );
  }

  if (!documentType) {
    errors.push(
      "documentType is required."
    );
  } else if (
    !DOCUMENT_TYPES.has(
      documentType
    )
  ) {
    errors.push(
      `documentType is invalid: ${documentType}`
    );
  }

  if (
    financialState &&
    !FINANCIAL_STATES.has(
      financialState
    )
  ) {
    errors.push(
      `financialState is invalid: ${financialState}`
    );
  }

  if (!isValidCurrency(currency)) {
    errors.push(
      "currency must be a 3-letter currency code."
    );
  }

  const dateFields = [
    "occurredAt",
    "transactionDate",
    "dueDate",
    "createdAt",
    "updatedAt",
    "approvedAt",
    "paidAt",
    "voidedAt"
  ];

  dateFields.forEach(
    field => {
      if (
        source[field] &&
        !isValidDate(
          source[field]
        )
      ) {
        errors.push(
          `${field} is not a valid date.`
        );
      }
    }
  );

  const normalizedReferences =
    references.map(
      (
        reference,
        index
      ) => {
        const result =
          validateReference(
            reference,
            `references[${index}]`
          );

        errors.push(
          ...result.errors
        );

        warnings.push(
          ...result.warnings
        );

        return result.normalized;
      }
    );

  const normalizedLines =
    lines.map(
      (
        line,
        index
      ) => {
        const result =
          validateLine(
            line,
            {
              expectedDocumentId:
                financialDocumentId,

              expectedCurrency:
                currency,

              index
            }
          );

        errors.push(
          ...result.errors
        );

        warnings.push(
          ...result.warnings
        );

        return result.normalized;
      }
    );

  getDuplicateIds(
    normalizedLines.map(
      line =>
        line.financialLineId
    )
  ).forEach(
    id => {
      errors.push(
        `duplicate financialLineId: ${id}`
      );
    }
  );

  if (normalizedLines.length === 0) {
    warnings.push(
      "document contains no financial lines."
    );
  }

  if (normalizedReferences.length === 0) {
    warnings.push(
      "document contains no Passport references."
    );
  }

  const calculatedTotal =
    calculateLineTotal(
      normalizedLines
    );

  const suppliedTotal =
    source.totals &&
    source.totals.total !==
      undefined
      ? roundMoney(
          source.totals.total
        )
      : null;

  if (
    suppliedTotal !== null &&
    calculatedTotal !==
      suppliedTotal
  ) {
    errors.push(
      `document total ${suppliedTotal} does not equal line total ${calculatedTotal}.`
    );
  }

  const normalizedTotals = {
    ...safeObject(
      source.totals
    ),

    total:
      suppliedTotal === null
        ? calculatedTotal
        : suppliedTotal
  };

  return createValidationResult({
    errors,
    warnings,

    normalized: {
      ...source,

      financialDocumentId,
      documentType,
      financialState,
      currency,

      references:
        normalizedReferences,

      lines:
        normalizedLines,

      totals:
        normalizedTotals
    }
  });
}


/* =========================================================
   PERSISTENCE GATE
   ========================================================= */

function prepareFinancialDocumentForPersistence(
  document = {}
) {
  const validation =
    validateFinancialDocument(
      document
    );

  return {
    allowed:
      validation.ok,

    errors:
      validation.errors,

    warnings:
      validation.warnings,

    financialDocument:
      validation.normalized
  };
}


/* =========================================================
   ASSERT
   ========================================================= */

function assertValidFinancialDocument(
  document = {}
) {
  const result =
    validateFinancialDocument(
      document
    );

  if (!result.ok) {
    const error =
      new Error(
        [
          "Invalid IXI Financial Document.",
          ...result.errors
        ].join(" ")
      );

    error.name =
      "IXIFinancialValidationError";

    error.validation =
      result;

    throw error;
  }

  return result.normalized;
}


/* =========================================================
   EXPORTS
   ========================================================= */

module.exports = {
  DOCUMENT_TYPES,
  FINANCIAL_STATES,
  DIRECTIONS,

  isValidCurrency,
  isValidDate,

  validateReference,
  validateLine,

  getDuplicateIds,
  calculateLineTotal,

  validateFinancialDocument,

  prepareFinancialDocumentForPersistence,

  assertValidFinancialDocument
};
