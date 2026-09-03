"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createAssetAcquisitionDocument } = require("./IXIFinancialAssetAcquisitionFactory");
const { createFinancialDocumentByType } = require("./IXIFinancialDocumentFactoryRegistry");
const { validateFinancialDocument } = require("./IXIFinancialValidationBridge");
const { isNonEconomicOperationalCapture } = require("./IXIFinancialCommandEngine");

function acquisitionRecord(overrides = {}) {
  return {
    schema: "ixi-asset-acquisition-v2",
    identity: { clientRequestId: "acq-request-1" },
    context: {
      primaryPassportId: "passport:machine:1",
      primaryObjectId: "machine:1",
      primaryObjectType: "machine",
      primaryLabel: "2020 CAT 336",
      entityPassportId: "passport:entity:1",
      actorPassportId: "passport:employee:1",
      actorLabel: "John Carter"
    },
    acquisition: {
      type: "direct-purchase",
      sellerLabel: "Barry Equipment",
      purchaseDate: "2026-09-03",
      purchasePrice: 150000,
      buyerPremium: 3000,
      tax: 750,
      titleFees: 125,
      brokerFees: 0,
      otherAcquisitionFees: 1000,
      directAcquisitionCost: 154875
    },
    ownership: {
      owners: [{ partyLabel: "IronXchange LLC", legalOwnershipPercent: 100, settlementSharePercent: 100 }],
      legalOwnershipTotal: 100,
      settlementShareTotal: 100,
      initialCapitalTotal: 154875,
      events: []
    },
    funding: {
      payments: [{ date: "2026-09-03", amount: 100000, method: "wire", reference: "WIRE-1" }],
      amountPaid: 100000,
      balanceDue: 54875,
      financed: true,
      lenderLabel: "Equipment Bank"
    },
    title: { titleRequired: true, titleStatus: "pending", lienStatus: "release-pending" },
    makeReady: { estimates: [], actuals: [], actualTotal: 0, status: "open" },
    ...overrides
  };
}

function createAcquisition(overrides = {}) {
  return createAssetAcquisitionDocument({
    financialDocumentId: "ifd_acquisitioncommercialabcdef",
    references: [
      { passportId: "passport:machine:1", role: "asset", label: "2020 CAT 336" },
      { passportId: "passport:entity:1", role: "entity", label: "IronXchange LLC" },
      { passportId: "passport:employee:1", role: "employee", label: "John Carter" }
    ],
    assetAcquisition: acquisitionRecord(),
    ...overrides
  });
}

test("Asset Acquisition creates one canonical capitalized basis without cash, expense, or payable duplication", () => {
  const document = createAcquisition();
  assert.equal(document.documentType, "asset-acquisition");
  assert.equal(document.documentNumber, "ACQ-ABCDEF");
  assert.equal(document.assetAcquisition.identity.acquisitionId, document.financialDocumentId);
  assert.equal(document.lines.length, 1);
  assert.equal(document.lines[0].lineType, "asset-basis");
  assert.equal(document.lines[0].direction, "neutral");
  assert.equal(document.totals.purchasePrice, 150000);
  assert.equal(document.totals.capitalizedAcquisitionCosts, 4875);
  assert.equal(document.totals.acquisitionBasis, 154875);
  assert.equal(document.accountingTreatment.nonExpense, true);
  assert.equal(document.accountingTreatment.nonCash, true);
  assert.equal(document.accountingTreatment.createsObligation, false);
  assert.equal(validateFinancialDocument(document).ok, true);
  assert.equal(isNonEconomicOperationalCapture(document), false, "basis remains subject to accounting period control");
});

test("Asset Acquisition preserves optional source-document lineage without creating a second obligation", () => {
  const document = createAcquisition({ sourceFinancialDocumentId: "ifd_bill123" });
  assert.equal(document.sourceFinancialDocumentId, "ifd_bill123");
  assert.deepEqual(document.relationships, [{ financialDocumentId: "ifd_bill123", relationshipType: "supported-by" }]);
  assert.equal(document.funding.createsPayable, false);
  assert.equal(validateFinancialDocument(document).ok, true);
});

test("registry supports asset-acquisition and rejects malformed basis, ownership, and non-durable evidence", () => {
  const document = createFinancialDocumentByType({
    documentType: "asset-acquisition",
    input: { ...createAcquisition(), financialDocumentId: "ifd_acquisitionregistryabcdef" }
  });
  assert.equal(document.documentType, "asset-acquisition");

  document.assetAcquisition.acquisition.directAcquisitionCost = 1;
  document.assetAcquisition.ownership.legalOwnershipTotal = 95;
  document.attachments = [{ fileName: "bill.pdf", status: "local-pending-upload" }];
  const result = validateFinancialDocument(document);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /basis must equal/u);
  assert.match(result.errors.join(" "), /ownership must total 100/u);
  assert.match(result.errors.join(" "), /durable uploaded evidence/u);
});
