"use strict";

/*
 * IXI FINANCIAL RENTAL INCOME FACTORY
 *
 * A Rental Income record is the canonical customer rental contract for an
 * IXI-owned asset. It records custody and projected earned consideration.
 * It is not billed revenue, a receivable, or cash. A linked Invoice converts
 * the contract to billed revenue and a linked Payment records collection.
 */

const crypto = require("crypto");
const { createInvoiceDocument } = require("./IXIFinancialInvoiceFactory");

function clean(value) {
  return String(value ?? "").trim();
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

function createRentalIncomeDocument({
  financialDocumentId = "",
  documentNumber = "",
  financialState = "committed",
  currency = "USD",
  occurredAt = "",
  expectedAt = "",
  description = "",
  memo = "",
  references = [],
  rentalIncome = {},
  sourceSystem = "",
  sourceDocumentId = "",
  externalReference = "",
  metadata = {}
} = {}) {
  const record = safeObject(rentalIncome);
  const projectedRevenue = roundMoney(record?.economics?.projectedRevenue);
  const id = clean(financialDocumentId) || randomId("ifd");
  const number = clean(documentNumber) || `RNTINC-${id.slice(-8).toUpperCase()}`;
  const startDate = clean(record?.period?.startDate);
  const returnDate = clean(record?.period?.actualOffRentDate || record?.period?.expectedReturnDate);
  const customerName = clean(record?.customer?.name);
  const assetLabel = clean(record?.ownedAsset?.label);
  const canonicalRecord = {
    ...record,
    identity: {
      ...safeObject(record.identity),
      rentalIncomeId: id,
      financialDocumentId: id,
      number
    }
  };

  const document = createInvoiceDocument({
    financialDocumentId: id,
    documentNumber: number,
    financialState,
    currency,
    occurredAt: clean(occurredAt) || (startDate ? `${startDate}T12:00:00.000Z` : ""),
    dueDate: clean(expectedAt) || (returnDate ? `${returnDate}T12:00:00.000Z` : ""),
    description: clean(description) || `Rental Income · ${assetLabel} · ${customerName}`,
    memo,
    references,
    amount: projectedRevenue,
    quantity: 1,
    rate: projectedRevenue,
    category: "equipment-rental-income",
    revenueCode: "rental-income",
    customerPassportId: clean(record?.customer?.passportId),
    issuedByPassportId: clean(record?.context?.actorPassportId),
    sourceSystem,
    sourceDocumentId,
    externalReference: clean(externalReference || record?.customer?.rentalAgreementNumber),
    metadata: {
      ...safeObject(metadata),
      transactModule: "rental-income",
      commitmentClass: "customer-rental",
      customerName,
      agreementNumber: clean(record?.customer?.rentalAgreementNumber)
    }
  });

  return {
    ...document,
    documentType: "rental-income",
    expectedAt: document.dueDate,
    dueDate: "",
    rentalIncome: canonicalRecord,
    accountingTreatment: {
      classification: "rental-revenue-contract",
      economicEvent: true,
      createsRevenueCommitment: true,
      createsBilledRevenue: false,
      createsReceivable: false,
      createsCashEvent: false,
      invoiceConsumesRevenueCommitment: true
    },
    totals: {
      projectedRevenue,
      projectedTax: roundMoney(record?.economics?.projectedTax),
      refundableDeposit: roundMoney(record?.economics?.projectedDeposit),
      projectedInvoiceTotal: roundMoney(record?.economics?.projectedInvoiceTotal),
      subtotal: projectedRevenue,
      total: projectedRevenue
    }
  };
}

module.exports = { createRentalIncomeDocument };
