"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildFinancialCloseControls } = require("./IXIFinancialCloseControlEngine");

const chart = [
  { code: "1010", name: "Cash", type: "asset", control: "cash" },
  { code: "1100", name: "Accounts Receivable", type: "asset", control: "ar" },
  { code: "2000", name: "Accounts Payable", type: "liability", control: "ap" },
  { code: "4100", name: "Revenue", type: "revenue", control: "revenue" },
  { code: "6110", name: "Expense", type: "expense", control: "expense" },
  { code: "6990", name: "Review", type: "expense", control: "suspense" }
];

const invoice = { financialDocumentId: "ifd_invoice", documentType: "invoice", financialState: "billed", period: "2026-09", currency: "USD", totals: { total: 100 } };
const bill = { financialDocumentId: "ifd_bill", documentType: "bill", financialState: "billed", period: "2026-09", currency: "USD", totals: { total: 40 }, accountingTreatment: { economicEvent: true, createsPayable: true } };
const cashAccount = { financialDocumentId: "ifd_cash", documentType: "treasury-account", financialState: "submitted", occurredAt: "2026-09-01", currency: "USD", treasuryAccount: { account: { name: "Operating", active: true } } };
const opening = { financialDocumentId: "ifd_opening", documentType: "payment", financialState: "paid", paymentDirection: "inflow", period: "2026-09", currency: "USD", totals: { total: 60 }, treasuryMovement: { transactionClass: "opening-balance", cashAccountFinancialDocumentId: "ifd_cash" } };
const reconciliation = { financialDocumentId: "ifd_rec", documentType: "treasury-reconciliation", financialState: "submitted", period: "2026-09", currency: "USD", treasuryReconciliation: { accountId: "ifd_cash", status: "reconciled", statement: { date: "2026-09-30" }, book: { balance: 60 }, reconciling: { difference: 0 } } };
const journals = [
  { financialDocumentId: "ifd_je_invoice", documentType: "journal-entry", financialState: "posted", status: "posted", period: "2026-09", sourceFinancialDocumentId: "ifd_invoice", lines: [{ accountCode: "1100", debit: 100, credit: 0 }, { accountCode: "4100", debit: 0, credit: 100 }] },
  { financialDocumentId: "ifd_je_bill", documentType: "journal-entry", financialState: "posted", status: "posted", period: "2026-09", sourceFinancialDocumentId: "ifd_bill", lines: [{ accountCode: "6110", debit: 40, credit: 0 }, { accountCode: "2000", debit: 0, credit: 40 }] },
  { financialDocumentId: "ifd_je_opening", documentType: "journal-entry", financialState: "posted", status: "posted", period: "2026-09", sourceFinancialDocumentId: "ifd_opening", lines: [{ accountCode: "1010", debit: 60, credit: 0 }, { accountCode: "4100", debit: 0, credit: 60 }] }
];
const endingTrialBalance = { rows: [
  { accountCode: "1010", control: "cash", balance: 60 },
  { accountCode: "1100", control: "ar", balance: 100 },
  { accountCode: "2000", control: "ap", balance: -40 }
] };

test("close certification reconciles A/R, A/P, Treasury, and bank evidence", () => {
  const result = buildFinancialCloseControls({ documents: [invoice, bill, cashAccount, opening, reconciliation, ...journals], journals, endingTrialBalance, chart, period: "2026-09" });
  assert.equal(result.ready, true);
  assert.equal(result.counts.exceptions, 0);
  assert.equal(result.reconciliations.accountsReceivable.subledger, 100);
  assert.equal(result.reconciliations.accountsPayable.subledger, 40);
  assert.equal(result.reconciliations.treasury.bookCash, 60);
  assert.equal(result.reconciliations.treasury.allAccountsReconciled, true);
});

test("open balances do not block close when subledgers reconcile to GL", () => {
  const result = buildFinancialCloseControls({ documents: [invoice, bill, ...journals.slice(0, 2)], journals: journals.slice(0, 2), endingTrialBalance: { rows: endingTrialBalance.rows.slice(1) }, chart, period: "2026-09" });
  assert.equal(result.reconciliations.accountsReceivable.subledger, 100);
  assert.equal(result.reconciliations.accountsPayable.subledger, 40);
  assert.equal(result.ready, true);
});

test("drafts, unposted economics, suspense, unknown accounts, and reconciliation differences block close", () => {
  const badJournals = [...journals, { financialDocumentId: "ifd_suspense", documentType: "journal-entry", financialState: "posted", status: "posted", period: "2026-09", lines: [{ accountCode: "6990", debit: 5, credit: 0 }, { accountCode: "9999", debit: 0, credit: 5 }] }];
  const result = buildFinancialCloseControls({ documents: [invoice, bill, cashAccount, opening, ...badJournals, { financialDocumentId: "ifd_draft", documentType: "journal-entry", financialState: "draft", status: "draft", period: "2026-09" }, { financialDocumentId: "ifd_unposted", documentType: "invoice", financialState: "billed", period: "2026-09", totals: { total: 25 } }], journals: badJournals, endingTrialBalance: { rows: [{ accountCode: "1010", control: "cash", balance: 50 }, { accountCode: "1100", control: "ar", balance: 100 }, { accountCode: "2000", control: "ap", balance: -40 }] }, chart, period: "2026-09" });
  assert.equal(result.ready, false);
  const codes = result.exceptions.map(item => item.code);
  for (const code of ["UNPOSTED_JOURNAL", "UNPOSTED_ECONOMIC_DOCUMENT", "SUSPENSE_ACTIVITY", "UNCLASSIFIED_GL_ACCOUNT", "AR_SUBLEDGER_GL_DIFFERENCE", "TREASURY_GL_DIFFERENCE", "BANK_RECONCILIATION_REQUIRED"]) assert.equal(codes.includes(code), true, code);
});

test("linked collections and settlements reduce operational subledgers", () => {
  const documents = [invoice, bill,
    { financialDocumentId: "ifd_receipt", documentType: "payment", financialState: "paid", paymentDirection: "inflow", period: "2026-09", sourceFinancialDocumentId: "ifd_invoice", totals: { total: 30 } },
    { financialDocumentId: "ifd_payment", documentType: "payment", financialState: "paid", paymentDirection: "outflow", period: "2026-09", sourceFinancialDocumentId: "ifd_bill", totals: { total: 10 } }
  ];
  const result = buildFinancialCloseControls({ documents, journals: [], endingTrialBalance: { rows: [{ control: "ar", balance: 70 }, { control: "ap", balance: -30 }] }, chart, period: "2026-09" });
  assert.equal(result.reconciliations.accountsReceivable.subledger, 70);
  assert.equal(result.reconciliations.accountsPayable.subledger, 30);
});
