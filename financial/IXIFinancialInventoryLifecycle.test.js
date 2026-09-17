"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { projectInventory, querySoldInventory } = require("./IXIFinancialInventoryLifecycle");
const { planAdjustment, planRefund, planReturn } = require("./IXIFinancialSaleReturnService");
const { validateFinancialDocument } = require("./IXIFinancialValidationBridge");
const { createFinancialLifecycleSnapshot } = require("./IXIFinancialLifecycleEngine");
const { createSaleBalanceTransactionItems } = require("./IXIFinancialDynamoStore");

const context = { entityPassportId: "IXIENTITY1", actorPassportId: "IXIACTOR01" };
const refs = [{ role: "entity", passportId: context.entityPassportId }, { role: "asset", passportId: "IXIMACHINE1" }];
const invoice = () => ({ financialDocumentId: "ifd_sale001", documentType: "invoice", documentNumber: "INV-100", financialState: "collected", currency: "USD",
  occurredAt: "2026-02-01", references: refs, totals: { total: 10000 },
  lines: [{ amount: 10000, direction: "inflow", currency: "USD" }],
  metadata: { assetSale: true, assetSaleRecord: { identity: { saleId: "ifd_sale001", financialInvoiceId: "ifd_sale001" }, status: "sold",
    context: { assetPassportId: "IXIMACHINE1", entityPassportId: context.entityPassportId, assetLabel: "2018 VOLVO A25G" },
    sale: { saleDate: "2026-02-01", salePrice: 10000, machineSalePrice: 9500, buyerLabel: "Buyer A", soldByLabel: "Dealer" },
    audit: { closedAt: "2026-09-15T12:00:00Z", createdByLabel: "Bookkeeper" } } } });
const receipt = { financialDocumentId: "ifd_receipt1", documentType: "payment", financialState: "paid", paymentDirection: "inflow", sourceFinancialDocumentId: "ifd_sale001",
  currency: "USD", occurredAt: "2026-02-01", references: refs, totals: { total: 10000 }, lines: [{ amount: 10000, direction: "inflow", currency: "USD" }] };
const acquisition = { financialDocumentId: "ifd_acq001", documentType: "asset-acquisition", financialState: "incurred", occurredAt: "2026-01-01", references: refs, totals: { total: 7000 } };
const base = () => [invoice(), receipt, acquisition];

test("a collected sale leaves owned inventory before settlement and retains original dates and salesperson", () => {
  const result = projectInventory({ records: base(), entityPassportId: context.entityPassportId });
  assert.equal(result.current.IXIMACHINE1.state, "sold");
  assert.equal(result.sales[0].settlementStatus, "open");
  assert.equal(result.sales[0].salePrice, 9500);
  assert.equal(result.sales[0].saleDate, "2026-02-01");
  assert.equal(result.sales[0].soldByLabel, "Dealer");
  assert.equal(result.sales[0].recordedByLabel, "Bookkeeper");
});

test("other companies cannot enter this inventory projection", () => {
  const result = projectInventory({ records: base(), entityPassportId: "IXIOTHER01" });
  assert.deepEqual(result.sales, []);
  assert.deepEqual(result.current, {});
});

test("recorded trade credits remain noncash consideration in SOLD inventory", () => {
  const doc = invoice();
  doc.metadata.assetSaleRecord.collection = { tradeValue: 10000 };
  const credit = { documentType: "credit", creditType: "trade-credit", financialState: "incurred", financialDocumentId: "test-trade-credit", sourceFinancialDocumentId: doc.financialDocumentId, references: refs, totals: { total: 10000 } };
  const result = projectInventory({ records: [doc, credit, acquisition], entityPassportId: context.entityPassportId });
  assert.equal(result.current.IXIMACHINE1.state, "sold");
  assert.equal(result.sales[0].tradeCreditAmount, 10000);
  assert.equal(result.sales[0].refundDue, 0);
  assert.equal(result.issues.some(issue => issue.code === "COLLECTION_RECONCILIATION_REQUIRED"), false);
});

