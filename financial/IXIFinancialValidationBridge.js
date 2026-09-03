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
    "asset-acquisition",
    "rental-expense",
    "rental-income",
    "service-quote",
    "collection",
    "settlement",
    "payables-control",
    "treasury-account",
    "treasury-reconciliation",
    "bill",
    "supplier-invoice",
    "invoice",
    "payment",
    "credit",
    "adjustment",
    "journal-entry",
    "period-close",
    "period-reopen",
    "posting-rule"
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
const ASSET_ACQUISITION_TYPES = new Set([
  "direct-purchase", "auction", "trade-in", "dealer", "private-seller", "entity-transfer", "other"
]);
const RENTAL_RATE_UNITS = new Set(["hour", "day", "week", "month"]);
const RENTAL_STATUSES = new Set(["active", "off-rent", "closed", "cancelled"]);
const SERVICE_QUOTE_STATUSES = new Set(["draft", "sent", "viewed", "changes-requested", "accepted", "declined", "expired", "superseded", "converted"]);
const SERVICE_QUOTE_PRICING_TYPES = new Set(["estimate", "fixed-price", "not-to-exceed"]);
const COLLECTION_STATUSES = new Set(["open", "promise-pending", "disputed", "escalated", "resolved", "closed"]);
const SETTLEMENT_STATUSES = new Set(["ready", "approved", "partially-paid", "settled"]);
const SETTLEMENT_PAYMENT_STATUSES = new Set(["unpaid", "partial", "paid"]);
const BILL_APPROVAL_STATUSES = new Set(["pending", "returned", "approved", "rejected"]);
const BILL_CAPTURE_STATES = new Set(["draft", "submitted"]);
const BILL_RECOGNIZED_STATES = new Set(["billed", "incurred", "partially-paid", "paid"]);


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
    "voidedAt",
    "reopenedAt"
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

  if (documentType === "bill" || documentType === "supplier-invoice") {
    const billRecord = safeObject(source.billRecord);
    const identity = safeObject(billRecord.identity);
    const context = safeObject(billRecord.context);
    const bill = safeObject(billRecord.bill);
    const approval = safeObject(billRecord.approval);
    const treatment = safeObject(source.accountingTreatment);
    const invoiceNumber = clean(source.invoiceNumber || identity.invoiceNumber || source.documentNumber);
    const invoiceDate = clean(bill.invoiceDate || source.occurredAt).slice(0, 10);
    const dueDate = clean(bill.dueDate || source.dueDate).slice(0, 10);
    const approvalStatus = clean(approval.status).toLowerCase();
    const recognized = BILL_RECOGNIZED_STATES.has(financialState);

    if (clean(billRecord.schema) !== "ixi-bill-record-v2") errors.push("bill record schema is invalid.");
    if (clean(identity.billDocumentId || identity.financialDocumentId) !== financialDocumentId) errors.push("bill identity must match financialDocumentId.");
    if (!clean(context.entityPassportId)) errors.push("bill entity Passport is required.");
    if (!normalizedReferences.some(reference => clean(reference.passportId) === clean(context.entityPassportId) && clean(reference.role).toLowerCase() === "entity")) errors.push("bill entity Passport must be referenced as the entity.");
    if (!clean(context.primaryPassportId)) errors.push("bill originating AOS Passport is required.");
    if (!normalizedReferences.some(reference => clean(reference.passportId) === clean(context.primaryPassportId))) errors.push("bill originating AOS Passport must be referenced.");
    if (!clean(bill.vendorLabel || source.vendorName)) errors.push("bill vendor is required.");
    if (!invoiceNumber) errors.push("bill vendor invoice number is required.");
    if (!clean(source.invoiceFingerprint) || clean(source.sourceDocumentId).toLowerCase() !== clean(source.invoiceFingerprint).toLowerCase()) errors.push("bill invoice fingerprint is required as sourceDocumentId.");
    if (!clean(bill.description || source.description)) errors.push("bill description is required.");
    if (!isValidDate(invoiceDate)) errors.push("bill invoice date is invalid.");
    if (dueDate && (!isValidDate(dueDate) || dueDate < invoiceDate)) errors.push("bill due date cannot precede invoice date.");
    if (normalizedLines.length !== 1 || !(Number(normalizedLines[0]?.amount) > 0) || clean(normalizedLines[0]?.direction) !== "outflow") errors.push("bill requires one positive outflow line.");
    if (Number(bill.amount) !== Number(calculateLineTotal(normalizedLines))) errors.push("bill amount must equal financial document total.");
    if (!BILL_APPROVAL_STATUSES.has(approvalStatus)) errors.push("bill approval status is invalid.");
    if (approvalStatus === "approved") {
      if (!recognized || !clean(approval.approvedById) || !clean(approval.approvedAt) || !isValidDate(approval.approvedAt)) errors.push("approved bill requires server-bound approval evidence and a recognized financial state.");
    } else if (approvalStatus === "rejected") {
      if (!["rejected", "void"].includes(financialState) || !clean(approval.rejectedById) || !clean(approval.rejectedAt)) errors.push("rejected bill requires rejection evidence and a non-economic state.");
    } else if (!BILL_CAPTURE_STATES.has(financialState)) {
      errors.push("unapproved bill must remain draft or submitted.");
    }
    if (treatment.classification !== (recognized ? "vendor-obligation" : "vendor-bill-capture") || treatment.economicEvent !== recognized || treatment.createsCommitment !== false || treatment.createsIncurredExpense !== recognized || treatment.createsPayable !== recognized || treatment.createsCashEvent !== false || treatment.paymentSettlesPayable !== true) errors.push("bill accounting treatment does not match its approval state.");
    safeArray(source.attachments).forEach((attachment, index) => {
      const item = safeObject(attachment);
      if (!clean(item.storageKey || item.key) || !["uploaded", "available", "verified"].includes(clean(item.status).toLowerCase())) errors.push(`attachments[${index}] must reference durable uploaded evidence.`);
    });
  }

  if (documentType === "payment") {
    if (!normalizedLines.some(line => Number(line?.amount) > 0)) errors.push("payment amount must be greater than zero.");
    if (clean(source.paymentDirection).toLowerCase() === "outflow" && clean(source.sourceFinancialDocumentId) && !clean(source.transactionReference)) errors.push("linked outgoing payment transactionReference is required.");
    const movement=safeObject(source.treasuryMovement),transactionClass=clean(movement.transactionClass).toLowerCase();
    if(transactionClass){
      if(clean(movement.schema)!=="ixi-treasury-movement-v2") errors.push("treasury movement schema is invalid.");
      if(!["opening-balance","cash-adjustment","account-transfer"].includes(transactionClass)) errors.push("treasury movement transaction class is invalid.");
      if(!clean(movement.entityPassportId)||!clean(movement.actorPassportId)) errors.push("treasury movement requires trusted Entity and actor lineage.");
      if(!normalizedReferences.some(reference=>clean(reference.passportId)===clean(movement.entityPassportId)&&clean(reference.role).toLowerCase()==="entity")) errors.push("treasury movement Entity must be referenced.");
      if(movement.nonRevenue!==true||movement.nonExpense!==true||movement.bookEntryStatus!=="posted") errors.push("treasury movement accounting flags are invalid.");
      if(transactionClass==="account-transfer"){
        if(!clean(movement.fromCashAccountFinancialDocumentId)||!clean(movement.toCashAccountFinancialDocumentId)||clean(movement.fromCashAccountFinancialDocumentId)===clean(movement.toCashAccountFinancialDocumentId)) errors.push("treasury transfer requires two different canonical accounts.");
        if(Number(source?.accountingTreatment?.companyCashNetChange)!==0) errors.push("treasury transfer must be company-net-zero.");
      }else if(!clean(movement.cashAccountFinancialDocumentId)) errors.push("treasury movement requires a canonical cash account.");
      if(transactionClass==="cash-adjustment"&&!clean(movement.reason)) errors.push("treasury adjustment reason is required.");
      if(transactionClass!=="opening-balance"&&!clean(source.transactionReference)) errors.push("treasury movement transaction reference is required.");
    }
  }

  if (documentType === "credit") {
    if (!normalizedLines.some(line => Number(line?.amount) > 0)) errors.push("credit amount must be greater than zero.");
    if (clean(source.sourceFinancialDocumentId) && !clean(source.reasonCode)) errors.push("linked vendor credit reasonCode is required.");
  }

  if (documentType === "payables-control") {
    const control=safeObject(source.payablesControl),identity=safeObject(control.identity),context=safeObject(control.context),payable=safeObject(control.payable),treatment=safeObject(source.accountingTreatment);
    if(clean(control.schema)!=="ixi-payables-control-v1") errors.push("payables control schema is invalid.");
    if(clean(identity.payablesControlId)!==financialDocumentId) errors.push("payables control identity must match financialDocumentId.");
    if(!clean(context.entityPassportId)) errors.push("payables control entity Passport is required.");
    if(!clean(payable.billId)||clean(payable.billId)!==clean(source.sourceFinancialDocumentId)) errors.push("payables control requires canonical Bill lineage.");
    if(normalizedLines.length!==0||Number(source?.totals?.total)!==0) errors.push("payables control must remain non-economic.");
    if(treatment.economicEvent!==false||treatment.createsPayable!==false||treatment.createsCashEvent!==false) errors.push("payables control accounting treatment must remain non-economic.");
  }

  if (documentType === "collection") {
    const record = safeObject(source.collectionCase);
    const identity = safeObject(record.identity);
    const receivable = safeObject(record.receivable);
    const customer = safeObject(record.customer);
    const context = safeObject(record.context);
    const treatment = safeObject(source.accountingTreatment);
    const status = clean(record.status || source.status).toLowerCase();
    const originalAmount = Number(receivable.originalAmount);
    const openBalance = Number(receivable.openBalance);

    if (clean(record.schema) !== "ixi-collections-case-v1") errors.push("collection case schema is invalid.");
    if (clean(identity.collectionId) !== financialDocumentId || clean(identity.financialDocumentId) !== financialDocumentId) errors.push("collection case identity must match financialDocumentId.");
    if (!clean(receivable.invoiceId) || clean(receivable.invoiceId) !== clean(source.sourceFinancialDocumentId)) errors.push("collection case requires canonical Invoice lineage.");
    if (!Number.isFinite(originalAmount) || !(originalAmount > 0)) errors.push("collection case original receivable amount must be greater than zero.");
    if (!Number.isFinite(openBalance) || openBalance < 0 || openBalance > originalAmount + 0.005) errors.push("collection case open balance is invalid.");
    if (!clean(customer.label)) errors.push("collection case customer is required.");
    if (!clean(context.entityPassportId) || !clean(context.actorPassportId)) errors.push("collection case requires trusted Entity and actor lineage.");
    if (!normalizedReferences.some(reference => clean(reference.passportId) === clean(context.entityPassportId) && clean(reference.role).toLowerCase() === "entity")) errors.push("collection case Entity must be referenced.");
    if (!COLLECTION_STATUSES.has(status) || financialState !== "submitted") errors.push("collection case state is invalid.");
    if (normalizedLines.length !== 0 || Number(source?.totals?.total) !== 0 || treatment.economicEvent !== false || treatment.createsReceivable !== false || treatment.createsCashEvent !== false) errors.push("collection case must remain a non-economic A/R control.");
  }

  if (documentType === "settlement") {
    const record = safeObject(source.assetSettlement);
    const identity = safeObject(record.identity);
    const context = safeObject(record.context);
    const referencesRecord = safeObject(record.references);
    const waterfall = safeObject(record.waterfall);
    const controls = safeObject(record.controls);
    const treatment = safeObject(source.accountingTreatment);
    const owners = safeArray(waterfall.owners);
    const status = clean(record.status || source.status).toLowerCase();
    const paymentStatus = clean(record.paymentStatus).toLowerCase();

    if (clean(record.schema) !== "ixi-asset-settlement-v1") errors.push("asset settlement schema is invalid.");
    if (clean(identity.settlementId) !== financialDocumentId || clean(identity.financialDocumentId) !== financialDocumentId) errors.push("asset settlement identity must match financialDocumentId.");
    if (!clean(referencesRecord.saleId) || clean(referencesRecord.saleId) !== clean(source.sourceFinancialDocumentId)) errors.push("asset settlement requires canonical Sale lineage.");
    if (!clean(context.assetPassportId || context.assetObjectId)) errors.push("asset settlement requires asset identity.");
    if (!clean(context.entityPassportId) || !clean(context.actorPassportId)) errors.push("asset settlement requires trusted Entity and actor lineage.");
    if (!normalizedReferences.some(reference => clean(reference.passportId) === clean(context.entityPassportId) && clean(reference.role).toLowerCase() === "entity")) errors.push("asset settlement Entity must be referenced.");
    if (!SETTLEMENT_STATUSES.has(status) || !SETTLEMENT_PAYMENT_STATUSES.has(paymentStatus)) errors.push("asset settlement state is invalid.");
    if (!Number.isFinite(Number(waterfall.shareTotal)) || Math.abs(Number(waterfall.shareTotal) - 100) > 0.01 || waterfall.balanced !== true) errors.push("asset settlement waterfall must be balanced and total 100 percent.");
    if (!owners.length || owners.some(owner => !clean(owner?.ownerId) || !clean(owner?.label) || Number(owner?.finalDue) < 0 || Number(owner?.balanceDue) < 0)) errors.push("asset settlement owner waterfall is invalid.");
    if (!Number.isFinite(Number(waterfall.totalFinalDue)) || Number(waterfall.totalFinalDue) < 0) errors.push("asset settlement total due is invalid.");
    if (["approved", "partially-paid", "settled"].includes(status) && (!clean(controls.approvedById) || !isValidDate(clean(controls.approvedAt)) || clean(controls.approvalNote).length < 3)) errors.push("approved asset settlement requires actor, timestamp, and approval-note evidence.");
    if (status === "settled" && paymentStatus !== "paid") errors.push("settled asset settlement must have paid status.");
    if (normalizedLines.length !== 0 || Number(source?.totals?.total) !== 0 || treatment.economicEvent !== false || treatment.createsPayable !== false || treatment.createsCashEvent !== false) errors.push("asset settlement must remain a non-economic owner-distribution control.");
  }

  if(documentType==="treasury-account"){
    const account=safeObject(source.treasuryAccount),identity=safeObject(account.identity),details=safeObject(account.account),context=safeObject(account.context),opening=safeObject(account.opening),control=safeObject(account.control),treatment=safeObject(source.accountingTreatment);
    if(clean(account.schema)!=="ixi-treasury-account-v2") errors.push("treasury account schema is invalid.");
    if(clean(identity.accountId)!==financialDocumentId) errors.push("treasury account identity must match financialDocumentId.");
    if(!clean(context.entityPassportId)) errors.push("treasury account Entity Passport is required.");
    if(!normalizedReferences.some(reference=>clean(reference.passportId)===clean(context.entityPassportId)&&clean(reference.role).toLowerCase()==="entity")) errors.push("treasury account Entity must be referenced.");
    if(!clean(details.name)) errors.push("treasury account name is required.");
    if(!["checking","savings","cash","clearing","money-market"].includes(clean(details.accountType).toLowerCase())) errors.push("treasury account type is invalid.");
    if(!isValidDate(clean(opening.effectiveDate))) errors.push("treasury account opening date is invalid.");
    if(!Number.isFinite(Number(opening.amount))) errors.push("treasury account opening amount is invalid.");
    if(Number(control.minimumCash)<0) errors.push("treasury account minimum cash cannot be negative.");
    if(normalizedLines.length!==0||Number(source?.totals?.total)!==0||treatment.economicEvent!==false||treatment.createsCashEvent!==false) errors.push("treasury account control must remain non-economic.");
  }

  if(documentType==="treasury-reconciliation"){
    const reconciliation=safeObject(source.treasuryReconciliation),identity=safeObject(reconciliation.identity),context=safeObject(reconciliation.context),statement=safeObject(reconciliation.statement),reconciling=safeObject(reconciliation.reconciling),treatment=safeObject(source.accountingTreatment);
    if(clean(reconciliation.schema)!=="ixi-treasury-reconciliation-v2") errors.push("treasury reconciliation schema is invalid.");
    if(clean(identity.reconciliationId)!==financialDocumentId) errors.push("treasury reconciliation identity must match financialDocumentId.");
    if(!clean(reconciliation.accountId)) errors.push("treasury reconciliation account is required.");
    if(!clean(context.entityPassportId)) errors.push("treasury reconciliation Entity Passport is required.");
    if(!isValidDate(clean(statement.date))||!Number.isFinite(Number(statement.balance))) errors.push("treasury reconciliation statement is invalid.");
    const expected=roundMoney(Number(statement.balance||0)+Number(reconciling.depositsInTransit||0)-Number(reconciling.outstandingPayments||0)+Number(reconciling.otherReconcilingItems||0));
    if(Number(reconciling.adjustedBankBalance)!==expected) errors.push("treasury reconciliation adjusted bank balance is invalid.");
    if(normalizedLines.length!==0||Number(source?.totals?.total)!==0||treatment.economicEvent!==false||treatment.createsCashEvent!==false) errors.push("treasury reconciliation must remain non-economic.");
  }

  if(documentType==="period-reopen"){
    const evidence=safeObject(source.permissionEvidence),treatment=safeObject(source.accountingTreatment);
    if(!/^\d{4}-\d{2}$/.test(clean(source.period))) errors.push("period reopen period is invalid.");
    if(clean(source.status).toLowerCase()!=="reopened"||financialState!=="submitted") errors.push("period reopen state is invalid.");
    if(!isValidDate(clean(source.reopenedAt))||!clean(source.reopenedBy)) errors.push("period reopen requires actor and timestamp evidence.");
    if(clean(source.reopenReason).length<10) errors.push("period reopen reason is insufficient.");
    if(!clean(source.priorCloseDocumentId)) errors.push("period reopen requires prior close lineage.");
    if(evidence.action!=="financial.gl.period.reopen"||evidence.allowed!==true||clean(evidence.actorPassportId)!==clean(source.reopenedBy)) errors.push("period reopen permission evidence is invalid.");
    if(normalizedLines.length!==0||Number(source?.totals?.total)!==0||treatment.economicEvent!==false) errors.push("period reopen must remain non-economic.");
  }

  if(documentType==="posting-rule"){
    const rule=safeObject(source.postingRule),identity=safeObject(rule.identity),match=safeObject(rule.match),posting=safeObject(rule.posting),control=safeObject(rule.control),treatment=safeObject(source.accountingTreatment);
    if(clean(rule.schema)!=="ixi-financial-posting-rule-v1") errors.push("posting rule schema is invalid.");
    if(clean(identity.postingRuleDocumentId)!==financialDocumentId||!clean(identity.ruleId)||!Number.isInteger(Number(identity.version))||Number(identity.version)<1) errors.push("posting rule identity or version is invalid.");
    if(!clean(match.documentType)) errors.push("posting rule source document type is required.");
    if(!clean(posting.debitAccountCode)||!clean(posting.creditAccountCode)||clean(posting.debitAccountCode)===clean(posting.creditAccountCode)) errors.push("posting rule requires different debit and credit accounts.");
    if(!clean(control.entityPassportId)||!clean(control.approvedByPassportId)||clean(control.changeReason).length<10) errors.push("posting rule requires Entity, approver, and specific change reason evidence.");
    if(financialState!=="approved"||!["active","inactive"].includes(clean(source.status).toLowerCase())) errors.push("posting rule state is invalid.");
    if(normalizedLines.length!==0||Number(source?.totals?.total)!==0||treatment.economicEvent!==false) errors.push("posting rule must remain non-economic.");
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

  if (documentType === "asset-acquisition") {
    const record = safeObject(source.assetAcquisition);
    const identity = safeObject(record.identity);
    const context = safeObject(record.context);
    const acquisition = safeObject(record.acquisition);
    const ownership = safeObject(record.ownership);
    const funding = safeObject(record.funding);
    const makeReady = safeObject(record.makeReady);
    const treatment = safeObject(source.accountingTreatment);
    const purchasePrice = roundMoney(acquisition.purchasePrice);
    const costs = ["buyerPremium", "tax", "titleFees", "brokerFees", "otherAcquisitionFees"]
      .map(field => roundMoney(acquisition[field]));
    const directCost = roundMoney(acquisition.directAcquisitionCost);
    const expectedDirectCost = purchasePrice === null || costs.some(value => value === null)
      ? null
      : roundMoney(purchasePrice + costs.reduce((sum, value) => sum + value, 0));
    const owners = safeArray(ownership.owners);
    const payments = safeArray(funding.payments);

    if (clean(record.schema) !== "ixi-asset-acquisition-v2") errors.push("asset acquisition schema is invalid.");
    if (clean(identity.acquisitionId) !== financialDocumentId || clean(identity.financialDocumentId) !== financialDocumentId) {
      errors.push("asset acquisition identity must match financialDocumentId.");
    }
    if (clean(identity.number) !== clean(source.documentNumber)) errors.push("asset acquisition number must match documentNumber.");
    if (!clean(context.primaryPassportId)) {
      errors.push("asset acquisition primary Passport is required.");
    } else if (!normalizedReferences.some(reference => clean(reference.passportId) === clean(context.primaryPassportId) && clean(reference.role).toLowerCase() === "asset")) {
      errors.push("asset acquisition primary Passport must be referenced as the asset.");
    }
    if (!clean(context.entityPassportId)) errors.push("asset acquisition entity Passport is required.");
    if (!clean(context.actorPassportId || context.actorId)) errors.push("asset acquisition actor identity is required.");
    if (clean(context.entityPassportId) && !normalizedReferences.some(reference => clean(reference.passportId) === clean(context.entityPassportId) && clean(reference.role).toLowerCase() === "entity")) {
      errors.push("asset acquisition entity Passport must be referenced as the entity.");
    }
    if (clean(context.actorPassportId) && !normalizedReferences.some(reference => clean(reference.passportId) === clean(context.actorPassportId) && clean(reference.role).toLowerCase() === "employee")) {
      errors.push("asset acquisition actor Passport must be referenced as the employee.");
    }
    if (!ASSET_ACQUISITION_TYPES.has(clean(acquisition.type).toLowerCase())) errors.push("asset acquisition type is invalid.");
    if (!clean(acquisition.sellerLabel)) errors.push("asset acquisition seller is required.");
    if (!clean(acquisition.purchaseDate) || !isValidDate(acquisition.purchaseDate)) errors.push("asset acquisition purchase date is required and must be valid.");
    if (purchasePrice === null || !(purchasePrice > 0)) errors.push("asset acquisition purchase price must be greater than zero.");
    if (costs.some(value => value === null || value < 0)) errors.push("asset acquisition capitalized costs must be valid non-negative amounts.");
    if (directCost === null || expectedDirectCost === null || directCost !== expectedDirectCost) errors.push("asset acquisition basis must equal purchase price plus capitalized acquisition costs.");
    if (Number(source?.totals?.purchasePrice) !== purchasePrice || Number(source?.totals?.acquisitionBasis) !== directCost) {
      errors.push("asset acquisition totals must match its canonical basis.");
    }
    if (normalizedLines.length !== 1 || Number(normalizedLines[0]?.amount) !== directCost || clean(normalizedLines[0]?.direction) !== "neutral" || clean(normalizedLines[0]?.lineType) !== "asset-basis") {
      errors.push("asset acquisition requires one matching neutral asset-basis line.");
    }
    if (treatment.classification !== "asset-basis" || treatment.capitalized !== true || treatment.economicEvent !== true || treatment.nonExpense !== true || treatment.nonCash !== true || treatment.createsObligation !== false) {
      errors.push("asset acquisition accounting treatment must capitalize basis without creating expense, cash, or obligation duplication.");
    }
    if (!owners.length || owners.some(owner => !clean(owner?.partyLabel))) errors.push("asset acquisition ownership requires named owners.");
    if (owners.some(owner => Number(owner?.legalOwnershipPercent) < 0 || Number(owner?.legalOwnershipPercent) > 100 || Number(owner?.settlementSharePercent) < 0 || Number(owner?.settlementSharePercent) > 100)) {
      errors.push("asset acquisition ownership percentages must be between zero and 100.");
    }
    if (Math.abs(Number(ownership.legalOwnershipTotal) - 100) > 0.01) errors.push("asset acquisition legal ownership must total 100 percent.");
    if (Math.abs(Number(ownership.settlementShareTotal) - 100) > 0.01) errors.push("asset acquisition settlement shares must total 100 percent.");
    if (payments.some(payment => !clean(payment?.date) || !isValidDate(payment.date) || !(Number(payment?.amount) > 0))) {
      errors.push("asset acquisition funding evidence must have a valid date and positive amount.");
    }
    const expectedAmountPaid = roundMoney(payments.reduce((sum, payment) => sum + Number(payment?.amount || 0), 0));
    if (Number(funding.amountPaid) !== expectedAmountPaid || Number(funding.balanceDue) !== roundMoney(Math.max(0, directCost - expectedAmountPaid))) {
      errors.push("asset acquisition funding totals must match its payment evidence.");
    }
    if (Number(funding.amountPaid) > directCost + 0.005) errors.push("asset acquisition funding evidence cannot exceed direct acquisition cost.");
    if (funding.financed === true && !clean(funding.lenderLabel)) errors.push("financed asset acquisition requires a lender.");
    if (funding.createsCashEvent !== false || funding.createsPayable !== false || clean(funding.treatment) !== "deal-evidence-only") {
      errors.push("asset acquisition funding must remain evidence-only; cash and payable events are separate TRAN$ACT records.");
    }
    if (clean(makeReady.status).toLowerCase() === "closed") {
      if (!clean(makeReady.inServiceDate) || !isValidDate(makeReady.inServiceDate)) errors.push("closed asset acquisition requires a valid in-service date.");
      if (clean(makeReady.inServiceDate) < clean(acquisition.purchaseDate)) errors.push("asset acquisition in-service date cannot precede purchase date.");
    }
    safeArray(source.attachments).forEach((attachment, index) => {
      const item = safeObject(attachment);
      if (!clean(item.storageKey || item.key) || !["uploaded", "available", "verified"].includes(clean(item.status).toLowerCase())) {
        errors.push(`attachments[${index}] must reference durable uploaded evidence.`);
      }
    });
  }

  if (documentType === "rental-expense") {
    const record = safeObject(source.rentalExpense);
    const identity = safeObject(record.identity);
    const context = safeObject(record.context);
    const vendor = safeObject(record.vendor);
    const asset = safeObject(record.rentedAsset);
    const rentalPeriod = safeObject(record.period);
    const rate = safeObject(record.rate);
    const economics = safeObject(record.economics);
    const treatment = safeObject(source.accountingTreatment);
    const projectedTotal = roundMoney(economics.projectedTotal);

    if (clean(record.schema) !== "ixi-rental-expense-v2") errors.push("rental expense schema is invalid.");
    if (clean(identity.rentalExpenseId) !== financialDocumentId || clean(identity.financialDocumentId) !== financialDocumentId) {
      errors.push("rental expense identity must match financialDocumentId.");
    }
    if (clean(identity.number) !== clean(source.documentNumber)) errors.push("rental expense number must match documentNumber.");
    if (!clean(context.primaryPassportId)) {
      errors.push("rental expense primary Passport is required.");
    } else if (!normalizedReferences.some(reference => clean(reference.passportId) === clean(context.primaryPassportId))) {
      errors.push("rental expense primary Passport must be referenced by the financial document.");
    }
    if (!clean(context.entityPassportId)) errors.push("rental expense entity Passport is required.");
    if (!clean(context.actorPassportId || context.actorId)) errors.push("rental expense actor identity is required.");
    if (clean(context.entityPassportId) && !normalizedReferences.some(reference => clean(reference.passportId) === clean(context.entityPassportId) && clean(reference.role).toLowerCase() === "entity")) {
      errors.push("rental expense entity Passport must be referenced as the entity.");
    }
    if (clean(context.actorPassportId) && !normalizedReferences.some(reference => clean(reference.passportId) === clean(context.actorPassportId) && clean(reference.role).toLowerCase() === "employee")) {
      errors.push("rental expense actor Passport must be referenced as the employee.");
    }
    if (clean(context.workOrderFinancialDocumentId) && clean(source.sourceFinancialDocumentId) !== clean(context.workOrderFinancialDocumentId)) {
      errors.push("rental expense Work Order lineage must match sourceFinancialDocumentId.");
    }
    if (!clean(vendor.name)) errors.push("rental expense vendor is required.");
    if (!clean(asset.description)) errors.push("rental expense asset description is required.");
    if (clean(asset.ownershipState) !== "external-owned" || clean(asset.custodyState) !== "rented-in") {
      errors.push("rental expense asset must be externally owned and rented-in.");
    }
    if (!clean(rentalPeriod.startDate) || !isValidDate(rentalPeriod.startDate)) errors.push("rental expense start date is required and must be valid.");
    if (!clean(rentalPeriod.expectedReturnDate) || !isValidDate(rentalPeriod.expectedReturnDate)) errors.push("rental expense expected return date is required and must be valid.");
    if (clean(rentalPeriod.expectedReturnDate) && clean(rentalPeriod.startDate) && clean(rentalPeriod.expectedReturnDate) < clean(rentalPeriod.startDate)) {
      errors.push("rental expense expected return date cannot precede start date.");
    }
    if (!RENTAL_RATE_UNITS.has(clean(rate.unit).toLowerCase()) || !(Number(rate.baseRate) > 0)) {
      errors.push("rental expense requires a positive rate and valid rate basis.");
    }
    if (!RENTAL_STATUSES.has(clean(record.status).toLowerCase())) errors.push("rental expense status is invalid.");
    if (projectedTotal === null || !(projectedTotal > 0)) errors.push("rental expense projected total must be greater than zero.");
    if (normalizedLines.length !== 1 || Number(normalizedLines[0]?.amount) !== projectedTotal || clean(normalizedLines[0]?.direction) !== "outflow") {
      errors.push("rental expense requires one matching outflow commitment line.");
    }
    if (Number(source?.totals?.projectedCommitment) !== projectedTotal || Number(source?.totals?.total) !== projectedTotal) {
      errors.push("rental expense totals must match projected commitment.");
    }
    if (treatment.classification !== "rental-commitment" || treatment.economicEvent !== true || treatment.createsCommitment !== true || treatment.createsIncurredExpense !== false || treatment.createsPayable !== false || treatment.createsCashEvent !== false || treatment.billConsumesCommitment !== true) {
      errors.push("rental expense accounting treatment must create one commitment without expense, payable, or cash duplication.");
    }
    safeArray(source.attachments).forEach((attachment, index) => {
      const item = safeObject(attachment);
      if (!clean(item.storageKey || item.key) || !["uploaded", "available", "verified"].includes(clean(item.status).toLowerCase())) {
        errors.push(`attachments[${index}] must reference durable uploaded evidence.`);
      }
    });
  }

  if (documentType === "rental-income") {
    const record = safeObject(source.rentalIncome);
    const identity = safeObject(record.identity);
    const context = safeObject(record.context);
    const customer = safeObject(record.customer);
    const asset = safeObject(record.ownedAsset);
    const rentalPeriod = safeObject(record.period);
    const rate = safeObject(record.rate);
    const economics = safeObject(record.economics);
    const treatment = safeObject(source.accountingTreatment);
    const projectedRevenue = roundMoney(economics.projectedRevenue);

    if (clean(record.schema) !== "ixi-rental-income-v2") errors.push("rental income schema is invalid.");
    if (clean(identity.rentalIncomeId) !== financialDocumentId || clean(identity.financialDocumentId) !== financialDocumentId) {
      errors.push("rental income identity must match financialDocumentId.");
    }
    if (clean(identity.number) !== clean(source.documentNumber)) errors.push("rental income number must match documentNumber.");
    if (!clean(context.primaryPassportId)) errors.push("rental income asset Passport is required.");
    else if (!normalizedReferences.some(reference => clean(reference.passportId) === clean(context.primaryPassportId) && clean(reference.role).toLowerCase() === "asset")) {
      errors.push("rental income asset Passport must be referenced as the asset.");
    }
    if (!clean(context.entityPassportId)) errors.push("rental income entity Passport is required.");
    if (!clean(context.actorPassportId || context.actorId)) errors.push("rental income actor identity is required.");
    if (clean(context.entityPassportId) && !normalizedReferences.some(reference => clean(reference.passportId) === clean(context.entityPassportId) && clean(reference.role).toLowerCase() === "entity")) {
      errors.push("rental income entity Passport must be referenced as the entity.");
    }
    if (clean(context.actorPassportId) && !normalizedReferences.some(reference => clean(reference.passportId) === clean(context.actorPassportId) && clean(reference.role).toLowerCase() === "employee")) {
      errors.push("rental income actor Passport must be referenced as the employee.");
    }
    if (!clean(customer.name)) errors.push("rental income customer is required.");
    if (!clean(asset.label) || clean(asset.passportId) !== clean(context.primaryPassportId)) errors.push("rental income must identify the selected owned asset.");
    if (clean(asset.ownershipState) !== "owned" || !["customer-custody", "returned"].includes(clean(asset.custodyState))) {
      errors.push("rental income asset must remain owned and be in customer custody or returned.");
    }
    if (!clean(rentalPeriod.startDate) || !isValidDate(rentalPeriod.startDate)) errors.push("rental income start date is required and must be valid.");
    if (!clean(rentalPeriod.expectedReturnDate) || !isValidDate(rentalPeriod.expectedReturnDate)) errors.push("rental income expected return date is required and must be valid.");
    if (clean(rentalPeriod.expectedReturnDate) && clean(rentalPeriod.startDate) && clean(rentalPeriod.expectedReturnDate) < clean(rentalPeriod.startDate)) {
      errors.push("rental income expected return date cannot precede start date.");
    }
    if (!RENTAL_RATE_UNITS.has(clean(rate.unit).toLowerCase()) || !(Number(rate.baseRate) > 0)) errors.push("rental income requires a positive rate and valid rate basis.");
    if (!RENTAL_STATUSES.has(clean(record.status).toLowerCase())) errors.push("rental income status is invalid.");
    if (projectedRevenue === null || !(projectedRevenue > 0)) errors.push("rental income projected revenue must be greater than zero.");
    if (normalizedLines.length !== 1 || Number(normalizedLines[0]?.amount) !== projectedRevenue || clean(normalizedLines[0]?.direction) !== "inflow") {
      errors.push("rental income requires one matching inflow contract line.");
    }
    if (Number(source?.totals?.projectedRevenue) !== projectedRevenue || Number(source?.totals?.total) !== projectedRevenue) {
      errors.push("rental income totals must match projected revenue.");
    }
    if (treatment.classification !== "rental-revenue-contract" || treatment.economicEvent !== true || treatment.createsRevenueCommitment !== true || treatment.createsBilledRevenue !== false || treatment.createsReceivable !== false || treatment.createsCashEvent !== false || treatment.invoiceConsumesRevenueCommitment !== true) {
      errors.push("rental income accounting treatment must create one revenue commitment without billed revenue, receivable, or cash duplication.");
    }
    safeArray(source.attachments).forEach((attachment, index) => {
      const item = safeObject(attachment);
      if (!clean(item.storageKey || item.key) || !["uploaded", "available", "verified"].includes(clean(item.status).toLowerCase())) errors.push(`attachments[${index}] must reference durable uploaded evidence.`);
    });
  }

  if (documentType === "service-quote") {
    const record = safeObject(source.serviceQuote);
    const identity = safeObject(record.identity);
    const context = safeObject(record.context);
    const customer = safeObject(record.customer);
    const asset = safeObject(record.asset);
    const request = safeObject(record.request);
    const commercial = safeObject(record.commercial);
    const economics = safeObject(record.economics);
    const acceptance = safeObject(record.acceptance);
    const treatment = safeObject(source.accountingTreatment);
    const status = clean(record.status).toLowerCase();
    const accepted = ["accepted", "converted"].includes(status);
    const quotedSubtotal = roundMoney(economics.quotedServiceRevenue);
    const authorizedSubtotal = roundMoney(economics.authorizedServiceRevenue);
    const tax = roundMoney(accepted ? economics.authorizedTax : commercial.taxAmount);
    const total = roundMoney(accepted ? authorizedSubtotal : quotedSubtotal);

    if (clean(record.schema) !== "ixi-service-quote-v2") errors.push("service quote schema is invalid.");
    if (clean(identity.serviceQuoteId) !== financialDocumentId || clean(identity.financialDocumentId) !== financialDocumentId) errors.push("service quote identity must match financialDocumentId.");
    if (clean(identity.number) !== clean(source.documentNumber)) errors.push("service quote number must match documentNumber.");
    if (!clean(context.primaryPassportId)) errors.push("service quote asset Passport is required.");
    else if (!normalizedReferences.some(reference => clean(reference.passportId) === clean(context.primaryPassportId) && clean(reference.role).toLowerCase() === "asset")) errors.push("service quote asset Passport must be referenced as the asset.");
    if (!clean(context.entityPassportId)) errors.push("service quote entity Passport is required.");
    if (!clean(context.actorPassportId || context.actorId)) errors.push("service quote actor identity is required.");
    if (clean(context.entityPassportId) && !normalizedReferences.some(reference => clean(reference.passportId) === clean(context.entityPassportId) && clean(reference.role).toLowerCase() === "entity")) errors.push("service quote entity Passport must be referenced as the entity.");
    if (clean(context.actorPassportId) && !normalizedReferences.some(reference => clean(reference.passportId) === clean(context.actorPassportId) && clean(reference.role).toLowerCase() === "employee")) errors.push("service quote actor Passport must be referenced as the employee.");
    if (!clean(customer.name)) errors.push("service quote customer is required.");
    if (!clean(asset.label) || clean(asset.passportId) !== clean(context.primaryPassportId)) errors.push("service quote must identify the selected asset.");
    if (!clean(request.problem) || !clean(request.customerScope)) errors.push("service quote problem and customer-facing scope are required.");
    if (!SERVICE_QUOTE_STATUSES.has(status)) errors.push("service quote status is invalid.");
    if (!SERVICE_QUOTE_PRICING_TYPES.has(clean(commercial.pricingType).toLowerCase())) errors.push("service quote pricing type is invalid.");
    if (!clean(commercial.quoteDate) || !isValidDate(commercial.quoteDate) || !clean(commercial.validThrough) || !isValidDate(commercial.validThrough)) errors.push("service quote dates are required and must be valid.");
    if (clean(commercial.validThrough) < clean(commercial.quoteDate)) errors.push("service quote valid-through date cannot precede quote date.");
    if (quotedSubtotal === null || !(quotedSubtotal > 0)) errors.push("service quote subtotal must be greater than zero.");
    if (tax === null || tax < 0) errors.push("service quote tax must be a non-negative amount.");
    if (normalizedLines.length !== 1 || Number(normalizedLines[0]?.amount) !== total || clean(normalizedLines[0]?.direction) !== "inflow") errors.push("service quote requires one matching inflow offer or commitment line.");
    if (Number(source?.totals?.total) !== total || Number(source?.totals?.tax) !== tax) errors.push("service quote totals must separate service value from tax.");
    if (accepted) {
      if (!(authorizedSubtotal > 0) || acceptance.status !== "accepted" || Number(acceptance.acceptedRevision) !== Number(identity.revision) || !clean(acceptance.acceptedBy) || !clean(acceptance.method) || !clean(acceptance.acceptedAt) || !isValidDate(acceptance.acceptedAt)) errors.push("accepted service quote requires complete acceptance evidence for the current revision.");
      if (Number(economics.authorizedCustomerTotal) !== roundMoney(authorizedSubtotal + tax)) errors.push("accepted service quote customer total must equal authorized service value plus tax.");
      if (treatment.classification !== "service-revenue-contract" || treatment.economicEvent !== true || treatment.createsRevenueCommitment !== true) errors.push("accepted service quote must create one revenue commitment.");
    } else if (treatment.classification !== "service-revenue-offer" || treatment.economicEvent !== false || treatment.createsRevenueCommitment !== false) {
      errors.push("unaccepted service quote must remain a non-economic offer.");
    }
    if (treatment.createsBilledRevenue !== false || treatment.createsReceivable !== false || treatment.createsCashEvent !== false || treatment.invoiceConsumesRevenueCommitment !== true) errors.push("service quote cannot create billed revenue, receivable, or cash.");
    safeArray(source.attachments).forEach((attachment, index) => {
      const item = safeObject(attachment);
      if (!clean(item.storageKey || item.key) || !["uploaded", "available", "verified"].includes(clean(item.status).toLowerCase())) errors.push(`attachments[${index}] must reference durable uploaded evidence.`);
    });
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
