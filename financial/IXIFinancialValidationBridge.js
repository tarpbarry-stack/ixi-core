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
    "material-usage",
    "bill",
    "supplier-invoice",
    "invoice",
    "payment",
    "credit",
    "adjustment",
    "journal-entry",
    "period-close"
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
    "closed"
  ]);


const DIRECTIONS =
  new Set([
    "inflow",
    "outflow",
    "neutral"
  ]);

const TECH_WORK_STATUSES = new Set([
  "requested", "open", "scheduled", "in-progress", "paused", "waiting", "complete", "closed", "canceled"
]);
const TECH_WORK_TYPES = new Set([
  "incident", "service-request", "diagnostic", "configuration", "software-update", "firmware",
  "integration", "telematics-gps", "network-connectivity", "device-hardware", "security-access",
  "deployment-change", "other"
]);
const TECH_WORK_IMPACTS = new Set(["normal", "degraded", "critical"]);
const TECH_WORK_ENVIRONMENTS = new Set(["production", "test", "development", "field", "unknown"]);
const TIME_ENTRY_MODES = new Set(["live", "manual"]);
const TIME_ENTRY_STATUSES = new Set(["running", "paused", "stopped", "recorded", "posted"]);
const MATERIAL_SOURCES = new Set(["inventory", "manual", "purchase-order", "existing-supply"]);
const MATERIAL_UNITS = new Set(["EA", "FT", "YD", "GAL", "QT", "LB", "OZ", "SET", "BOX", "ROLL", "LOT"]);


