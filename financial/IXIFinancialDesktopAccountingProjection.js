"use strict";

const array = value => Array.isArray(value) ? value : [];
const clean = value => String(value ?? "").trim();

// These are aliases over the posted GL and its server close certification.
// Operational inflow is never presented as recognized revenue or net income.
function createDesktopAccountingProjection({ projection = {}, documents = [] } = {}) {
  const pnl = projection.profitAndLoss || {};
  const balance = projection.balanceSheet || {};
  const certification = projection.controls?.closeCertification || {};
  const reconciliations = certification.reconciliations || {};
  const byType = types => array(documents).filter(document => types.includes(clean(document.documentType)));
  return {
    executive: {
      revenue: pnl.revenue ?? null,
      netIncome: pnl.netIncome ?? null,
      cash: reconciliations.treasury?.glCash ?? null,
      openAr: reconciliations.accountsReceivable?.open ?? null,
      openAp: reconciliations.accountsPayable?.open ?? null,
      assets: balance.assets ?? null,
      liabilities: balance.liabilities ?? null,
      equity: balance.equity ?? null,
      closeReadiness: projection.controls?.ready === true ? "READY" : "REVIEW REQUIRED"
    },
    ar: { records: byType(["invoice", "collection"]) },
    ap: { records: byType(["bill", "supplier-invoice", "expense"]) },
    treasury: { accounts: byType(["treasury-account"]), reconciliation: reconciliations.treasury || {} },
    gl: { journals: array(projection.journal), exceptions: array(certification.exceptions), close: certification },
    reports: {
      profitAndLoss: { title: "PROFIT & LOSS", data: pnl },
      balanceSheet: { title: "BALANCE SHEET", data: balance },
      trialBalance: { title: "TRIAL BALANCE", data: projection.endingTrialBalance || {} },
      closeReview: { title: "ACCOUNTING REVIEW", data: certification }
    },
    accountingBasis: "posted-general-ledger",
    accountingPeriod: projection.period,
    accountingGeneratedAt: projection.generatedAt
  };
}

module.exports = { createDesktopAccountingProjection };
