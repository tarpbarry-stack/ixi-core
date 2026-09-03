"use strict";

/*
 * Canonical server factory for an asset's opening acquisition basis.
 *
 * The acquisition is the authoritative value/basis event for the AOS asset.
 * It is deliberately not a bill, expense, payable, or cash payment. Those
 * documents may be related later without entering the obligation twice.
 */

const crypto = require("crypto");

const clean = value => String(value ?? "").trim();
const safeArray = value => Array.isArray(value) ? value : [];
const safeObject = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const safeNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const roundMoney = value => Math.round((safeNumber(value) + Number.EPSILON) * 100) / 100;
const randomId = prefix => `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
const normalizeCurrency = value => /^[A-Z]{3}$/.test(clean(value || "USD").toUpperCase())
  ? clean(value || "USD").toUpperCase()
  : "USD";

function normalizeReferences(references = []) {
  const found = new Map();
  safeArray(references).forEach(item => {
    const source = safeObject(item);
    const passportId = clean(source.passportId);
    const role = clean(source.role).toLowerCase();
    if (!passportId || !role) return;
    const key = `${passportId}|${role}`;
    if (!found.has(key)) found.set(key, {
      passportId,
      role,
      label: clean(source.label),
      objectType: clean(source.objectType),
      metadata: { ...safeObject(source.metadata) }
    });
  });
  return Array.from(found.values());
}

function createAssetAcquisitionLine({
  financialDocumentId = "",
  financialLineId = "",
  description = "",
  amount = 0,
  currency = "USD",
  occurredAt = "",
  references = [],
  metadata = {}
} = {}) {
  return {
    financialLineId: clean(financialLineId) || randomId("ifl"),
    financialDocumentId: clean(financialDocumentId),
    lineType: "asset-basis",
    description: clean(description),
    quantity: 1,
    unit: "ASSET",
    rate: roundMoney(amount),
    amount: roundMoney(amount),
    currency: normalizeCurrency(currency),
    direction: "neutral",
    occurredAt: clean(occurredAt),
    references: normalizeReferences(references),
    metadata: {
      ...safeObject(metadata),
      accountingClass: "asset-basis",
      capitalized: true,
      economicEvent: true,
      nonExpense: true,
      nonCash: true
    }
  };
}

function createAssetAcquisitionDocument({
  financialDocumentId = "",
  documentNumber = "",
  financialState = "incurred",
  currency = "USD",
  occurredAt = "",
  description = "",
  memo = "",
  references = [],
  sourceFinancialDocumentId = "",
  assetAcquisition = {},
  acquisition = {},
  funding = {},
  ownership = {},
  title = {},
  condition = {},
  logistics = {},
  makeReady = {},
  settlementTerms = {},
  attachments = [],
  metadata = {}
} = {}) {
  const documentId = clean(financialDocumentId) || randomId("ifd");
  const currencyCode = normalizeCurrency(currency);
  const supplied = safeObject(assetAcquisition);
  const acquisitionRecord = safeObject(Object.keys(safeObject(supplied.acquisition)).length
    ? supplied.acquisition
    : acquisition);
  const purchaseDate = clean(acquisitionRecord.purchaseDate);
  const eventDate = clean(occurredAt || purchaseDate) || new Date().toISOString();
  const number = clean(documentNumber || supplied?.identity?.number) ||
    `ACQ-${documentId.replace(/^ifd_/, "").slice(-6).toUpperCase()}`;
  const documentReferences = normalizeReferences(references);
  const purchasePrice = roundMoney(acquisitionRecord.purchasePrice);
  const buyerPremium = roundMoney(acquisitionRecord.buyerPremium);
  const tax = roundMoney(acquisitionRecord.tax);
  const titleFees = roundMoney(acquisitionRecord.titleFees);
  const brokerFees = roundMoney(acquisitionRecord.brokerFees);
  const otherAcquisitionFees = roundMoney(acquisitionRecord.otherAcquisitionFees);
  const directAcquisitionCost = roundMoney(
    purchasePrice + buyerPremium + tax + titleFees + brokerFees + otherAcquisitionFees
  );
  const normalizedAcquisition = {
    ...acquisitionRecord,
    purchasePrice,
    buyerPremium,
    tax,
    titleFees,
    brokerFees,
    otherAcquisitionFees,
    directAcquisitionCost
  };
  const fundingSource = safeObject(Object.keys(safeObject(supplied.funding)).length ? supplied.funding : funding);
  const payments = safeArray(fundingSource.payments).map(item => ({
    ...safeObject(item),
    amount: roundMoney(item?.amount)
  }));
  const amountPaid = roundMoney(payments.reduce((sum, item) => sum + safeNumber(item.amount), 0));
  const normalizedFunding = {
    ...fundingSource,
    payments,
    amountPaid,
    balanceDue: roundMoney(Math.max(0, directAcquisitionCost - amountPaid)),
    createsCashEvent: false,
    createsPayable: false,
    treatment: "deal-evidence-only"
  };
  const ownershipSource = safeObject(Object.keys(safeObject(supplied.ownership)).length ? supplied.ownership : ownership);
  const owners = safeArray(ownershipSource.owners).map(item => ({
    ...safeObject(item),
    legalOwnershipPercent: safeNumber(item?.legalOwnershipPercent),
    settlementSharePercent: safeNumber(item?.settlementSharePercent),
    initialContribution: roundMoney(item?.initialContribution)
  }));
  const normalizedOwnership = {
    ...ownershipSource,
    owners,
    legalOwnershipTotal: roundMoney(owners.reduce((sum, item) => sum + safeNumber(item.legalOwnershipPercent), 0)),
    settlementShareTotal: roundMoney(owners.reduce((sum, item) => sum + safeNumber(item.settlementSharePercent), 0)),
    initialCapitalTotal: roundMoney(owners.reduce((sum, item) => sum + safeNumber(item.initialContribution), 0))
  };
  const canonical = {
    ...supplied,
    schema: "ixi-asset-acquisition-v2",
    identity: {
      ...safeObject(supplied.identity),
      acquisitionId: documentId,
      financialDocumentId: documentId,
      number
    },
    acquisition: normalizedAcquisition,
    funding: normalizedFunding,
    ownership: normalizedOwnership,
    title: { ...safeObject(Object.keys(safeObject(supplied.title)).length ? supplied.title : title) },
    condition: { ...safeObject(Object.keys(safeObject(supplied.condition)).length ? supplied.condition : condition) },
    logistics: { ...safeObject(Object.keys(safeObject(supplied.logistics)).length ? supplied.logistics : logistics) },
    makeReady: { ...safeObject(Object.keys(safeObject(supplied.makeReady)).length ? supplied.makeReady : makeReady) },
    settlementTerms: { ...safeObject(Object.keys(safeObject(supplied.settlementTerms)).length ? supplied.settlementTerms : settlementTerms) },
    documents: safeArray(supplied.documents || attachments).map(item => ({ ...safeObject(item) })),
    status: "recorded"
  };
  const line = createAssetAcquisitionLine({
    financialDocumentId: documentId,
    description: description || `Asset Acquisition · ${clean(canonical?.context?.primaryLabel)}`,
    amount: directAcquisitionCost,
    currency: currencyCode,
    occurredAt: eventDate,
    references: documentReferences
  });
  const sourceId = clean(sourceFinancialDocumentId || canonical?.acquisition?.sourceFinancialDocumentId);

  return {
    financialDocumentId: documentId,
    documentType: "asset-acquisition",
    documentNumber: number,
    financialState: clean(financialState || "incurred").toLowerCase(),
    currency: currencyCode,
    occurredAt: eventDate,
    description: clean(description || line.description),
    memo: clean(memo),
    assetAcquisition: canonical,
    acquisition: normalizedAcquisition,
    funding: normalizedFunding,
    ownership: canonical.ownership,
    title: canonical.title,
    condition: canonical.condition,
    logistics: canonical.logistics,
    makeReady: canonical.makeReady,
    settlementTerms: canonical.settlementTerms,
    attachments: canonical.documents,
    sourceFinancialDocumentId: sourceId,
    relationships: sourceId ? [{ financialDocumentId: sourceId, relationshipType: "supported-by" }] : [],
    references: documentReferences,
    lines: [line],
    totals: {
      purchasePrice,
      capitalizedAcquisitionCosts: roundMoney(directAcquisitionCost - purchasePrice),
      acquisitionBasis: directAcquisitionCost,
      subtotal: directAcquisitionCost,
      total: directAcquisitionCost
    },
    accountingTreatment: {
      classification: "asset-basis",
      capitalized: true,
      economicEvent: true,
      nonExpense: true,
      nonCash: true,
      createsObligation: false
    },
    metadata: {
      ...safeObject(metadata),
      accountingClass: "asset-basis",
      economicEvent: true,
      capitalized: true,
      nonExpense: true,
      nonCash: true,
      createsObligation: false
    }
  };
}

module.exports = {
  normalizeReferences,
  createAssetAcquisitionLine,
  createAssetAcquisitionDocument
};
