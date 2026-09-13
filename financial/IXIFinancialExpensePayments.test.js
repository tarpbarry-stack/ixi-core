"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createExpenseDocument } = require("./IXIFinancialExpenseFactory");
const { createPaymentDocument } = require("./IXIFinancialPaymentFactory");
const { validateFinancialDocument } = require("./IXIFinancialValidationBridge");
const { payableBalanceTransactionItems } = require("./IXIFinancialPayableBalanceControl");
const { expenseCreatesPayable } = require("./IXIFinancialExpensePaymentPolicy");
const { assertPayablesSettlementAvailable } = require("./IXIFinancialCommandEngine");
const provider = require("./IXIFinancialProviderService");
const { findPaymentReplay } = require("./IXIFinancialPaymentReplay");
const { buildFinancialCloseControls } = require("./IXIFinancialCloseControlEngine");
const refs = [{ passportId: "IXIENTITY001", role: "entity" }, { passportId: "IXIMACHINE001", role: "asset" }];
const wrap = (financialDocument, revision = 1) => ({ financialDocument, server: { revision, entityPassportId: "IXIENTITY001" } });
const expense = method => wrap(createExpenseDocument({ financialDocumentId: "ifd_expense001", amount: 1000, description: "Machine repair", vendor: "Repair Shop", category: "repairs", paymentMethod: method, expenseDate: "2026-02-03", references: refs, ...(method === "my-money" ? { reimbursement: { required: true, employeePassportId: "IXIEMPLOYEE001" } } : {}) }));
const payment = (amount = 1000, extra = {}) => wrap(createPaymentDocument({ financialDocumentId: "ifd_payment001", amount, paymentDirection: "outflow", sourceFinancialDocumentId: "ifd_expense001", occurredAt: "2026-03-04T12:00:00.000Z", paymentMethod: "ACH", transactionReference: "", references: refs, ...extra }));

test("unpaid Expense and referenced historical payment validate without requiring a bank reference", () => {
  assert.equal(validateFinancialDocument(expense("unpaid").financialDocument).ok, true);
  const saved = payment();
  assert.equal(validateFinancialDocument(saved.financialDocument).ok, true);
  assert.equal(saved.financialDocument.occurredAt, "2026-03-04T12:00:00.000Z");
  assert.equal(saved.financialDocument.transactionReference, "");
});

test("company-paid purchases do not become new payables; unpaid and reimbursement Expenses do", () => {
  assert.equal(expenseCreatesPayable(expense("unpaid").financialDocument), true);
  assert.equal(expenseCreatesPayable(expense("my-money").financialDocument), true);
  for (const method of ["company-card", "company-cash", "other"]) assert.equal(expenseCreatesPayable(expense(method).financialDocument), false);
});

test("expense payments use the same atomic balance/version guard as Bills", async () => {
  const src = expense("unpaid");
  const deps = { tableName: "test", getRecord: async () => src, getGuard: async () => ({ version: 2, paidCents: 70000, creditCents: 0 }), listRecords: async () => [] };
  const items = await payableBalanceTransactionItems({ ...deps, record: payment(300) });
  assert.equal(items[0].Put.Item.paidCents, 100000); assert.equal(items[1].ConditionCheck.ExpressionAttributeValues[":expectedRevision"], 1);
  await assert.rejects(payableBalanceTransactionItems({ ...deps, record: payment(300.01) }), /remaining Bill balance/);
  const corrected = await payableBalanceTransactionItems({ ...deps, record: payment(600), previousRecord: payment(700) });
  assert.equal(corrected[0].Put.Item.paidCents, 60000);
  const voided = payment(700); voided.financialDocument.financialState = "void";
  const reopened = await payableBalanceTransactionItems({ ...deps, record: voided, previousRecord: payment(700) });
  assert.equal(reopened[0].Put.Item.paidCents, 0);
});

test("paid Expense cannot change payment-at-entry method and generate duplicate cash", async () => {
  const prior = expense("unpaid"), next = expense("company-card");
  await assert.rejects(payableBalanceTransactionItems({ record: next, previousRecord: prior, tableName: "test", getRecord: async () => prior, getGuard: async () => ({ version: 1, paidCents: 100000, creditCents: 0 }), listRecords: async () => [] }), /saved payments/);
});

test("server payment preflight accepts unpaid Expense, blocks paid-at-entry, wrong Entity and overpayment", async () => {
  const get = provider.getDocument, list = provider.listDocumentsByPassport;
  let current = expense("unpaid"), records = [payment(600)];
  provider.getDocument = async () => ({ ok: true, data: { record: current } });
  provider.listDocumentsByPassport = async () => ({ ok: true, data: { documents: records } });
  try {
    const args = { entityPassportId: "IXIENTITY001", financialDocument: payment(400).financialDocument };
    assert.equal((await assertPayablesSettlementAvailable(args)).settled, 600);
    await assert.rejects(assertPayablesSettlementAvailable({ ...args, financialDocument: payment(401).financialDocument }), /remaining Bill balance/);
    await assert.rejects(assertPayablesSettlementAvailable({ ...args, entityPassportId: "IXIOTHER001" }), /outside/);
    current = expense("company-card"); await assert.rejects(assertPayablesSettlementAvailable(args), /paid twice/);
    current = expense("my-money"); records = []; assert.equal((await assertPayablesSettlementAvailable(args)).checked, true);
    records = [wrap({ financialDocumentId: "hold", documentType: "payables-control", sourceFinancialDocumentId: "ifd_expense001", payablesControl: { control: { hold: true } } })];
    await assert.rejects(assertPayablesSettlementAvailable(args), /hold or disputed/);
  } finally { provider.getDocument = get; provider.listDocumentsByPassport = list; }
});

test("close controls include Expense A/P once and subtract its canonical payment", () => {
  const result = buildFinancialCloseControls({ documents: [expense("unpaid").financialDocument, payment(400).financialDocument], period: "2026-03" });
  assert.equal(result.reconciliations.accountsPayable.subledger, 600);
  const paidAtEntry = buildFinancialCloseControls({ documents: [expense("company-cash").financialDocument], period: "2026-03" });
  assert.equal(paidAtEntry.reconciliations.accountsPayable.subledger, 0);
});

test("a lost final-payment response replays the saved result before checking the now-zero balance", async () => {
  const saved = payment(1000);
  const command = { documentType: "payment", idempotencyKey: "ixi-payment:retry001", entityPassportId: "IXIENTITY001", input: { sourceFinancialDocumentId: "ifd_expense001", paymentDirection: "outflow" } };
  const deps = { getIdempotency: async () => ({ financialDocumentId: "ifd_payment001" }), getDocument: async () => ({ ok: true, data: { record: saved } }) };
  const replay = await findPaymentReplay(command, deps);
  assert.equal(replay.created, false); assert.equal(replay.idempotentReplay, true); assert.equal(replay.financialDocument.totals.total, 1000);
  await assert.rejects(findPaymentReplay({ ...command, entityPassportId: "IXIOTHER001" }, deps), /another transaction/);
  await assert.rejects(findPaymentReplay({ ...command, input: { ...command.input, sourceFinancialDocumentId: "ifd_other001" } }, deps), /another transaction/);
  await assert.rejects(findPaymentReplay({ ...command, input: { ...command.input, amount: 900 } }, deps), /already saved with different details/);
});
