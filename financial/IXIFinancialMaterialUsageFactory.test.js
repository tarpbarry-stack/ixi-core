"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createMaterialUsageDocument } = require("./IXIFinancialMaterialUsageFactory");
const { createFinancialDocumentByType } = require("./IXIFinancialDocumentFactoryRegistry");
const { validateFinancialDocument } = require("./IXIFinancialValidationBridge");
const { isNonEconomicOperationalCapture } = require("./IXIFinancialCommandEngine");

function createUsage(overrides = {}) {
  const materialUsage = {
    schema: "ixi-material-usage-v2",
    identity: { clientRequestId: "material-request-1" },
    context: {
      primaryPassportId: "passport:machine:1",
      employeePassportId: "passport:employee:1",
      workOrderId: "ifd_workorder001",
      workOrderNumber: "WO-1001"
    },
    material: {
      source: "manual",
      description: "Hydraulic hose",
      sku: "HOS-1IN",
      quantity: 12,
      unit: "FT",
      unitCost: 8.25,
      extendedCost: 99,
      availableQuantity: 0,
      dateUsed: "2026-09-03",
      condition: "good"
    },
    costAttribution: { amount: 99, currency: "USD", economicEvent: false },
    inventoryAdjustment: { required: false, status: "not-required" },
    receivingConsumption: { required: false, status: "not-required" },
    status: "draft"
  };
  return createMaterialUsageDocument({
    financialDocumentId: "ifd_materialcommercialabcdef",
    references: [
      { passportId: "passport:machine:1", role: "origin", label: "CAT 336" },
      { passportId: "passport:employee:1", role: "employee", label: "John Carter" },
      { passportId: "passport:entity:1", role: "entity", label: "Machine King" }
    ],
    sourceFinancialDocumentId: "ifd_workorder001",
    materialUsage,
    ...overrides
  });
}

test("Material Usage preserves canonical identity, Work Order lineage, and one non-cash cost fact", () => {
  const document = createUsage();
  assert.equal(document.documentNumber, "MAT-ABCDEF");
  assert.equal(document.materialUsage.identity.materialUsageId, document.financialDocumentId);
  assert.equal(document.materialUsage.identity.number, document.documentNumber);
  assert.equal(document.sourceFinancialDocumentId, "ifd_workorder001");
  assert.equal(document.relationships[0].relationshipType, "derived-from");
  assert.equal(document.lines.length, 1);
  assert.equal(document.lines[0].direction, "neutral");
  assert.equal(document.totals.materialCost, 99);
  assert.equal(document.costAttribution.economicEvent, false);
  assert.equal(validateFinancialDocument(document).ok, true);
  assert.equal(isNonEconomicOperationalCapture(document), true);
});

test("inventory source creates one recorded decrement and rejects oversubscription", () => {
  const base = createUsage();
  const usage = {
    ...base.materialUsage,
    material: {
      ...base.materialUsage.material,
      source: "inventory",
      inventoryItemId: "INV-44",
      sourceLocationLabel: "Shop A",
      availableQuantity: 20
    },
    inventoryAdjustment: {
      required: true,
      direction: "decrement",
      inventoryItemId: "INV-44",
      quantity: 12,
      unit: "FT",
      status: "pending"
    }
  };
  const document = createUsage({ materialUsage: usage });
  assert.equal(document.inventoryAdjustment.status, "recorded");
  assert.equal(validateFinancialDocument(document).ok, true);

  const overdrawn = createUsage({ materialUsage: { ...usage, material: { ...usage.material, availableQuantity: 2 } } });
  assert.equal(validateFinancialDocument(overdrawn).ok, false);
  assert.match(validateFinancialDocument(overdrawn).errors.join(" "), /exceeds available quantity/u);
});

test("registry supports material-usage and the server rejects malformed math", () => {
  const document = createFinancialDocumentByType({
    documentType: "material-usage",
    input: { ...createUsage(), financialDocumentId: "ifd_materialregistryabcdef" }
  });
  assert.equal(document.documentType, "material-usage");

  const invalid = createUsage();
  invalid.materialUsage.material.extendedCost = 1;
  assert.equal(validateFinancialDocument(invalid).ok, false);
  assert.match(validateFinancialDocument(invalid).errors.join(" "), /quantity times unit cost/u);
});
