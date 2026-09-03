"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createWorkOrderDocument } = require("./IXIFinancialWorkOrderFactory");
const { validateFinancialDocument } = require("./IXIFinancialValidationBridge");

test("Work Order factory preserves the operational record under canonical identity", () => {
  const document = createWorkOrderDocument({
    financialDocumentId: "ifd_1234567890abcdef",
    machinePassportId: "passport:machine:1",
    description: "Repair hydraulic leak",
    workOrder: {
      schema: "ixi-work-order-v1",
      identity: { clientRequestId: "request-1" },
      work: { status: "in-progress", priority: "critical", description: "Repair hydraulic leak" }
    }
  });

  assert.equal(document.documentType, "work-order");
  assert.equal(document.documentNumber, "WO-90ABCDEF");
  assert.equal(document.priority, "critical");
  assert.equal(document.workOrder.identity.workOrderId, document.financialDocumentId);
  assert.equal(document.workOrder.identity.number, document.documentNumber);
  assert.equal(document.workOrder.work.status, "in-progress");
  assert.equal(document.references[0].passportId, "passport:machine:1");
});

test("caller-supplied Work Order number remains canonical when present", () => {
  const document = createWorkOrderDocument({
    financialDocumentId: "ifd_fixed",
    documentNumber: "WO-4401",
    workOrder: { identity: {}, work: { status: "paused" } }
  });

  assert.equal(document.documentNumber, "WO-4401");
  assert.equal(document.workOrder.identity.number, "WO-4401");
});

test("technology Work Order receives canonical TECHWO identity without duplicating an ordinary Work Order", () => {
  const document = createWorkOrderDocument({
    financialDocumentId: "ifd_1234567890abcdef",
    workOrderType: "technology",
    description: "Restore telematics connectivity",
    references: [{ passportId: "passport:machine:1", role: "asset" }],
    techWorkOrder: {
      schema: "ixi-tech-work-order-v1",
      identity: { clientRequestId: "tech-request-1" },
      context: { primaryPassportId: "passport:machine:1" },
      work: { type: "incident", status: "in-progress", priority: "critical", impact: "critical", description: "Restore telematics connectivity" },
      technology: { environment: "field", systemName: "Telematics" }
    }
  });

  assert.equal(document.documentType, "work-order");
  assert.equal(document.workOrderType, "technology");
  assert.equal(document.documentNumber, "TECHWO-ABCDEF");
  assert.equal(document.workOrder, undefined);
  assert.equal(document.techWorkOrder.identity.techWorkOrderId, document.financialDocumentId);
  assert.equal(document.techWorkOrder.identity.workOrderId, document.financialDocumentId);
  assert.equal(document.techWorkOrder.identity.number, document.documentNumber);
  assert.equal(validateFinancialDocument(document).ok, true);
});

test("server validation rejects malformed technology Work Orders", () => {
  const document = createWorkOrderDocument({
    financialDocumentId: "ifd_1234567890abcdef",
    workOrderType: "technology",
    references: [{ passportId: "passport:machine:1", role: "asset" }],
    techWorkOrder: {
      schema: "wrong-schema",
      context: { primaryPassportId: "passport:other" },
      work: { type: "mystery", status: "lost", impact: "catastrophic", description: "" },
      technology: { environment: "mars" }
    }
  });
  const validation = validateFinancialDocument(document);

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(" "), /schema is invalid/u);
  assert.match(validation.errors.join(" "), /primary Passport must be referenced/u);
  assert.match(validation.errors.join(" "), /description is required/u);
  assert.match(validation.errors.join(" "), /type is invalid/u);
  assert.match(validation.errors.join(" "), /status is invalid/u);
  assert.match(validation.errors.join(" "), /impact is invalid/u);
  assert.match(validation.errors.join(" "), /environment is invalid/u);
});

test("server requires completion evidence for technology Work Orders", () => {
  const document = createWorkOrderDocument({
    financialDocumentId: "ifd_1234567890abcdef",
    workOrderType: "technology",
    references: [{ passportId: "passport:machine:1", role: "asset" }],
    techWorkOrder: {
      schema: "ixi-tech-work-order-v1",
      context: { primaryPassportId: "passport:machine:1" },
      work: { type: "incident", status: "complete", impact: "normal", description: "Restore connectivity" },
      technology: { environment: "field", validation: "" },
      result: { workPerformed: "" }
    }
  });
  const validation = validateFinancialDocument(document);

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(" "), /work performed evidence/u);
  assert.match(validation.errors.join(" "), /validation evidence/u);
});
