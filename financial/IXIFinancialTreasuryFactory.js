"use strict";

const crypto = require("crypto");
const clean = value => String(value ?? "").trim();
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = value => Array.isArray(value) ? value : [];
const money = value => Math.round((Number(value) || 0) * 100) / 100;
const id = prefix => `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
const currency = value => /^[A-Z]{3}$/.test(clean(value).toUpperCase()) ? clean(value).toUpperCase() : "USD";

function references(values = [], entityPassportId = "") {
  const map = new Map();
  [...array(values), entityPassportId ? { passportId: entityPassportId, role: "entity" } : null]
    .filter(Boolean)
    .forEach(value => {
      const source = object(value), passportId = clean(source.passportId), role = clean(source.role);
      if (passportId && role) map.set(`${passportId}|${role}`, { passportId, role, label: clean(source.label), objectType: clean(source.objectType), metadata: { ...object(source.metadata) } });
    });
  return [...map.values()];
}

function createTreasuryAccountDocument({ financialDocumentId = "", documentNumber = "", currency: currencyCode = "USD", occurredAt = "", references: refs = [], treasuryAccount = {}, entityPassportId = "", actorPassportId = "", metadata = {} } = {}) {
  const source = object(treasuryAccount), timestamp = clean(occurredAt) || new Date().toISOString(), documentId = clean(financialDocumentId) || id("ifd");
  const account = {
    ...source,
    schema: "ixi-treasury-account-v2",
    identity: { ...object(source.identity), accountId: documentId, number: clean(source?.identity?.number || documentNumber || `CASH-${documentId.slice(-6).toUpperCase()}`) },
    account: { ...object(source.account), name: clean(source?.account?.name), accountType: clean(source?.account?.accountType || "checking").toLowerCase(), institution: clean(source?.account?.institution), last4: clean(source?.account?.last4).slice(-4), currency: currency(source?.account?.currency || currencyCode), active: source?.account?.active !== false },
    context: { ...object(source.context), entityPassportId: clean(entityPassportId), locationPassportId: clean(source?.context?.locationPassportId), primaryPassportId: clean(source?.context?.primaryPassportId), updatedByPassportId: clean(actorPassportId) },
    opening: { ...object(source.opening), amount: money(source?.opening?.amount), effectiveDate: clean(source?.opening?.effectiveDate), source: clean(source?.opening?.source), reference: clean(source?.opening?.reference), posted: false, financialDocumentId: "" },
    control: { ...object(source.control), allowNegative: Boolean(source?.control?.allowNegative), minimumCash: Math.max(0, money(source?.control?.minimumCash)) },
    audit: { ...object(source.audit), createdAt: clean(source?.audit?.createdAt) || timestamp, createdByPassportId: clean(actorPassportId), updatedAt: timestamp, updatedByPassportId: clean(actorPassportId) }
  };
  return { financialDocumentId: documentId, documentType: "treasury-account", documentNumber: account.identity.number, financialState: "submitted", currency: account.account.currency, occurredAt: timestamp, description: `Treasury account · ${account.account.name}`, references: references(refs, entityPassportId), lines: [], totals: { subtotal: 0, tax: 0, total: 0 }, treasuryAccount: account, accountingTreatment: { classification: "treasury-account-control", economicEvent: false, createsRevenue: false, createsExpense: false, createsCashEvent: false }, metadata: { ...object(metadata), transactModule: "treasury" } };
}

function createTreasuryReconciliationDocument({ financialDocumentId = "", documentNumber = "", currency: currencyCode = "USD", occurredAt = "", references: refs = [], treasuryReconciliation = {}, entityPassportId = "", actorPassportId = "", metadata = {} } = {}) {
  const source = object(treasuryReconciliation), timestamp = clean(occurredAt) || new Date().toISOString(), documentId = clean(financialDocumentId) || id("ifd"), accountId = clean(source.accountId);
  const statementBalance = money(source?.statement?.balance), deposits = money(source?.reconciling?.depositsInTransit), outstanding = money(source?.reconciling?.outstandingPayments), other = money(source?.reconciling?.otherReconcilingItems), bookBalance = money(source?.book?.balance), adjustedBankBalance = money(statementBalance + deposits - outstanding + other), difference = money(bookBalance - adjustedBankBalance);
  const reconciliation = {
    ...source,
    schema: "ixi-treasury-reconciliation-v2",
    identity: { ...object(source.identity), reconciliationId: documentId, number: clean(source?.identity?.number || documentNumber || `REC-${documentId.slice(-6).toUpperCase()}`) },
    accountId,
    context: { ...object(source.context), entityPassportId: clean(entityPassportId), updatedByPassportId: clean(actorPassportId) },
    statement: { ...object(source.statement), date: clean(source?.statement?.date), balance: statementBalance, reference: clean(source?.statement?.reference) },
    book: { ...object(source.book), balance: bookBalance },
    reconciling: { ...object(source.reconciling), depositsInTransit: deposits, outstandingPayments: outstanding, otherReconcilingItems: other, adjustedBankBalance, difference },
    status: Math.abs(difference) < 0.005 ? "reconciled" : "out-of-balance",
    notes: clean(source.notes),
    audit: { ...object(source.audit), createdAt: clean(source?.audit?.createdAt) || timestamp, createdByPassportId: clean(actorPassportId), updatedAt: timestamp, updatedByPassportId: clean(actorPassportId) }
  };
  return { financialDocumentId: documentId, documentType: "treasury-reconciliation", documentNumber: reconciliation.identity.number, financialState: "submitted", currency: currency(currencyCode), occurredAt: timestamp, description: `Treasury reconciliation · ${accountId}`, relatedFinancialDocumentIds: accountId ? [accountId] : [], relationships: accountId ? [{ financialDocumentId: accountId, relationshipType: "reconciles" }] : [], references: references(refs, entityPassportId), lines: [], totals: { subtotal: 0, tax: 0, total: 0 }, treasuryReconciliation: reconciliation, accountingTreatment: { classification: "treasury-reconciliation-control", economicEvent: false, createsRevenue: false, createsExpense: false, createsCashEvent: false }, metadata: { ...object(metadata), transactModule: "treasury" } };
}

module.exports = { createTreasuryAccountDocument, createTreasuryReconciliationDocument };