const EXPENSE_PAYMENT_METHODS =
  new Set([
    "company-card",
    "company-cash",
    "my-money",
    "other"
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

  if (documentType === "expense") {
    const expense = safeObject(source.expense);
    const paymentMethod = clean(
      expense.paymentMethod || source.paymentMethod
    ).toLowerCase();
    const vendor = clean(expense.vendor);
    const category = clean(
      expense.category || normalizedLines[0]?.category
    );

    if (!clean(source.description)) {
      errors.push("expense description is required.");
    }

    if (!vendor) {
      errors.push("expense vendor is required.");
    }

    if (!category) {
      errors.push("expense category is required.");
    }

    if (!EXPENSE_PAYMENT_METHODS.has(paymentMethod)) {
      errors.push("expense paymentMethod is invalid.");
    }

    if (!normalizedLines.some(line => Number(line?.amount) > 0)) {
      errors.push("expense amount must be greater than zero.");
    }

    if (
      expense.receiptRequired === true &&
      !safeArray(source.attachments).some(attachment => {
        const item = safeObject(attachment);
        return Boolean(clean(item.storageKey || item.key)) &&
          ["uploaded", "available", "verified"].includes(
            clean(item.status).toLowerCase()
          );
      })
    ) {
      errors.push("expense receipt is required by policy.");
    }

    if (
      paymentMethod === "my-money" &&
      safeObject(source.reimbursement).required !== true
    ) {
      errors.push("employee-paid expense requires reimbursement lineage.");
    }
  }

  if (
    documentType === "work-order" &&
    clean(source.workOrderType).toLowerCase() === "technology"
  ) {
    const techWorkOrder = safeObject(source.techWorkOrder);
    const identity = safeObject(techWorkOrder.identity);
    const context = safeObject(techWorkOrder.context);
    const work = safeObject(techWorkOrder.work);
    const technology = safeObject(techWorkOrder.technology);
    const result = safeObject(techWorkOrder.result);

    if (clean(techWorkOrder.schema) !== "ixi-tech-work-order-v1") {
      errors.push("technology work order schema is invalid.");
    }
    if (clean(identity.techWorkOrderId) !== financialDocumentId || clean(identity.workOrderId) !== financialDocumentId) {
      errors.push("technology work order identity must match financialDocumentId.");
    }
    if (clean(identity.number) !== clean(source.documentNumber)) {
      errors.push("technology work order number must match documentNumber.");
    }
    if (!clean(context.primaryPassportId)) {
      errors.push("technology work order primary Passport is required.");
    } else if (!normalizedReferences.some(reference => clean(reference.passportId) === clean(context.primaryPassportId))) {
      errors.push("technology work order primary Passport must be referenced by the financial document.");
    }
    if (!clean(work.description)) {
      errors.push("technology work order description is required.");
    }
    if (!TECH_WORK_TYPES.has(clean(work.type).toLowerCase())) {
      errors.push("technology work order type is invalid.");
    }
    if (!TECH_WORK_STATUSES.has(clean(work.status).toLowerCase())) {
      errors.push("technology work order status is invalid.");
    }
    if (!TECH_WORK_IMPACTS.has(clean(work.impact).toLowerCase())) {
      errors.push("technology work order impact is invalid.");
    }
    if (!TECH_WORK_ENVIRONMENTS.has(clean(technology.environment).toLowerCase())) {
      errors.push("technology work order environment is invalid.");
    }
    if (["complete", "closed"].includes(clean(work.status).toLowerCase())) {
      if (!clean(result.workPerformed)) {
        errors.push("completed technology work order requires work performed evidence.");
      }
      if (!clean(technology.validation)) {
        errors.push("completed technology work order requires validation evidence.");
      }
    }
  }

  if (documentType === "time-entry") {
    const timeEntry = safeObject(source.timeEntry);
    const identity = safeObject(timeEntry.identity);
    const context = safeObject(timeEntry.context);
    const time = safeObject(timeEntry.time);
    const status = clean(timeEntry.status).toLowerCase();
    const hours = Number(time.hours);

    if (clean(timeEntry.schema) !== "ixi-time-entry-v2") {
      errors.push("time entry schema is invalid.");
    }
    if (clean(identity.timeEntryId) !== financialDocumentId) {
      errors.push("time entry identity must match financialDocumentId.");
    }
    if (clean(identity.number) !== clean(source.documentNumber)) {
      errors.push("time entry number must match documentNumber.");
    }
    if (!clean(context.primaryPassportId)) {
      errors.push("time entry primary Passport is required.");
    } else if (!normalizedReferences.some(reference => clean(reference.passportId) === clean(context.primaryPassportId))) {
      errors.push("time entry primary Passport must be referenced by the financial document.");
    }
    if (!clean(context.employeePassportId || context.employeeId)) {
      errors.push("time entry employee identity is required.");
    }
    if (clean(context.employeePassportId) && !normalizedReferences.some(reference => clean(reference.passportId) === clean(context.employeePassportId) && ["employee", "technician"].includes(clean(reference.role).toLowerCase()))) {
      errors.push("time entry employee Passport must be referenced as employee or technician.");
    }
    if (!TIME_ENTRY_MODES.has(clean(time.mode).toLowerCase())) {
      errors.push("time entry mode is invalid.");
    }
    if (!TIME_ENTRY_STATUSES.has(status)) {
      errors.push("time entry status is invalid.");
    }
    if (!clean(time.workType)) {
      errors.push("time entry work type is required.");
    }
    if (!clean(time.description)) {
      errors.push("time entry work performed is required.");
    }
    if (!clean(time.date)) {
      errors.push("time entry date is required.");
    }
    if (!Number.isFinite(hours) || hours < 0) {
      errors.push("time entry hours are invalid.");
    } else if (["stopped", "recorded", "posted"].includes(status) && !(hours > 0)) {
      errors.push("completed time entry hours must be greater than zero.");
    }
    if (Number(source?.totals?.laborHours) !== hours) {
      errors.push("time entry total labor hours must match the operational record.");
    }
  }

  if (documentType === "material-usage") {
    const usage = safeObject(source.materialUsage);
    const identity = safeObject(usage.identity);
    const context = safeObject(usage.context);
    const material = safeObject(usage.material);
    const attribution = safeObject(usage.costAttribution);
    const adjustment = safeObject(usage.inventoryAdjustment);
    const receiving = safeObject(usage.receivingConsumption);
    const materialSource = clean(material.source).toLowerCase();
    const quantity = finiteNumber(material.quantity);
    const unitCost = finiteNumber(material.unitCost);
    const extendedCost = roundMoney(material.extendedCost);
    const expectedCost = quantity === null || unitCost === null ? null : roundMoney(quantity * unitCost);

    if (clean(usage.schema) !== "ixi-material-usage-v2") errors.push("material usage schema is invalid.");
    if (clean(identity.materialUsageId) !== financialDocumentId) errors.push("material usage identity must match financialDocumentId.");
    if (clean(identity.number) !== clean(source.documentNumber)) errors.push("material usage number must match documentNumber.");
    if (!clean(context.primaryPassportId)) {
      errors.push("material usage primary Passport is required.");
    } else if (!normalizedReferences.some(reference => clean(reference.passportId) === clean(context.primaryPassportId))) {
      errors.push("material usage primary Passport must be referenced by the financial document.");
    }
    if (!clean(context.employeePassportId || context.employeeId)) errors.push("material usage employee identity is required.");
    if (clean(context.employeePassportId) && !normalizedReferences.some(reference => clean(reference.passportId) === clean(context.employeePassportId) && ["employee", "technician"].includes(clean(reference.role).toLowerCase()))) {
      errors.push("material usage employee Passport must be referenced as employee or technician.");
    }
    if (!MATERIAL_SOURCES.has(materialSource)) errors.push("material usage source is invalid.");
    if (!clean(material.description)) errors.push("material usage description is required.");
    if (quantity === null || !(quantity > 0)) errors.push("material usage quantity must be greater than zero.");
    if (!MATERIAL_UNITS.has(clean(material.unit).toUpperCase())) errors.push("material usage unit is invalid.");
    if (unitCost === null || unitCost < 0) errors.push("material usage unit cost is invalid.");
    if (extendedCost === null || expectedCost === null || extendedCost !== expectedCost) errors.push("material usage extended cost must equal quantity times unit cost.");
    if (!clean(material.dateUsed) || !isValidDate(material.dateUsed)) errors.push("material usage date is required and must be valid.");
    if (Number(attribution.amount) !== extendedCost || clean(attribution.currency).toUpperCase() !== currency || attribution.economicEvent !== false) {
      errors.push("material usage cost attribution must match the material and remain non-economic.");
    }
    if (Number(source?.totals?.materialCost) !== extendedCost) errors.push("material usage total must match extended cost.");
    if (normalizedLines.length !== 1 || Number(normalizedLines[0]?.quantity) !== quantity || Number(normalizedLines[0]?.amount) !== extendedCost || clean(normalizedLines[0]?.direction) !== "neutral") {
      errors.push("material usage requires one matching neutral material line.");
    }
    if (materialSource === "inventory") {
      if (!clean(material.inventoryItemId || material.inventoryPassportId)) errors.push("inventory material usage requires inventory item identity.");
      if (!clean(material.sourceLocationId || material.sourceLocationLabel)) errors.push("inventory material usage requires source location.");
      if (adjustment.required !== true || clean(adjustment.direction) !== "decrement" || Number(adjustment.quantity) !== quantity || clean(adjustment.status) !== "recorded") {
        errors.push("inventory material usage requires a recorded matching decrement.");
      }
      const available = finiteNumber(material.availableQuantity);
      if (available === null || available < quantity) errors.push("inventory material usage exceeds available quantity.");
    } else if (adjustment.required === true) {
      errors.push("non-inventory material usage cannot require inventory decrement.");
    }
    if (materialSource === "purchase-order") {
      if (!clean(material.purchaseOrderId || material.purchaseOrderNumber)) errors.push("purchase-order material usage requires purchase order lineage.");
      if (receiving.required !== true || Number(receiving.quantity) !== quantity || clean(receiving.status) !== "recorded") errors.push("purchase-order material usage requires recorded receiving consumption.");
      const available = finiteNumber(material.availableQuantity);
      if (available === null || available < quantity) errors.push("purchase-order material usage exceeds available received quantity.");
    } else if (receiving.required === true) {
      errors.push("non-purchase-order material usage cannot require receiving consumption.");
    }
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
