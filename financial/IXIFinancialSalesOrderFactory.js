"use strict";

const crypto = require("crypto");
const { createInvoiceDocument } = require("./IXIFinancialInvoiceFactory");

const clean = value => String(value ?? "").trim();
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = value => Math.round((number(value) + Number.EPSILON) * 100) / 100;
const randomId = prefix => `${prefix}_${crypto.randomBytes(12).toString("hex")}`;

function createSalesOrderDocument({
  financialDocumentId = "",
  documentNumber = "",
  financialState = "committed",
  currency = "USD",
  occurredAt = "",
  dueDate = "",
  description = "",
  memo = "",
  references = [],
  attachments = [],
  salesOrder = {},
  sourceFinancialDocumentId = "",
  relatedFinancialDocumentIds = [],
  sourceSystem = "",
  sourceDocumentId = "",
  externalReference = "",
  metadata = {}
} = {}) {
  const record = object(salesOrder);
  const id = clean(financialDocumentId) || randomId("ifd");
  const numberValue = clean(documentNumber) || `SO-${id.slice(-8).toUpperCase()}`;
  const subtotal = money(record?.totals?.subtotal);
  const tax = money(record?.totals?.tax);
  const freight = money(record?.totals?.freight);
  const fees = money(record?.totals?.fees);
  const tradeAllowance = money(record?.totals?.tradeAllowance);
  const deposit = money(record?.totals?.deposit);
  const total = money(subtotal + tax + freight + fees - tradeAllowance);
  const balanceDue = money(Math.max(0, total - deposit));
  const canonicalRecord = {
    ...record,
    schema: clean(record.schema || "ixi-equipment-sales-order-v1"),
    identity: {
      ...object(record.identity),
      salesOrderId: id,
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
      deposit,
      total,
      balanceDue
    }
  };

  const document = createInvoiceDocument({
    financialDocumentId: id,
    documentNumber: numberValue,
    financialState: clean(financialState) || "committed",
    currency,
    occurredAt: clean(occurredAt) || new Date().toISOString(),
    dueDate,
    description: clean(description) || `Sales Order · ${clean(record?.customer?.name)} · ${clean(record?.asset?.label)}`,
    memo,
    references,
    amount: subtotal,
    quantity: 1,
    rate: subtotal,
    category: "equipment-sales-order",
    customerPassportId: clean(record?.customer?.passportId),
    issuedByPassportId: clean(record?.context?.actorPassportId),
    sourceFinancialDocumentId,
    relatedFinancialDocumentIds,
    sourceSystem,
    sourceDocumentId,
    externalReference,
    metadata: {
      ...object(metadata),
      transactModule: "equipment-sale",
      salesOrderStatus: clean(record.status || "draft"),
      customerName: clean(record?.customer?.name)
    }
  });

  return {
    ...document,
    documentType: "sales-order",
    attachments: Array.isArray(attachments) ? attachments : [],
    salesOrder: canonicalRecord,
    accountingTreatment: {
      classification: "equipment-sales-order",
      economicEvent: false,
      createsRevenueCommitment: true,
      createsBilledRevenue: false,
      createsReceivable: false,
      createsCashEvent: false,
      invoiceGenerated: Boolean(clean(canonicalRecord?.related?.invoiceId))
    },
    totals: {
      subtotal,
      tax,
      freight,
      fees,
      tradeAllowance,
      deposit,
      customerTotal: total,
      balanceDue,
      total: subtotal
    }
  };
}

module.exports = { createSalesOrderDocument };
