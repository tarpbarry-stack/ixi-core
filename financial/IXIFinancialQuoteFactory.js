"use strict";

/*
 * IXI FINANCIAL EQUIPMENT QUOTE FACTORY
 *
 * A Quote is a durable commercial working record, not an invoice and not an
 * accounting event. Business content is intentionally permissive: a user may
 * save a name, phone number and price, or a complete formal proposal. System
 * identity, entity scope, actor evidence and revision control remain canonical.
 */

const crypto = require("crypto");
const { createInvoiceDocument } = require("./IXIFinancialInvoiceFactory");

const clean = value => String(value ?? "").trim();
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = value => Math.round((number(value) + Number.EPSILON) * 100) / 100;
const randomId = prefix => `${prefix}_${crypto.randomBytes(12).toString("hex")}`;

function createQuoteDocument({
  financialDocumentId = "",
  documentNumber = "",
  financialState = "draft",
  currency = "USD",
  occurredAt = "",
  expectedAt = "",
  description = "",
  memo = "",
  references = [],
  attachments = [],
  quote = {},
  sourceSystem = "",
  sourceDocumentId = "",
  externalReference = "",
  metadata = {}
} = {}) {
  const record = object(quote);
  const id = clean(financialDocumentId) || randomId("ifd");
  const numberValue = clean(documentNumber) || `QT-${id.slice(-8).toUpperCase()}`;
  const quoteDate = clean(record?.commercial?.quoteDate);
  const validThrough = clean(record?.commercial?.validThrough);
  const subtotal = money(record?.totals?.subtotal);
  const tax = money(record?.totals?.tax);
  const freight = money(record?.totals?.freight);
  const fees = money(record?.totals?.fees);
  const tradeAllowance = money(record?.totals?.tradeAllowance);
  const total = money(subtotal + tax + freight + fees - tradeAllowance);
  const canonicalRecord = {
    ...record,
    identity: {
      ...object(record.identity),
      quoteId: id,
      financialDocumentId: id,
      number: numberValue
    },
    totals: {
      ...object(record.totals),
      subtotal,
      tax,
      freight,
      fees,
      tradeAllowance,
      total
    }
  };

  const document = createInvoiceDocument({
    financialDocumentId: id,
    documentNumber: numberValue,
    financialState: clean(financialState) || "draft",
    currency,
    occurredAt: clean(occurredAt) || (quoteDate ? `${quoteDate}T12:00:00.000Z` : ""),
    dueDate: clean(expectedAt) || (validThrough ? `${validThrough}T12:00:00.000Z` : ""),
    description: clean(description) || `Quote · ${clean(record?.customer?.name)} · ${clean(record?.asset?.label)}`,
    memo,
    references,
    amount: subtotal,
    quantity: 1,
    rate: subtotal,
    category: "equipment-quote",
    revenueCode: "",
    customerPassportId: clean(record?.customer?.passportId),
    issuedByPassportId: clean(record?.context?.actorPassportId),
    sourceSystem,
    sourceDocumentId,
    externalReference,
    metadata: {
      ...object(metadata),
      transactModule: "quote",
      quoteRevision: Math.max(1, number(record?.identity?.revision || 1)),
      quoteStatus: clean(record.status || "draft"),
      customerName: clean(record?.customer?.name)
    }
  });

  return {
    ...document,
    documentType: "quote",
    expectedAt: document.dueDate,
    dueDate: "",
    attachments: Array.isArray(attachments) ? attachments : [],
    quote: canonicalRecord,
    accountingTreatment: {
      classification: "equipment-sales-offer",
      economicEvent: false,
      createsRevenueCommitment: false,
      createsBilledRevenue: false,
      createsReceivable: false,
      createsCashEvent: false,
      salesOrderCreated: false
    },
    totals: {
      subtotal,
      tax,
      freight,
      fees,
      tradeAllowance,
      customerTotal: total,
      total: subtotal
    }
  };
}

module.exports = { createQuoteDocument };
