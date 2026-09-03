"use strict";

/*
 * IXI FINANCIAL RENTAL EXPENSE FACTORY
 *
 * A Rental Expense is the canonical commitment created when IXI takes
 * temporary custody of an externally owned asset. It records the contract,
 * projected cost, custody, usage, and return lifecycle. It does not create
 * an incurred expense, payable, or cash movement; a linked vendor Bill later
 * consumes this commitment and a Payment settles that Bill.
 */

const crypto = require("crypto");
const {
  createPurchaseOrderDocument
} = require("./IXIFinancialPurchaseOrderFactory");

function clean(value) {
  return String(value ?? "").trim();
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
  return Math.round((safeNumber(value) + Number.EPSILON) * 100) / 100;
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function createRentalExpenseDocument({
  financialDocumentId = "",
  documentNumber = "",
  financialState = "committed",
  currency = "USD",
  occurredAt = "",
  expectedAt = "",
  description = "",
  memo = "",
  references = [],
  rentalExpense = {},
  sourceSystem = "",
  sourceDocumentId = "",
  externalReference = "",
  metadata = {}
} = {}) {
  const record = safeObject(rentalExpense);
  const projectedTotal = roundMoney(record?.economics?.projectedTotal);
  const id = clean(financialDocumentId) || randomId("ifd");
  const number = clean(documentNumber) || `RNTEXP-${id.slice(-8).toUpperCase()}`;
  const startDate = clean(record?.period?.startDate);
  const returnDate = clean(record?.period?.actualOffRentDate || record?.period?.expectedReturnDate);
  const vendorName = clean(record?.vendor?.name);
  const assetDescription = clean(record?.rentedAsset?.description);
  const workOrderFinancialDocumentId = clean(record?.context?.workOrderFinancialDocumentId);
  const canonicalRecord = {
    ...record,
    identity: {
      ...safeObject(record.identity),
      rentalExpenseId: id,
      financialDocumentId: id,
      number
    }
  };

  const document = createPurchaseOrderDocument({
    financialDocumentId: id,
    documentNumber: number,
    financialState,
    currency,
    occurredAt: clean(occurredAt) || (startDate ? `${startDate}T12:00:00.000Z` : ""),
    expectedAt: clean(expectedAt) || (returnDate ? `${returnDate}T12:00:00.000Z` : ""),
    description: clean(description) || `Rental Expense · ${assetDescription}`,
    memo,
    references,
    amount: projectedTotal,
    quantity: 1,
    rate: projectedTotal,
    category: "equipment-rental",
    costCode: clean(record?.custody?.purpose),
    vendorPassportId: clean(record?.vendor?.passportId),
    requestedByPassportId: clean(record?.context?.actorPassportId),
    sourceSystem,
    sourceDocumentId,
    externalReference: clean(externalReference || record?.vendor?.agreementNumber),
    metadata: {
      ...safeObject(metadata),
      transactModule: "rental-expense",
      commitmentClass: "rental",
      vendorName,
      agreementNumber: clean(record?.vendor?.agreementNumber)
    }
  });

  return {
    ...document,
    documentType: "rental-expense",
    sourceFinancialDocumentId: workOrderFinancialDocumentId,
    relatedFinancialDocumentIds: workOrderFinancialDocumentId ? [workOrderFinancialDocumentId] : [],
    relationships: workOrderFinancialDocumentId
      ? [{ financialDocumentId: workOrderFinancialDocumentId, relationshipType: "allocated-to" }]
      : [],
    rentalExpense: canonicalRecord,
    accountingTreatment: {
      classification: "rental-commitment",
      economicEvent: true,
      createsCommitment: true,
      createsIncurredExpense: false,
      createsPayable: false,
      createsCashEvent: false,
      billConsumesCommitment: true
    },
    totals: {
      projectedCommitment: projectedTotal,
      subtotal: projectedTotal,
      total: projectedTotal
    }
  };
}

module.exports = {
  createRentalExpenseDocument
};
