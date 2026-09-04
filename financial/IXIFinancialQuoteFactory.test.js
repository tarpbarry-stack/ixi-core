"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  createFinancialDocumentByType,
  listFinancialDocumentFactoryTypes
} = require("./IXIFinancialDocumentFactoryRegistry");
const { validateFinancialDocument } = require("./IXIFinancialValidationBridge");

function quote(overrides = {}) {
  return {
    financialDocumentId: "ifd_quote001",
    documentNumber: "QT-1001",
    financialState: "draft",
    references: [
      { passportId: "pass_machine", role: "asset" },
      { passportId: "pass_entity", role: "entity" },
      { passportId: "pass_actor", role: "employee" }
    ],
    quote: {
      schema: "ixi-equipment-quote-v1",
      identity: { revision: 1, clientRequestId: "quote-request-001" },
      context: {
        primaryPassportId: "pass_machine",
        entityPassportId: "pass_entity",
        actorPassportId: "pass_actor"
      },
      customer: {},
      asset: { passportId: "pass_machine", label: "2022 CAT 336" },
      commercial: {},
      totals: { subtotal: 0, tax: 0, freight: 0, fees: 0, tradeAllowance: 0, total: 0 },
      status: "draft",
      ...overrides
    }
  };
}

test("equipment Quote is registered and accepts an incomplete business draft", () => {
  assert.ok(listFinancialDocumentFactoryTypes().includes("quote"));
  const document = createFinancialDocumentByType({ documentType: "quote", input: quote() });
  const validation = validateFinancialDocument(document);
  assert.equal(validation.ok, true, validation.errors.join("\n"));
  assert.equal(document.documentType, "quote");
  assert.equal(document.quote.customer.name, undefined);
  assert.equal(document.totals.total, 0);
  assert.equal(document.accountingTreatment.economicEvent, false);
});

test("equipment Quote preserves a formal customer total without creating accounting", () => {
  const document = createFinancialDocumentByType({
    documentType: "quote",
    input: quote({
      customer: { name: "ABC Contractors", contactName: "John", phone: "555-0100" },
      totals: { subtotal: 185000, tax: 0, freight: 2750, fees: 250, tradeAllowance: 80000, total: 108000 },
      status: "prepared"
    })
  });
  const validation = validateFinancialDocument(document);
  assert.equal(validation.ok, true, validation.errors.join("\n"));
  assert.equal(document.quote.totals.total, 108000);
  assert.equal(document.totals.subtotal, 185000);
  assert.equal(document.totals.customerTotal, 108000);
  assert.equal(document.accountingTreatment.createsReceivable, false);
});

test("equipment Quote rejects forged totals while allowing blank commercial fields", () => {
  const document = createFinancialDocumentByType({ documentType: "quote", input: quote() });
  document.quote.totals.total = 50;
  const validation = validateFinancialDocument(document);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes("quote customer total is invalid."));
});

test("equipment Quote HTTP controls bind authenticated Entity and employee identity", () => {
  const commands = fs.readFileSync(require.resolve("./IXIFinancialCommandRoutes"), "utf8");
  const routes = fs.readFileSync(require.resolve("./IXIFinancialRoutes"), "utf8");
  assert.match(commands, /if\(type==="quote"\)/u);
  assert.match(commands, /actorPassportId:clean\(accessContext\.actorPassportId\)/u);
  assert.match(routes, /if \(type === "quote"\)/u);
  assert.match(routes, /createdAt: clean\(prior\?\.audit\?\.createdAt/u);
  assert.match(routes, /updatedBy: actorPassportId/u);
});
