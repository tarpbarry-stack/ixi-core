"use strict";

const crypto = require("crypto");

const clean = value => String(value ?? "").trim();
const array = value => Array.isArray(value) ? value : [];
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = value => Math.round((number(value) + Number.EPSILON) * 100) / 100;
const randomId = prefix => `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
const currencyOf = value => /^[A-Z]{3}$/.test(clean(value).toUpperCase()) ? clean(value).toUpperCase() : "USD";

function referencesOf(values = []) {
  const seen = new Set();
  return array(values).map(item => {
    const source = object(item);
    const passportId = clean(source.passportId);
    const role = clean(source.role);
    if (!passportId || !role) return null;
    const key = `${passportId}|${role}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return { ...source, passportId, role, label: clean(source.label), objectType: clean(source.objectType), metadata: object(source.metadata) };
  }).filter(Boolean);
}

function directionOf(value) {
  const direction = clean(value).toLowerCase();
  if (["in", "credit"].includes(direction)) return "inflow";
  if (["out", "debit"].includes(direction)) return "outflow";
  return ["inflow", "outflow", "neutral"].includes(direction) ? direction : "neutral";
}

function createOperationalDocument(input = {}, documentType = "") {
  const source = object(input);
  const financialDocumentId = clean(source.financialDocumentId) || randomId("ifd");
  const currency = currencyOf(source.currency);
  const references = referencesOf(source.references);
  const occurredAt = clean(source.occurredAt || source.documentDate || source.effectiveDate) || new Date().toISOString();
  const defaultAmount = money(source.amount ?? source.total ?? source.subtotal);
  const sourceLines = array(source.lines);
  const lines = (sourceLines.length ? sourceLines : [{
    description: clean(source.description) || documentType,
    amount: defaultAmount,
    quantity: 1,
    rate: defaultAmount,
    direction: source.direction,
    references
  }]).map(line => {
    const value = object(line);
    const amount = money(value.amount ?? number(value.quantity || 1) * number(value.rate));
    return {
      ...value,
      financialLineId: clean(value.financialLineId) || randomId("ifl"),
      financialDocumentId,
      lineType: clean(value.lineType) || documentType,
      description: clean(value.description || source.description),
      quantity: number(value.quantity ?? 1),
      rate: money(value.rate ?? amount),
      amount,
      currency,
      direction: directionOf(value.direction || source.direction),
      occurredAt: clean(value.occurredAt) || occurredAt,
      references: referencesOf(value.references?.length ? value.references : references),
      metadata: object(value.metadata)
    };
  });
  const total = money(lines.reduce((sum, line) => sum + number(line.amount), 0));

  return {
    ...source,
    financialDocumentId,
    documentType: clean(documentType).toLowerCase(),
    documentNumber: clean(source.documentNumber || source.number || source.reference),
    financialState: clean(source.financialState || source.status || "draft").toLowerCase(),
    currency,
    occurredAt,
    description: clean(source.description),
    memo: clean(source.memo),
    references,
    lines,
    totals: { ...object(source.totals), subtotal: total, total },
    metadata: object(source.metadata)
  };
}

function operationalFactory(documentType) {
  return input => createOperationalDocument(input, documentType);
}

module.exports = { createOperationalDocument, operationalFactory };
