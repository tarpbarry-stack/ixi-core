"use strict";

const crypto = require("crypto");

const clean = value => String(value ?? "").trim();
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = value => Array.isArray(value) ? value : [];
const money = value => Math.round((Number(value) || 0) * 100) / 100;
const id = prefix => `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
const deterministicId = (prefix, ...parts) => {
  const seed = parts.map(clean).filter(Boolean).join("|");
  if (!seed) return id("ifd");
  const digest = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return `ifd_${prefix}_${digest}`;
};
const currency = value => /^[A-Z]{3}$/.test(clean(value).toUpperCase()) ? clean(value).toUpperCase() : "USD";

function references(values = []) {
  const unique = new Map();
  for (const value of array(values)) {
    const source = object(value);
    const passportId = clean(source.passportId);
    const externalId = clean(source.externalId);
    const role = clean(source.role).toLowerCase();
    if ((!passportId && !externalId) || !role) continue;
    unique.set(`${role}:${passportId || externalId}`, {
      passportId,
      externalId,
      role,
      label: clean(source.label),
      objectType: clean(source.objectType),
      metadata: { ...object(source.metadata) }
    });
  }
  return [...unique.values()];
}

function relationship(financialDocumentId, relationshipType) {
  const target = clean(financialDocumentId);
  return target ? { financialDocumentId: target, relationshipType } : null;
}

function createCollectionDocument({
  financialDocumentId = "",
  documentNumber = "",
  currency: currencyCode = "USD",
  occurredAt = "",
  description = "",
  references: suppliedReferences = [],
  sourceFinancialDocumentId = "",
  collectionCase = {},
  entityPassportId = "",
  actorPassportId = "",
  metadata = {}
} = {}) {
  const timestamp = clean(occurredAt) || new Date().toISOString();
  const source = object(collectionCase);
  const invoiceId = clean(sourceFinancialDocumentId || source?.receivable?.invoiceId);
  const entity = clean(entityPassportId || source?.context?.entityPassportId);
  const actor = clean(actorPassportId || source?.context?.actorPassportId);
  const documentId = clean(financialDocumentId) || deterministicId("collection", entity, invoiceId);
  const number = clean(documentNumber || source?.identity?.number || `COLL-${documentId.slice(-8).toUpperCase()}`);
  const canonical = {
    ...source,
    schema: "ixi-collections-case-v1",
    identity: {
      ...object(source.identity),
      collectionId: documentId,
      financialDocumentId: documentId,
      number
    },
    receivable: {
      ...object(source.receivable),
      invoiceId,
      originalAmount: money(source?.receivable?.originalAmount),
      openBalance: money(source?.receivable?.openBalance)
    },
    context: {
      ...object(source.context),
      entityPassportId: entity,
      actorPassportId: actor
    },
    status: clean(source.status || "open").toLowerCase(),
    audit: {
      ...object(source.audit),
      createdAt: clean(source?.audit?.createdAt) || timestamp,
      createdBy: clean(source?.audit?.createdBy) || actor,
      updatedAt: timestamp,
      updatedBy: actor
    }
  };
  const documentReferences = references([
    ...array(suppliedReferences),
    entity ? { passportId: entity, role: "entity" } : null,
    actor ? { passportId: actor, role: "recorded-by" } : null
  ]);

  return {
    financialDocumentId: documentId,
    documentType: "collection",
    documentNumber: number,
    financialState: "submitted",
    status: canonical.status,
    currency: currency(currencyCode),
    occurredAt: timestamp,
    description: clean(description) || `Collection Case · ${clean(canonical?.customer?.label)} · ${clean(canonical?.receivable?.invoiceNumber || invoiceId)}`,
    sourceFinancialDocumentId: invoiceId,
    relatedFinancialDocumentIds: invoiceId ? [invoiceId] : [],
    relationships: [relationship(invoiceId, "collects")].filter(Boolean),
    references: documentReferences,
    lines: [],
    totals: { subtotal: 0, tax: 0, total: 0 },
    collectionCase: canonical,
    accountingTreatment: {
      classification: "accounts-receivable-operational-control",
      economicEvent: false,
      createsRevenue: false,
      createsReceivable: false,
      createsCashEvent: false,
      paymentOrCreditSettlesReceivable: true
    },
    metadata: { ...object(metadata), transactModule: "collections" }
  };
}

function createSettlementDocument({
  financialDocumentId = "",
  documentNumber = "",
  currency: currencyCode = "USD",
  occurredAt = "",
  description = "",
  references: suppliedReferences = [],
  sourceFinancialDocumentId = "",
  settlement = {},
  assetSettlement = {},
  entityPassportId = "",
  actorPassportId = "",
  metadata = {}
} = {}) {
  const timestamp = clean(occurredAt) || new Date().toISOString();
  const source = { ...object(settlement), ...object(assetSettlement) };
  const saleId = clean(sourceFinancialDocumentId || source?.references?.saleId);
  const acquisitionId = clean(source?.references?.acquisitionId);
  const entity = clean(entityPassportId || source?.context?.entityPassportId);
  const actor = clean(actorPassportId || source?.context?.actorPassportId);
  const documentId = clean(financialDocumentId) || deterministicId("settlement", entity, saleId);
  const number = clean(documentNumber || source?.identity?.number || `STL-${documentId.slice(-8).toUpperCase()}`);
  const submittedStatus = clean(source.status).toLowerCase();
  const status = submittedStatus === "draft" ? "ready" : (submittedStatus || "ready");
  const canonical = {
    ...source,
    schema: "ixi-asset-settlement-v1",
    identity: {
      ...object(source.identity),
      settlementId: documentId,
      financialDocumentId: documentId,
      number
    },
    context: {
      ...object(source.context),
      entityPassportId: entity,
      actorPassportId: actor
    },
    status,
    paymentStatus: clean(source.paymentStatus || "unpaid").toLowerCase(),
    audit: {
      ...object(source.audit),
      createdAt: clean(source?.audit?.createdAt) || timestamp,
      createdBy: clean(source?.audit?.createdBy) || actor,
      updatedAt: timestamp,
      updatedBy: actor
    }
  };
  const related = [saleId, acquisitionId].filter(Boolean);
  const documentReferences = references([
    ...array(suppliedReferences),
    entity ? { passportId: entity, role: "entity" } : null,
    actor ? { passportId: actor, role: "prepared-by" } : null
  ]);

  return {
    financialDocumentId: documentId,
    documentType: "settlement",
    documentNumber: number,
    financialState: status === "settled" ? "paid" : "submitted",
    status,
    currency: currency(currencyCode),
    occurredAt: timestamp,
    description: clean(description) || `Asset Settlement · ${clean(canonical?.context?.assetLabel)} · ${clean(canonical?.references?.saleNumber || saleId)}`,
    sourceFinancialDocumentId: saleId,
    relatedFinancialDocumentIds: related,
    relationships: [relationship(saleId, "settles-sale"), relationship(acquisitionId, "reconciles-acquisition")].filter(Boolean),
    references: documentReferences,
    lines: [],
    totals: { subtotal: 0, tax: 0, total: 0 },
    assetSettlement: canonical,
    accountingTreatment: {
      classification: "owner-settlement-control",
      economicEvent: false,
      createsRevenue: false,
      createsExpense: false,
      createsPayable: false,
      createsCashEvent: false,
      ownerPaymentsAreSeparateEvents: true
    },
    metadata: { ...object(metadata), transactModule: "settlement" }
  };
}

module.exports = { createCollectionDocument, createSettlementDocument };
