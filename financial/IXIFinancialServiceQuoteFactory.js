"use strict";

/*
 * IXI FINANCIAL SERVICE QUOTE FACTORY
 *
 * A Service Quote is a controlled customer offer. Before acceptance it is
 * non-economic. Acceptance creates a revenue commitment for the authorized
 * service subtotal only; tax, invoicing, receivable, and cash remain separate
 * lifecycle events.
 */

const crypto = require("crypto");
const { createInvoiceDocument } = require("./IXIFinancialInvoiceFactory");

const clean = value => String(value ?? "").trim();
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = value => Math.round((number(value) + Number.EPSILON) * 100) / 100;
const randomId = prefix => `${prefix}_${crypto.randomBytes(12).toString("hex")}`;

function createServiceQuoteDocument({
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
  serviceQuote = {},
  sourceSystem = "",
  sourceDocumentId = "",
  externalReference = "",
  metadata = {}
} = {}) {
  const record = object(serviceQuote);
  const accepted = ["accepted", "converted"].includes(clean(record.status).toLowerCase());
  const quotedSubtotal = money(record?.economics?.quotedServiceRevenue ?? record?.economics?.quotedRevenue);
  const authorizedSubtotal = money(record?.economics?.authorizedServiceRevenue ?? record?.economics?.authorizedRevenue);
  const commitment = accepted ? authorizedSubtotal : quotedSubtotal;
  const tax = money(accepted ? record?.economics?.authorizedTax : record?.commercial?.taxAmount);
  const customerTotal = money(accepted ? record?.economics?.authorizedCustomerTotal : commitment + tax);
  const id = clean(financialDocumentId) || randomId("ifd");
  const numberValue = clean(documentNumber) || `SQ-${id.slice(-8).toUpperCase()}`;
  const quoteDate = clean(record?.commercial?.quoteDate);
  const validThrough = clean(record?.commercial?.validThrough);
  const canonicalRecord = {
    ...record,
    identity: {
      ...object(record.identity),
      serviceQuoteId: id,
      financialDocumentId: id,
      number: numberValue
    }
  };

  const document = createInvoiceDocument({
    financialDocumentId: id,
    documentNumber: numberValue,
    financialState: clean(financialState) || (accepted ? "committed" : "draft"),
    currency,
    occurredAt: clean(occurredAt) || (quoteDate ? `${quoteDate}T12:00:00.000Z` : ""),
    dueDate: clean(expectedAt) || (validThrough ? `${validThrough}T12:00:00.000Z` : ""),
    description: clean(description) || `Service Quote · ${clean(record?.customer?.name)} · ${clean(record?.asset?.label)}`,
    memo,
    references,
    amount: commitment,
    quantity: 1,
    rate: commitment,
    category: "service-quote",
    revenueCode: "service-revenue",
    customerPassportId: clean(record?.customer?.passportId),
    issuedByPassportId: clean(record?.context?.actorPassportId),
    sourceSystem,
    sourceDocumentId,
    externalReference,
    metadata: {
      ...object(metadata),
      transactModule: "service-quote",
      quoteRevision: Number(record?.identity?.revision || 1),
      quoteStatus: clean(record.status),
      customerName: clean(record?.customer?.name)
    }
  });

  return {
    ...document,
    documentType: "service-quote",
    expectedAt: document.dueDate,
    dueDate: "",
    attachments: Array.isArray(attachments) ? attachments : [],
    serviceQuote: canonicalRecord,
    accountingTreatment: {
      classification: accepted ? "service-revenue-contract" : "service-revenue-offer",
      economicEvent: accepted,
      createsRevenueCommitment: accepted,
      createsBilledRevenue: false,
      createsReceivable: false,
      createsCashEvent: false,
      invoiceConsumesRevenueCommitment: true
    },
    totals: {
      quotedServiceRevenue: quotedSubtotal,
      authorizedServiceRevenue: accepted ? authorizedSubtotal : 0,
      tax,
      customerTotal,
      subtotal: commitment,
      total: commitment
    }
  };
}

module.exports = { createServiceQuoteDocument };