test("trade sales retain historical machine price and dates while cash stays separate", () => {
  const doc = invoice();
  doc.totals.total = 85000;
  doc.lines[0].amount = 85000;
  doc.metadata.trades = [{ allowance: 20619 }, { allowance: 20619 }];
  doc.metadata.commercialBreakdown = { subtotal: 126238, tax: 0, freight: 0, fees: 0, tradeAllowance: 41238, total: 85000 };
  delete doc.metadata.assetSaleRecord.sale.machineSalePrice;
  doc.metadata.assetSaleRecord.sale.saleDate = "2026-09-15";
  doc.metadata.assetSaleRecord.collection = { tradeValue: 41238 };
  const cash = { ...receipt, totals: { total: 85000 } };
  const before = structuredClone(doc);
  const result = projectInventory({ records: [doc, cash, acquisition], entityPassportId: context.entityPassportId });
  assert.equal(result.sales[0].salePrice, 126238);
  assert.equal(result.sales[0].customerTotal, 85000);
  assert.equal(result.sales[0].amountReceived, 85000);
  assert.equal(result.sales[0].saleDate, "2026-02-01");
  assert.equal(result.sales[0].recordedSaleDate, "2026-09-15");
  assert.deepEqual(doc, before);
});

test("verified all-trade SOLD does not invent cash or a missing-receipt warning", () => {
  const doc = invoice();
  doc.totals.total = 0;
  doc.lines[0].amount = 0;
  doc.metadata.trades = [{ allowance: 10000 }];
  doc.metadata.assetSaleRecord.sale.machineSalePrice = 10000;
  doc.metadata.assetSaleRecord.collection = { invoiceTotal: 0, amountReceived: 0, tradeValue: 10000 };
  const result = projectInventory({ records: [doc, acquisition], entityPassportId: context.entityPassportId });
  assert.equal(result.current.IXIMACHINE1.state, "sold");
  assert.equal(result.sales[0].amountReceived, 0);
  assert.equal(result.sales[0].salePrice, 10000);
  assert.equal(result.issues.some(issue => issue.code === "COLLECTION_RECONCILIATION_REQUIRED"), false);
  delete doc.metadata.assetSaleRecord.collection;
  const incomplete = projectInventory({ records: [doc], entityPassportId: context.entityPassportId });
  assert.equal(incomplete.issues.some(issue => issue.code === "COLLECTION_RECONCILIATION_REQUIRED"), true);
});

test("historical transactions entered later are ordered by effective business date", () => {
  const reacquisition = { ...acquisition, financialDocumentId: "ifd_acq002", occurredAt: "2026-03-01" };
  const result = projectInventory({ records: [...base(), reacquisition], entityPassportId: context.entityPassportId });
  assert.equal(result.current.IXIMACHINE1.state, "owned");
  assert.equal(result.sales.length, 1);
});

test("customer price adjustment reduces revenue, not acquisition cost, and leaves the machine sold", () => {
  const plan = planAdjustment({ invoice: invoice(), documents: base(), accessContext: context,
    body: { commandId: "adjustment-001", kind: "price-adjustment", effectiveDate: "2026-02-02", amount: 1000, reason: "Repair allowance" } });
  const check = validateFinancialDocument(plan.document);
  assert.equal(check.ok, true, JSON.stringify(check));
  const result = projectInventory({ records: [...base(), plan.document], entityPassportId: context.entityPassportId });
  assert.equal(result.current.IXIMACHINE1.state, "sold");
  assert.equal(result.sales[0].refundDue, 1000);
  assert.equal(result.sales[0].amountReceived, 10000);
  assert.equal(plan.document.creditType, "revenue-credit");
  const snapshot = createFinancialLifecycleSnapshot({ documents: [...base(), plan.document] });
  assert.equal(snapshot.revenue, 9000);
});

test("refund records the actual cash event without returning the machine", () => {
  const adjustment = planAdjustment({ invoice: invoice(), documents: base(), accessContext: context,
    body: { commandId: "adjustment-002", kind: "price-adjustment", effectiveDate: "2026-02-02", amount: 1000, reason: "Repair allowance" } });
  const refund = planRefund({ invoice: invoice(), documents: [...base(), adjustment.document], accessContext: context,
    body: { commandId: "refund-0001", creditId: adjustment.document.financialDocumentId, effectiveDate: "2026-02-03", amount: 1000, paymentMethod: "wire", reference: "WIRE-100" } });
  const result = projectInventory({ records: [...base(), adjustment.document, refund.document], entityPassportId: context.entityPassportId });
  assert.equal(result.current.IXIMACHINE1.state, "sold");
  assert.equal(result.sales[0].refundedAmount, 1000);
  assert.equal(result.sales[0].refundDue, 0);
  const snapshot = createFinancialLifecycleSnapshot({ documents: [...base(), adjustment.document, refund.document] });
  assert.equal(snapshot.collected, 9000);
  assert.equal(refund.document.paymentKind, "refund");
});

