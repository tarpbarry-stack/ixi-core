"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createWorkOrderDocument } = require("./IXIFinancialWorkOrderFactory");

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
