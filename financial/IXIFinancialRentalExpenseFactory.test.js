"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createRentalExpenseDocument
} = require("./IXIFinancialRentalExpenseFactory");
const {
  createFinancialDocumentByType,
  listFinancialDocumentFactoryTypes
} = require("./IXIFinancialDocumentFactoryRegistry");
const {
  validateFinancialDocument
} = require("./IXIFinancialValidationBridge");
const {
  createFinancialLifecycleSnapshot
} = require("./IXIFinancialLifecycleEngine");
const {
  isNonEconomicOperationalCapture
} = require("./IXIFinancialCommandEngine");

function input(overrides = {}) {
  return {
    financialDocumentId: "ifd_rentalexpense001",
    documentNumber: "RNTEXP-00001",
    references: [
      { passportId: "pass_job_001", role: "job" },
      { passportId: "pass_entity_001", role: "entity" },
      { passportId: "pass_employee_001", role: "employee" }
    ],
    rentalExpense: {
      schema: "ixi-rental-expense-v2",
      identity: { clientRequestId: "rent-request-001" },
      context: {
        primaryPassportId: "pass_job_001",
        entityPassportId: "pass_entity_001",
        actorPassportId: "pass_employee_001",
        workOrderFinancialDocumentId: "ifd_workorder001"
      },
      vendor: { name: "United Rentals", agreementNumber: "UR-9001" },
      rentedAsset: {
        description: "CAT 336 Excavator",
        assetType: "machine",
        ownershipState: "external-owned",
        custodyState: "rented-in"
      },
      period: {
        startDate: "2026-09-01",
        expectedReturnDate: "2026-09-30",
        status: "active"
      },
      rate: { baseRate: 7000, unit: "month", minimumPeriods: 1 },
      custody: { purpose: "JOB-100", responsibleEmployeeLabel: "John Carter" },
      economics: { projectedTotal: 8250 },
      documents: [],
      status: "active"
    },
    ...overrides
  };
}

test("Rental Expense creates one canonical commitment without expense, payable, or cash duplication", () => {
  const document = createRentalExpenseDocument(input());
  assert.equal(document.documentType, "rental-expense");
  assert.equal(document.financialState, "committed");
  assert.equal(document.totals.total, 8250);
  assert.equal(document.lines.length, 1);
  assert.equal(document.lines[0].direction, "outflow");
  assert.equal(document.rentalExpense.identity.rentalExpenseId, document.financialDocumentId);
  assert.equal(document.sourceFinancialDocumentId, "ifd_workorder001");
  assert.deepEqual(document.relationships, [{ financialDocumentId: "ifd_workorder001", relationshipType: "allocated-to" }]);
  assert.equal(document.accountingTreatment.createsCommitment, true);
  assert.equal(document.accountingTreatment.createsIncurredExpense, false);
  assert.equal(document.accountingTreatment.createsPayable, false);
  assert.equal(document.accountingTreatment.createsCashEvent, false);
  assert.equal(validateFinancialDocument(document).ok, true);
  assert.equal(isNonEconomicOperationalCapture(document), false, "rental commitments remain subject to accounting period control");
});

test("Rental Expense is registered and participates in commitment lifecycle", () => {
  assert.ok(listFinancialDocumentFactoryTypes().includes("rental-expense"));
  const rental = createFinancialDocumentByType({ documentType: "rental-expense", input: input() });
  const bill = {
    financialDocumentId: "ifd_bill001",
    documentType: "bill",
    financialState: "billed",
    currency: "USD",
    occurredAt: "2026-09-30T12:00:00.000Z",
    sourceFinancialDocumentId: rental.financialDocumentId,
    totals: { total: 8000 },
    lines: []
  };
  const snapshot = createFinancialLifecycleSnapshot({ documents: [rental, bill] });
  assert.equal(snapshot.commitment, 8250);
  assert.equal(snapshot.incurredCost, 8000);
  assert.equal(snapshot.remainingCommitment, 250);
});

test("Rental Expense rejects browser-only attachment metadata", () => {
  const rental = createRentalExpenseDocument(input());
  rental.attachments = [{ fileName: "agreement.pdf", status: "local-pending-upload" }];
  const result = validateFinancialDocument(rental);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /durable uploaded evidence/i);
});