test("return requires a full linked return credit, actual possession confirmation and current revision", () => {
  const adjustment = planAdjustment({ invoice: invoice(), documents: base(), accessContext: context,
    body: { commandId: "return-credit-01", kind: "return", effectiveDate: "2026-02-02", amount: 10000, reason: "Sale cancelled" } });
  const options = { invoice: invoice(), record: { server: { revision: 7 } }, documents: [...base(), adjustment.document], accessContext: context,
    body: { commandId: "return-private-01", expectedRevision: 7, creditId: adjustment.document.financialDocumentId, effectiveDate: "2026-02-03", reason: "Machine received at yard", machineReturned: true } };
  assert.throws(() => planReturn({ ...options, body: { ...options.body, machineReturned: false } }), /Confirm/);
  assert.throws(() => planReturn({ ...options, body: { ...options.body, expectedRevision: 6 } }), /changed/);
  const planned = planReturn(options);
  const returnedInvoice = { ...invoice(), ...planned.patch };
  const result = projectInventory({ records: [returnedInvoice, receipt, acquisition, adjustment.document], entityPassportId: context.entityPassportId });
  assert.equal(result.current.IXIMACHINE1.state, "owned");
  assert.equal(result.current.IXIMACHINE1.forcePrivate, true);
  assert.equal(result.sales[0].status, "returned");
  assert.equal(result.sales[0].refundDue, 10000);
  assert.deepEqual(returnedInvoice.metadata.assetSaleRecord, invoice().metadata.assetSaleRecord);
  assert.equal(planReturn({ ...options, invoice: returnedInvoice }).replay.commandId, options.body.commandId);
});

test("excess credits, insufficient return credits and invalid dates are rejected", () => {
  const body = { commandId: "adjustment-003", kind: "return", effectiveDate: "2026-02-02", amount: 10000, reason: "Return" };
  const args = { invoice: invoice(), documents: base(), accessContext: context };
  assert.throws(() => planAdjustment({ ...args, body: { ...body, amount: 11000 } }), /exceeds/);
  assert.throws(() => planAdjustment({ ...args, body: { ...body, amount: 9000 } }), /remaining invoice/);
  assert.throws(() => planAdjustment({ ...args, body: { ...body, effectiveDate: "2026-02-30" } }), /valid/);
});

