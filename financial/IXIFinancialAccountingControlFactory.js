"use strict";

const crypto = require("crypto");
const clean = value => String(value ?? "").trim();
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = value => Array.isArray(value) ? value : [];
const id = prefix => `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
const currency = value => /^[A-Z]{3}$/.test(clean(value).toUpperCase()) ? clean(value).toUpperCase() : "USD";
const references = values => array(values).filter(value => clean(value?.passportId) && clean(value?.role)).map(value => ({ ...object(value), passportId: clean(value.passportId), role: clean(value.role) }));

function createPeriodReopenDocument({ financialDocumentId = "", documentNumber = "", period = "", currency: currencyCode = "USD", occurredAt = "", reopenedAt = "", reopenedBy = "", reopenReason = "", priorCloseDocumentId = "", permissionEvidence = {}, references: refs = [], metadata = {} } = {}) {
  const resolvedPeriod = clean(period), reason = clean(reopenReason), actor = clean(reopenedBy), priorClose = clean(priorCloseDocumentId), timestamp = clean(reopenedAt || occurredAt) || new Date().toISOString();
  if (!/^\d{4}-\d{2}$/.test(resolvedPeriod)) throw Object.assign(new Error("Period Reopen requires period in YYYY-MM format."), { name: "IXIFinancialPeriodReopenError" });
  if (reason.length < 10) throw Object.assign(new Error("Period Reopen requires a specific reason of at least 10 characters."), { name: "IXIFinancialPeriodReopenReasonError" });
  if (!actor || !priorClose) throw Object.assign(new Error("Period Reopen requires trusted actor and prior close lineage."), { name: "IXIFinancialPeriodReopenEvidenceError" });
  return {
    financialDocumentId: clean(financialDocumentId) || id("ifd"), documentType: "period-reopen", documentNumber: clean(documentNumber || `REOPEN-${resolvedPeriod}`), financialState: "submitted", status: "reopened", currency: currency(currencyCode), occurredAt: timestamp, documentDate: timestamp.slice(0, 10), period: resolvedPeriod,
    description: `ACCOUNTING PERIOD REOPEN ${resolvedPeriod}`, lines: [], totals: { subtotal: 0, total: 0 }, reopenedAt: timestamp, reopenedBy: actor, reopenReason: reason, priorCloseDocumentId: priorClose,
    relationships: [{ financialDocumentId: priorClose, relationshipType: "reopens" }], relatedFinancialDocumentIds: [priorClose], references: references(refs), permissionEvidence: { ...object(permissionEvidence), action: "financial.gl.period.reopen", actorPassportId: actor, allowed: true },
    accountingTreatment: { classification: "period-reopen-control", economicEvent: false, createsRevenue: false, createsExpense: false, createsCashEvent: false },
    metadata: { ...object(metadata), transactModule: "general-ledger", accountingControlDocument: true, browserCalculated: false }
  };
}

function createPostingRuleDocument({ financialDocumentId = "", documentNumber = "", currency: currencyCode = "USD", occurredAt = "", postingRule = {}, actorPassportId = "", entityPassportId = "", references: refs = [], metadata = {} } = {}) {
  const source = object(postingRule), match = object(source.match), posting = object(source.posting), timestamp = clean(occurredAt) || new Date().toISOString(), actor = clean(actorPassportId), entity = clean(entityPassportId), ruleId = clean(source?.identity?.ruleId || source.ruleId) || id("glrule"), version = Number(source?.identity?.version || source.version);
  if (!actor || !entity) throw Object.assign(new Error("Posting Rule requires trusted Entity and actor lineage."), { name: "IXIFinancialPostingRuleEvidenceError" });
  if (!clean(match.documentType)) throw Object.assign(new Error("Posting Rule requires a source document type."), { name: "IXIFinancialPostingRuleMatchError" });
  if (!clean(posting.debitAccountCode) || !clean(posting.creditAccountCode) || clean(posting.debitAccountCode) === clean(posting.creditAccountCode)) throw Object.assign(new Error("Posting Rule requires two different debit and credit accounts."), { name: "IXIFinancialPostingRuleAccountError" });
  if (!Number.isInteger(version) || version < 1) throw Object.assign(new Error("Posting Rule version must be a positive integer."), { name: "IXIFinancialPostingRuleVersionError" });
  const documentId = clean(financialDocumentId) || id("ifd");
  return {
    financialDocumentId: documentId, documentType: "posting-rule", documentNumber: clean(documentNumber || `${ruleId}-V${version}`), financialState: "approved", status: source.active === false ? "inactive" : "active", currency: currency(currencyCode), occurredAt: timestamp, documentDate: timestamp.slice(0, 10), description: clean(source.description || `POSTING RULE ${ruleId} VERSION ${version}`), lines: [], totals: { subtotal: 0, total: 0 }, references: references(refs),
    postingRule: { ...source, schema: "ixi-financial-posting-rule-v1", identity: { ...object(source.identity), ruleId, version, postingRuleDocumentId: documentId }, match: { ...match, documentType: clean(match.documentType).toLowerCase(), categoryContains: clean(match.categoryContains).toLowerCase() }, posting: { ...posting, debitAccountCode: clean(posting.debitAccountCode), creditAccountCode: clean(posting.creditAccountCode) }, control: { active: source.active !== false, effectivePeriod: clean(source.effectivePeriod), changeReason: clean(source.changeReason), approvedByPassportId: actor, entityPassportId: entity }, audit: { ...object(source.audit), createdAt: timestamp, createdByPassportId: actor } },
    accountingTreatment: { classification: "posting-rule-control", economicEvent: false, createsRevenue: false, createsExpense: false, createsCashEvent: false },
    metadata: { ...object(metadata), transactModule: "general-ledger", accountingControlDocument: true, browserCalculated: false }
  };
}

module.exports = { createPeriodReopenDocument, createPostingRuleDocument };
