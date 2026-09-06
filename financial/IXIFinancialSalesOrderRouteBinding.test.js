"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const routes = require("./IXIFinancialCommandRoutes");
const { createFinancialDocumentByType } = require("./IXIFinancialDocumentFactoryRegistry");
const { validateFinancialDocument } = require("./IXIFinancialValidationBridge");

test("legacy Sales Order recovers its machine Passport from one asset reference", () => {
  const input = routes.bindTrustedCommandInput({
    documentType: "sales-order",
    accessContext: {
      entityPassportId: "pass_entity",
      actorPassportId: "pass_actor",
    },
    input: {
      financialDocumentId: "ifd_order001",
      financialState: "committed",
      references: [
        { passportId: "pass_machine", role: "asset" },
        { passportId: "pass_entity", role: "entity" },
        { passportId: "pass_actor", role: "employee" },
      ],
      salesOrder: {
        schema: "ixi-equipment-sales-order-v1",
        identity: { revision: 1 },
        context: {},
        customer: { name: "Clements Farm" },
        asset: { label: "2017 Deere 544K II" },
        totals: {
          subtotal: 82000,
          tax: 0,
          freight: 0,
          fees: 0,
          tradeAllowance: 0,
          deposit: 0,
          total: 82000,
          balanceDue: 82000,
        },
        status: "draft",
      },
    },
  });

  assert.equal(input.salesOrder.context.primaryPassportId, "pass_machine");
  assert.equal(input.salesOrder.context.entityPassportId, "pass_entity");
  assert.equal(input.salesOrder.context.actorPassportId, "pass_actor");
  assert.equal(input.salesOrder.asset.passportId, "pass_machine");

  const document = createFinancialDocumentByType({
    documentType: "sales-order",
    input,
  });
  const validation = validateFinancialDocument(document);
  assert.equal(validation.ok, true, validation.errors.join("\n"));
});

test("legacy Sales Order does not guess among multiple asset Passports", () => {
  const input = routes.bindTrustedCommandInput({
    documentType: "sales-order",
    accessContext: { entityPassportId: "entity", actorPassportId: "actor" },
    input: {
      references: [
        { passportId: "asset-one", role: "asset" },
        { passportId: "asset-two", role: "asset" },
      ],
      salesOrder: { context: {}, asset: {} },
    },
  });

  assert.equal(input.salesOrder.context.primaryPassportId, "");
  assert.equal(input.salesOrder.asset.passportId, "");
});