test("Dynamo persists credit limits in the document transaction and forbids overwriting them", () => {
  const plan = planAdjustment({ invoice: invoice(), documents: base(), accessContext: context,
    body: { commandId: "adjustment-004", kind: "price-adjustment", effectiveDate: "2026-02-02", amount: 1000, reason: "Allowance" } });
  const record = { financialDocument: plan.document, server: { entityPassportId: context.entityPassportId } };
  const items = createSaleBalanceTransactionItems({ record });
  assert.equal(items[0].Update.ExpressionAttributeValues[":remaining"], 900000);
  assert.match(items[0].Update.ConditionExpression, /#used <= :remaining/);
  assert.throws(() => createSaleBalanceTransactionItems({ record, previousRecord: record }), /immutable/);
});

test("sold search and pagination keep dates, buyer and settlement filters together", () => {
  const projection = projectInventory({ records: base(), entityPassportId: context.entityPassportId });
  assert.equal(querySoldInventory(projection, { q: "buyer a", from: "2026-01-01", settlement: "open" }).total, 1);
  assert.equal(querySoldInventory(projection, { q: "other" }).total, 0);
  assert.equal(querySoldInventory(projection, { from: "2026-03-01" }).total, 0);
});


test("entering an older acquisition later cannot undo a sale on the same business day", () => {
  const lateEntry = { ...acquisition, occurredAt: "2026-02-01", createdAt: "2026-09-20T12:00:00Z" };
  const result = projectInventory({ records: [invoice(), receipt, lateEntry], entityPassportId: context.entityPassportId });
  assert.equal(result.current.IXIMACHINE1.state, "sold");
});

test("customer tax credits retain tax separately and refunds reject fractional cents", () => {
  const taxed = { ...invoice(), totals: { total: 10000, tax: 500 } };
  assert.throws(() => planAdjustment({ invoice: taxed, documents: [taxed, receipt], accessContext: context,
    body: { commandId: "tax-credit-test", kind: "price-adjustment", effectiveDate: "2026-02-02", amount: 1000, reason: "Price allowance" } }), /Specify the tax/);
  const credit = planAdjustment({ invoice: taxed, documents: [taxed, receipt], accessContext: context,
    body: { commandId: "tax-credit-test", kind: "return", effectiveDate: "2026-02-02", amount: 10000, reason: "Full machine return" } }).document;
  assert.equal(credit.totals.tax, 500);
  assert.equal(credit.totals.subtotal, 9500);
  assert.equal(credit.metadata.saleTaxCreditControl.limitCents, 50000);
  assert.throws(() => planRefund({ invoice: taxed, documents: [taxed, receipt, credit], accessContext: context,
    body: { commandId: "fractional-refund", creditId: credit.financialDocumentId, amount: 1.001, effectiveDate: "2026-02-03", paymentMethod: "wire", reference: "test" } }), /decimal/);
});

test("an incomplete historical SOLD record is held out of available inventory for reconciliation", () => {
  const incomplete = invoice();
  delete incomplete.metadata.assetSaleRecord.identity;
  const result = projectInventory({ records: [incomplete, acquisition], entityPassportId: context.entityPassportId });
  assert.equal(result.current.IXIMACHINE1.state, "sold");
  assert.equal(result.current.IXIMACHINE1.reconciliationRequired, true);
  assert.equal(result.issues[0].code, "INCOMPLETE_SALE_IDENTITY");
});

test("historical invoice totals are not presented as verified machine sale prices", () => {
  const historical = invoice();
  delete historical.metadata.assetSaleRecord.sale.machineSalePrice;
  const result = projectInventory({ records: [historical, receipt], entityPassportId: context.entityPassportId });
  assert.equal(result.sales[0].salePrice, null);
  assert.equal(result.sales[0].customerTotal, 10000);
  assert.ok(result.issues.some(issue => issue.code === "MACHINE_SALE_PRICE_NOT_RECORDED"));
});

test("same-day return and resale keep the latest cycle sold and retain both sale records", async () => {
  const { bindSoldInventory } = require("./IXIFinancialSaleWriteControl");
  const returned = invoice();
  returned.metadata.inventoryLifecycle = { events: [{ type: "return-to-private", effectiveDate: "2026-02-01", sequence: 2, recordedAt: "2026-09-16T10:00:00Z" }] };
  const projection = projectInventory({ records: [returned, receipt, acquisition], entityPassportId: context.entityPassportId });
  const next = invoice();
  next.financialDocumentId = "ifd_sale002";
  next.metadata.assetSaleRecord.identity = { saleId: next.financialDocumentId, financialInvoiceId: next.financialDocumentId };
  const existing = { ...next, metadata: {} };
  next.metadata = await bindSoldInventory({ existing, next, accessContext: context, commandId: "same-day-resale", inventoryLoader: async () => projection });
  assert.equal(next.metadata.inventoryMutation.sequence, 3);
  const result = projectInventory({ records: [returned, receipt, acquisition, next], entityPassportId: context.entityPassportId });
  assert.equal(result.current.IXIMACHINE1.state, "sold");
  assert.equal(result.current.IXIMACHINE1.documentId, "ifd_sale002");
  assert.equal(result.sales.length, 2);
});


test("legacy SOLD cards use the recorded single-machine invoice subtotal without altering history", () => {
  const historical = invoice();
  delete historical.metadata.assetSaleRecord.sale.machineSalePrice;
  historical.metadata.commercialBreakdown = { subtotal: 10000, tax: 0, freight: 0, fees: 0, tradeAllowance: 0, deposit: 0, total: 10000 };
  const before = JSON.stringify(historical);
  const result = projectInventory({ records: [historical, receipt], entityPassportId: context.entityPassportId });
  assert.equal(result.sales[0].salePrice, 10000);
  assert.equal(result.sales[0].salePriceSource, "invoice-commercial-subtotal");
  assert.equal(result.sales[0].customerTotal, 10000);
  assert.equal(result.current.IXIMACHINE1.state, "sold");
  assert.ok(!result.issues.some(issue => issue.code === "MACHINE_SALE_PRICE_NOT_RECORDED"));
  assert.equal(JSON.stringify(historical), before);
});

test("legacy machine price excludes tax, freight and fees and is not reduced by deposits or trades", () => {
  const historical = invoice();
  delete historical.metadata.assetSaleRecord.sale.machineSalePrice;
  historical.totals = { subtotal: 10000, total: 9250 };
  historical.lines = [{ amount: 9250, references: refs }];
  historical.metadata.assetSaleRecord.sale.salePrice = 9250;
  historical.metadata.commercialBreakdown = { subtotal: 10000, tax: 600, freight: 500, fees: 150, tradeAllowance: 2000, deposit: 3000, total: 9250 };
  const result = projectInventory({ records: [historical], entityPassportId: context.entityPassportId });
  assert.equal(result.sales[0].salePrice, 10000);
  assert.equal(result.sales[0].customerTotal, 9250);
});

test("an inconsistent, incomplete or multi-machine invoice cannot supply one machine's price", () => {
  for (const change of [
    doc => { doc.metadata.commercialBreakdown.total = 9999; },
    doc => { doc.totals.total = 9999; },
    doc => { delete doc.metadata.commercialBreakdown.tax; },
    doc => { doc.references = [...refs, { role: "asset", passportId: "IXIMACHINE2" }]; },
    doc => { doc.lines[0].references = [{ role: "asset", passportId: "IXIMACHINE2" }]; },
    doc => { doc.metadata.assetSaleRecord.context.assetPassportId = "IXIMACHINE2"; }
  ]) {
    const historical = invoice();
    delete historical.metadata.assetSaleRecord.sale.machineSalePrice;
    historical.metadata.commercialBreakdown = { subtotal: 10000, tax: 0, freight: 0, fees: 0, tradeAllowance: 0, total: 10000 };
    change(historical);
    const result = projectInventory({ records: [historical], entityPassportId: context.entityPassportId });
    assert.equal(result.sales[0].salePrice, null);
    assert.ok(result.issues.some(issue => issue.code === "MACHINE_SALE_PRICE_NOT_RECORDED"));
  }
});

test("an explicit machine sale price remains authoritative including an explicit zero", () => {
  for (const amount of [0, 9500]) {
    const current = invoice();
    current.metadata.assetSaleRecord.sale.machineSalePrice = amount;
    current.metadata.commercialBreakdown = { subtotal: 10000, tax: 0, freight: 0, fees: 0, tradeAllowance: 0, total: 10000 };
    const result = projectInventory({ records: [current], entityPassportId: context.entityPassportId });
    assert.equal(result.sales[0].salePrice, amount);
    assert.equal(result.sales[0].salePriceSource, "sold-record");
  }
});

const legacyEntryDateInvoice = () => {
  const doc = invoice();
  doc.metadata.assetSaleRecord.sale.saleDate = "2026-09-15";
  return doc;
};

test("historical entry dates resolve from matching invoice and full receipt, preserving audit evidence", () => {
  const original = legacyEntryDateInvoice();
  const before = JSON.stringify(original);
  const projected = projectInventory({ records: [original, receipt, acquisition], entityPassportId: context.entityPassportId });
  const sale = projected.sales[0];
  assert.equal(sale.saleDate, "2026-02-01");
  assert.equal(sale.saleDateSource, "invoice-and-collection");
  assert.equal(sale.recordedSaleDate, "2026-09-15");
  assert.equal(sale.recordedAt, "2026-09-15T12:00:00Z");
  assert.equal(projected.current.IXIMACHINE1.effectiveDate, "2026-02-01");
  assert.equal(querySoldInventory(projected, { from: "2026-02-01", to: "2026-02-28" }).total, 1);
  assert.equal(querySoldInventory(projected, { from: "2026-09-01" }).total, 0);
  assert.equal(JSON.stringify(original), before);
});

test("explicit operator dates and legacy dates distinct from entry day remain authoritative", () => {
  for (const fields of [{ saleDate: "2026-09-15", saleDateSource: "operator" }, { saleDate: "2026-02-05" }]) {
    const doc = legacyEntryDateInvoice();
    Object.assign(doc.metadata.assetSaleRecord.sale, fields);
    const result = projectInventory({ records: [doc, receipt], entityPassportId: context.entityPassportId });
    assert.equal(result.sales[0].saleDate, fields.saleDate);
  }
});

test("partial, late, unrelated, wrong-company, wrong-currency and unposted funds cannot backdate SOLD", () => {
  for (const change of [
    { totals: { total: 5000 } }, { occurredAt: "2026-02-02" }, { occurredAt: "2026-01-31" },
    { sourceFinancialDocumentId: "ifd_other" }, { financialState: "draft" }, { financialState: "void" },
    { currency: "EUR" }, { references: [{ role: "entity", passportId: "IXIOTHER01" }] },
    { paymentDirection: "outflow" }, { occurredAt: "2026-02-30" },
  ]) {
    const result = projectInventory({ records: [legacyEntryDateInvoice(), { ...receipt, ...change }], entityPassportId: context.entityPassportId });
    assert.equal(result.sales[0].saleDate, "2026-09-15", JSON.stringify(change));
  }
});

test("split collections resolve the invoice date and duplicate receipt IDs cannot simulate full collection", () => {
  const deposit = { ...receipt, financialDocumentId: "ifd_deposit", occurredAt: "2026-01-31", totals: { total: 5000 } };
  const balance = { ...receipt, totals: { total: 5000 } };
  const project = payments => projectInventory({ records: [legacyEntryDateInvoice(), ...payments], entityPassportId: context.entityPassportId }).sales[0];
  assert.equal(project([deposit, balance]).saleDate, "2026-02-01");
  assert.equal(project([balance, balance]).saleDate, "2026-09-15");
});

test("a later acquisition stays owned when an earlier historical sale was entered in September", () => {
  const result = projectInventory({ records: [legacyEntryDateInvoice(), receipt, { ...acquisition, occurredAt: "2026-03-01" }], entityPassportId: context.entityPassportId });
  assert.equal(result.current.IXIMACHINE1.state, "owned");
  assert.equal(result.current.IXIMACHINE1.effectiveDate, "2026-03-01");
});

test("historical adjustments and returns use the same resolved business date as SOLD inventory", () => {
  const doc = legacyEntryDateInvoice();
  const documents = [doc, receipt, acquisition];
  const body = { commandId: "historical-return-01", kind: "return", effectiveDate: "2026-02-02", amount: 10000, reason: "Sale cancelled" };
  assert.throws(() => planAdjustment({ invoice: doc, documents, body: { ...body, effectiveDate: "2026-01-31" }, accessContext: context }), /predate/);
  const credit = planAdjustment({ invoice: doc, documents, body, accessContext: context }).document;
  const args = { invoice: doc, documents: [...documents, credit], accessContext: context, record: { server: { revision: 7 } },
    body: { commandId: "historical-private-01", expectedRevision: 7, creditId: credit.financialDocumentId, effectiveDate: "2026-02-03", reason: "Machine received at yard", machineReturned: true } };
  const plan = planReturn(args);
  assert.equal(plan.event.effectiveDate, "2026-02-03");
  assert.deepEqual(plan.patch.metadata.assetSaleRecord, doc.metadata.assetSaleRecord);
  assert.throws(() => planReturn({ ...args, body: { ...args.body, effectiveDate: "2026-02-01" } }), /predate/);
});

test("new closeouts stamp date provenance and cannot claim an unrelated invoice date", async () => {
  const { bindSoldInventory } = require("./IXIFinancialSaleWriteControl");
  const existing = invoice();
  existing.metadata = { assetSale: true };
  for (const [day, inputSource, expectedSource] of [
    ["2026-02-01", "invoice", "invoice"], ["2026-09-15", "invoice", "operator"], ["2026-09-15", undefined, "operator"],
  ]) {
    const next = invoice();
    next.metadata.assetSaleRecord.sale.saleDate = day;
    next.metadata.assetSaleRecord.sale.saleDateSource = inputSource;
    const result = await bindSoldInventory({ existing, next, accessContext: context, commandId: "closeout-provenance", inventoryLoader: async () => ({ current: {}, sales: [] }) });
    assert.equal(result.assetSaleRecord.sale.saleDate, day);
    assert.equal(result.assetSaleRecord.sale.saleDateSource, expectedSource);
    assert.equal(result.inventoryMutation.effectiveDate, day);
  }
});
