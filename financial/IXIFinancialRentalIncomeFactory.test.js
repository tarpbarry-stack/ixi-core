"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRentalIncomeDocument } = require("./IXIFinancialRentalIncomeFactory");
const { createFinancialDocumentByType, listFinancialDocumentFactoryTypes } = require("./IXIFinancialDocumentFactoryRegistry");
const { createInvoiceDocument } = require("./IXIFinancialInvoiceFactory");
const { validateFinancialDocument } = require("./IXIFinancialValidationBridge");
const { createFinancialLifecycleSnapshot, createFinancialLifecycleFacts } = require("./IXIFinancialLifecycleEngine");
const { isNonEconomicOperationalCapture } = require("./IXIFinancialCommandEngine");

function input(overrides = {}) {
  return {
    financialDocumentId: "ifd_rentalincome001",
    documentNumber: "RNTINC-00001",
    references: [
      { passportId: "pass_asset_001", role: "asset" },
      { passportId: "pass_entity_001", role: "entity" },
      { passportId: "pass_employee_001", role: "employee" }
    ],
    rentalIncome: {
      schema: "ixi-rental-income-v2",
      identity: { clientRequestId: "rental-income-request-001" },
      context: {
        primaryPassportId: "pass_asset_001",
        entityPassportId: "pass_entity_001",
        actorPassportId: "pass_employee_001"
      },
      customer: { name: "Granite Construction", rentalAgreementNumber: "GC-2026-88" },
      ownedAsset: {
        passportId: "pass_asset_001",
        label: "CAT 336 Excavator",
        ownershipState: "owned",
        custodyState: "customer-custody"
      },
      period: { startDate: "2026-09-01", expectedReturnDate: "2026-09-30", status: "active" },
      rate: { baseRate: 7000, unit: "month", minimumPeriods: 1 },
      economics: {
        projectedRevenue: 8250,
        projectedTax: 660,
        projectedDeposit: 2000,
        projectedInvoiceTotal: 10910
      },
      documents: [],
      status: "active"
    },
    ...overrides
  };
}

test("Rental Income creates one revenue contract without billed revenue, A/R, or cash duplication", () => {
  const document = createRentalIncomeDocument(input());
  assert.equal(document.documentType, "rental-income");
  assert.equal(document.financialState, "committed");
  assert.equal(document.totals.total, 8250);
  assert.equal(document.totals.projectedTax, 660);
  assert.equal(document.totals.refundableDeposit, 2000);
  assert.equal(document.lines.length, 1);
  assert.equal(document.lines[0].direction, "inflow");
  assert.equal(document.rentalIncome.identity.rentalIncomeId, document.financialDocumentId);
  assert.equal(document.accountingTreatment.createsRevenueCommitment, true);
  assert.equal(document.accountingTreatment.createsBilledRevenue, false);
  assert.equal(document.accountingTreatment.createsReceivable, false);
  assert.equal(document.accountingTreatment.createsCashEvent, false);
  assert.equal(validateFinancialDocument(document).ok, true);
  assert.equal(isNonEconomicOperationalCapture(document), false, "revenue contracts remain subject to accounting period control");
});

test("A linked Invoice consumes Rental Income contract value without double-counting revenue", () => {
  assert.ok(listFinancialDocumentFactoryTypes().includes("rental-income"));
  const rental = createFinancialDocumentByType({ documentType: "rental-income", input: input() });
  const invoice = createInvoiceDocument({
    financialDocumentId: "ifd_invoice001",
    financialState: "billed",
    amount: 8000,
    sourceFinancialDocumentId: rental.financialDocumentId
  });
  const snapshot = createFinancialLifecycleSnapshot({ documents: [rental, invoice] });
  assert.equal(snapshot.contractedRevenue, 8250);
  assert.equal(snapshot.remainingContractedRevenue, 250);
  assert.equal(snapshot.revenue, 8000);
  assert.equal(snapshot.receivable, 8000);
  assert.equal(snapshot.projectedInflow, 8250);
  const fact = createFinancialLifecycleFacts({ documents: [rental, invoice] }).find(item => item.documentType === "rental-income");
  assert.equal(fact.contractedRevenue, 8250);
  assert.equal(fact.remainingContractedRevenue, 250);
});

test("Rental Income rejects browser-only attachment metadata", () => {
  const rental = createRentalIncomeDocument(input());
  rental.attachments = [{ fileName: "agreement.pdf", status: "local-pending-upload" }];
  const result = validateFinancialDocument(rental);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /durable uploaded evidence/i);
});
