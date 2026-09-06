"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");

const source = fs.readFileSync(require.resolve("./IXIFinancialRoutes"), "utf8");

test("Sales Order workflow exposes authenticated Invoice ensure and manual signature commands", () => {
  assert.match(source, /\/sales-orders\/:financialDocumentId\/ensure-invoice/u);
  assert.match(source, /\/sales-orders\/:financialDocumentId\/manual-signature/u);
  assert.match(source, /financial\.sales-order\.invoice\.ensure/u);
  assert.match(source, /financial\.sales-order\.manual-signature\.complete/u);
  assert.match(source, /authorizeFinancialDocumentWrite/u);
});
