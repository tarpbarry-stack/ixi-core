"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createTimeEntryDocument } = require("./IXIFinancialTimeEntryFactory");
const { validateFinancialDocument } = require("./IXIFinancialValidationBridge");
const { isNonEconomicOperationalCapture } = require("./IXIFinancialCommandEngine");

function createCommercialTimeEntry(overrides = {}) {
  return createTimeEntryDocument({
    financialDocumentId: "ifd_timecommercialabcdef",
    description: "Completed hydraulic diagnostics",
    hours: 2.25,
    hourlyRate: 0,
    employeePassportId: "passport:employee:1",
    references: [
      { passportId: "passport:machine:1", role: "origin", label: "CAT 336" },
      { passportId: "passport:employee:1", role: "employee", label: "John Carter" },
      { passportId: "passport:entity:1", role: "entity", label: "Machine King" }
    ],
    sourceFinancialDocumentId: "ifd_workorder001",
    attachments: [{ fileName: "repair.jpg", status: "pending-upload" }],
    timeEntry: {
      schema: "ixi-time-entry-v2",
      identity: { clientRequestId: "time-request-1" },
      context: {
        primaryPassportId: "passport:machine:1",
        employeePassportId: "passport:employee:1",
        workOrderId: "ifd_workorder001",
        workOrderNumber: "WO-1001"
      },
      time: {
        mode: "manual",
        workType: "diagnostics",
        date: "2026-09-03",
        startTime: "08:00",
        endTime: "10:15",
        hours: 2.25,
        description: "Completed hydraulic diagnostics"
      },
      status: "recorded"
    },
    ...overrides
  });
}

test("Time factory preserves one canonical operational record and Work Order lineage", () => {
  const document = createCommercialTimeEntry();

  assert.equal(document.documentType, "time-entry");
  assert.equal(document.documentNumber, "TIME-ABCDEF");
  assert.equal(document.timeEntry.identity.timeEntryId, document.financialDocumentId);
  assert.equal(document.timeEntry.identity.number, document.documentNumber);
  assert.equal(document.totals.laborHours, 2.25);
  assert.equal(document.totals.total, 0);
  assert.equal(document.sourceFinancialDocumentId, "ifd_workorder001");
  assert.equal(document.relationships[0].relationshipType, "derived-from");
  assert.equal(document.attachments[0].fileName, "repair.jpg");
  assert.equal(validateFinancialDocument(document).ok, true);
});

test("running zero-hour Time session remains operational during accounting close", () => {
  const document = createCommercialTimeEntry({
    hours: 0,
    timeEntry: {
      ...createCommercialTimeEntry().timeEntry,
      time: { ...createCommercialTimeEntry().timeEntry.time, mode: "live", hours: 0 },
      status: "running",
      session: { sessionId: "TS-1", status: "running" }
    }
  });

  assert.equal(validateFinancialDocument(document).ok, true);
  assert.equal(isNonEconomicOperationalCapture(document), true);
});

test("server rejects incomplete final Time entries", () => {
  const document = createCommercialTimeEntry({
    hours: 0,
    timeEntry: {
      schema: "wrong",
      context: { primaryPassportId: "passport:other" },
      time: { mode: "guess", workType: "", date: "", hours: 0, description: "" },
      status: "recorded"
    }
  });
  const validation = validateFinancialDocument(document);

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(" "), /schema is invalid/u);
  assert.match(validation.errors.join(" "), /primary Passport must be referenced/u);
  assert.match(validation.errors.join(" "), /employee identity is required/u);
  assert.match(validation.errors.join(" "), /mode is invalid/u);
  assert.match(validation.errors.join(" "), /completed time entry hours must be greater than zero/u);
});
