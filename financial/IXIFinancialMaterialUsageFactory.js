"use strict";

/*
 * Canonical server factory for physical material consumption.
 *
 * A Material Usage attributes physical cost to an AOS context. It is not a
 * purchase, bill, payment, or second cash-spend event. The immutable usage
 * event is also the authoritative decrement/consumption instruction for its
 * referenced inventory or receiving record.
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
  const map = new Map();
  safeArray(references).forEach(item => {
    const source = safeObject(item);
    const passportId = clean(source.passportId);
    const role = clean(source.role);
    if (!passportId || !role) return;
    const normalized = {
      passportId,
      role,
      label: clean(source.label),
      objectType: clean(source.objectType),
      metadata: { ...safeObject(source.metadata) }
    };
    const key = `${passportId}|${role}`;
    if (!map.has(key)) map.set(key, normalized);
  });
  return Array.from(map.values());
}

function createMaterialUsageLine({
  financialDocumentId = "",
  financialLineId = "",
  description = "",
  quantity = 0,
  unit = "EA",
  unitCost = 0,
  amount = null,
  currency = "USD",
  occurredAt = "",
  references = [],
  sku = "",
  metadata = {}
} = {}) {
  const resolvedQuantity = safeNumber(quantity);
  const resolvedUnitCost = roundMoney(unitCost);
  const resolvedAmount = amount === null
    ? roundMoney(resolvedQuantity * resolvedUnitCost)
    : roundMoney(amount);
  return {
    financialLineId: clean(financialLineId) || randomId("ifl"),
    financialDocumentId: clean(financialDocumentId),
    lineType: "material",
    description: clean(description),
    sku: clean(sku),
    quantity: resolvedQuantity,
    unit: clean(unit || "EA").toUpperCase(),
    rate: resolvedUnitCost,
    unitCost: resolvedUnitCost,
    amount: resolvedAmount,
    currency: normalizeCurrency(currency),
    direction: "neutral",
    occurredAt: clean(occurredAt),
    references: normalizeReferences(references),
    metadata: { ...safeObject(metadata), economicEvent: false }
  };
}

function createMaterialUsageDocument({
  financialDocumentId = "",
  documentNumber = "",
  financialState = "incurred",
  currency = "USD",
  occurredAt = "",
  description = "",
  memo = "",
  references = [],
  lines = [],
  amount = null,
  sourceFinancialDocumentId = "",
  materialUsage = {},
  material = {},
  costAttribution = {},
  inventoryAdjustment = {},
  receivingConsumption = {},
  attachments = [],
  metadata = {}
} = {}) {
  const resolvedDocumentId = clean(financialDocumentId) || randomId("ifd");
  const resolvedCurrency = normalizeCurrency(currency);
  const usage = safeObject(Object.keys(safeObject(materialUsage)).length ? materialUsage : {
    schema: "ixi-material-usage-v2",
    material: safeObject(material),
    costAttribution: safeObject(costAttribution),
    inventoryAdjustment: safeObject(inventoryAdjustment),
    receivingConsumption: safeObject(receivingConsumption)
  });
  const materialRecord = safeObject(usage.material);
  const resolvedOccurredAt = clean(occurredAt || materialRecord.dateUsed) || new Date().toISOString();
  const resolvedDocumentNumber = clean(documentNumber || usage?.identity?.number) ||
    `MAT-${resolvedDocumentId.replace(/^ifd_/, "").slice(-6).toUpperCase()}`;
  const documentReferences = normalizeReferences(references);

  let resolvedLines = safeArray(lines).map(line => createMaterialUsageLine({
    ...safeObject(line),
    financialDocumentId: resolvedDocumentId,
    currency: line?.currency || resolvedCurrency,
    occurredAt: line?.occurredAt || resolvedOccurredAt,
    references: line?.references || documentReferences
  }));
  if (!resolvedLines.length) {
    resolvedLines = [createMaterialUsageLine({
      financialDocumentId: resolvedDocumentId,
      description: description || materialRecord.description,
      quantity: materialRecord.quantity,
      unit: materialRecord.unit,
      unitCost: materialRecord.unitCost,
      amount: amount === null ? materialRecord.extendedCost : amount,
      currency: resolvedCurrency,
      occurredAt: resolvedOccurredAt,
      references: documentReferences,
      sku: materialRecord.sku
    })];
  }
  const total = roundMoney(resolvedLines.reduce((sum, line) => sum + safeNumber(line.amount), 0));
  const sourceId = clean(sourceFinancialDocumentId);
  const normalizedUsage = {
    ...usage,
    schema: clean(usage.schema || "ixi-material-usage-v2"),
    identity: {
      ...safeObject(usage.identity),
      materialUsageId: resolvedDocumentId,
      number: resolvedDocumentNumber
    },
    costAttribution: {
      ...safeObject(usage.costAttribution),
      amount: total,
      currency: resolvedCurrency,
      economicEvent: false
    },
    inventoryAdjustment: {
      ...safeObject(usage.inventoryAdjustment),
      status: safeObject(usage.inventoryAdjustment).required === true ? "recorded" : "not-required"
    },
    receivingConsumption: {
      ...safeObject(usage.receivingConsumption),
      status: safeObject(usage.receivingConsumption).required === true ? "recorded" : "not-required"
    },
    status: "recorded"
  };

  return {
    financialDocumentId: resolvedDocumentId,
    documentType: "material-usage",
    documentNumber: resolvedDocumentNumber,
    financialState: clean(financialState || "incurred").toLowerCase(),
    currency: resolvedCurrency,
    occurredAt: resolvedOccurredAt,
    description: clean(description || materialRecord.description),
    memo: clean(memo),
    materialUsage: normalizedUsage,
    material: { ...safeObject(normalizedUsage.material) },
    costAttribution: { ...safeObject(normalizedUsage.costAttribution) },
    inventoryAdjustment: { ...safeObject(normalizedUsage.inventoryAdjustment) },
    receivingConsumption: { ...safeObject(normalizedUsage.receivingConsumption) },
    attachments: safeArray(attachments).map(item => ({ ...safeObject(item) })),
    sourceFinancialDocumentId: sourceId,
    relationships: sourceId ? [{ financialDocumentId: sourceId, relationshipType: "derived-from" }] : [],
    references: documentReferences,
    lines: resolvedLines,
    totals: { materialCost: total, subtotal: total, total },
    metadata: { ...safeObject(metadata), economicEvent: false }
  };
}

module.exports = {
  normalizeReferences,
  createMaterialUsageLine,
  createMaterialUsageDocument
};
