"use strict";

/*
 * Server-derived accounting close certification.
 *
 * This engine consumes canonical Entity Financial Documents and posted GL
 * journals. It never trusts balances or exceptions supplied by a browser.
 */

const clean = value => String(value ?? "").trim();
const array = value => Array.isArray(value) ? value : [];
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const money = value => Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
const amount = document => money(document?.totals?.total ?? document?.totals?.subtotal);
const documentPeriod = document => clean(document?.period || document?.occurredAt || document?.documentDate).slice(0, 7);
const throughPeriod = (document, period) => !period || (documentPeriod(document) && documentPeriod(document) <= period);
const activeState = document => !["void", "reversed", "rejected", "cancelled", "canceled"].includes(clean(document?.financialState).toLowerCase());

function accountBalance(trialBalance = {}, control = "") {
  return money(array(trialBalance.rows)
    .filter(row => clean(row.control).toLowerCase() === control)
    .reduce((total, row) => total + Number(row.balance || 0), 0));
}

function economicDocument(document = {}) {
  const source = object(document);
  const type = clean(source.documentType).toLowerCase();
  const state = clean(source.financialState).toLowerCase();
  if (!activeState(source) || ["journal-entry", "period-close", "period-reopen", "posting-rule", "payables-control", "collection", "settlement", "treasury-account", "treasury-reconciliation", "purchase-order", "service-quote", "quote", "work-order", "time-entry"].includes(type)) return false;
  if (source?.accountingTreatment?.economicEvent === false) return false;
  if (source?.accountingTreatment?.economicEvent === true) return true;
  if (["invoice", "payment", "credit"].includes(type)) return !["draft", "submitted"].includes(state);
  return amount(source) !== 0;
}

function operationalBalance({ documents = [], sourceTypes = [], paymentDirection = "", creditTypes = [] } = {}) {
  const sources = array(documents).filter(document => sourceTypes.includes(clean(document.documentType).toLowerCase()) && activeState(document));
  const sourceIds = new Set(sources.map(document => clean(document.financialDocumentId)).filter(Boolean));
  const gross = money(sources.reduce((total, document) => total + Math.abs(amount(document)), 0));
  const settlements = money(array(documents).filter(document => {
    const type = clean(document.documentType).toLowerCase();
    return type === "payment" && activeState(document) && clean(document.paymentDirection).toLowerCase() === paymentDirection && sourceIds.has(clean(document.sourceFinancialDocumentId));
  }).reduce((total, document) => total + Math.abs(amount(document)), 0));
  const credits = money(array(documents).filter(document => creditTypes.includes(clean(document.documentType).toLowerCase()) && activeState(document) && sourceIds.has(clean(document.sourceFinancialDocumentId))).reduce((total, document) => total + Math.abs(amount(document)), 0));
  return { gross, settlements, credits, open: money(Math.max(0, gross - settlements - credits)), sourceCount: sources.length };
}

function treasuryControl(documents = [], endingTrialBalance = {}, period = "") {
  const accounts = array(documents).filter(document => clean(document.documentType).toLowerCase() === "treasury-account" && document?.treasuryAccount?.account?.active !== false);
  const bookByAccount = new Map(accounts.map(document => [clean(document.financialDocumentId), 0]));
  array(documents).filter(document => clean(document.documentType).toLowerCase() === "payment" && activeState(document) && clean(document?.treasuryMovement?.transactionClass)).forEach(document => {
    const movement = object(document.treasuryMovement);
    const value = Math.abs(amount(document));
    if (clean(movement.transactionClass).toLowerCase() === "account-transfer") {
      const from = clean(movement.fromCashAccountFinancialDocumentId), to = clean(movement.toCashAccountFinancialDocumentId);
      bookByAccount.set(from, money((bookByAccount.get(from) || 0) - value));
      bookByAccount.set(to, money((bookByAccount.get(to) || 0) + value));
    } else {
      const accountId = clean(movement.cashAccountFinancialDocumentId);
      const direction = clean(document.paymentDirection).toLowerCase();
      bookByAccount.set(accountId, money((bookByAccount.get(accountId) || 0) + (direction === "inflow" ? value : -value)));
    }
  });
  const reconciliations = array(documents).filter(document => clean(document.documentType).toLowerCase() === "treasury-reconciliation" && activeState(document));
  const accountEvidence = accounts.map(account => {
    const accountId = clean(account.financialDocumentId);
    const latest = reconciliations.filter(document => clean(document?.treasuryReconciliation?.accountId) === accountId)
      .sort((a, b) => clean(b?.treasuryReconciliation?.statement?.date || b.occurredAt).localeCompare(clean(a?.treasuryReconciliation?.statement?.date || a.occurredAt)))[0] || null;
    const book = money(bookByAccount.get(accountId) || 0);
    const reconciledBook = money(latest?.treasuryReconciliation?.book?.balance);
    const difference = money(latest?.treasuryReconciliation?.reconciling?.difference);
    const status = clean(latest?.treasuryReconciliation?.status).toLowerCase();
    return { accountId, accountName: clean(account?.treasuryAccount?.account?.name), bookBalance: book, reconciliationDocumentId: clean(latest?.financialDocumentId), statementDate: clean(latest?.treasuryReconciliation?.statement?.date), reconciledBookBalance: reconciledBook, difference, reconciled: Boolean(latest) && status === "reconciled" && Math.abs(difference) < 0.005 && reconciledBook === book };
  });
  const bookCash = money([...bookByAccount.values()].reduce((total, value) => total + Number(value || 0), 0));
  const glCash = accountBalance(endingTrialBalance, "cash");
  return { accountCount: accounts.length, bookCash, glCash, difference: money(glCash - bookCash), accounts: accountEvidence, allAccountsReconciled: accountEvidence.every(item => item.reconciled), balancedToGL: money(glCash - bookCash) === 0, period };
}

function buildFinancialCloseControls({ documents = [], journals = [], endingTrialBalance = {}, chart = [], period = "" } = {}) {
  const population = array(documents).filter(document => throughPeriod(document, period));
  const periodPopulation = population.filter(document => documentPeriod(document) === period);
  const postedSourceIds = new Set(array(journals).map(journal => clean(journal.sourceFinancialDocumentId)).filter(Boolean));
  const draftJournals = periodPopulation.filter(document => clean(document.documentType).toLowerCase() === "journal-entry" && clean(document.financialState).toLowerCase() !== "posted" && activeState(document));
  const unpostedEconomicDocuments = periodPopulation.filter(document => economicDocument(document) && !postedSourceIds.has(clean(document.financialDocumentId)));
  const chartMap = new Map(array(chart).map(account => [clean(account.code), account]));
  const unclassifiedLines = array(journals).flatMap(journal => array(journal.lines).filter(line => !chartMap.has(clean(line.accountCode))).map(line => ({ journalEntryId: clean(journal.financialDocumentId), accountCode: clean(line.accountCode) })));
  const suspenseLines = array(journals).flatMap(journal => array(journal.lines).filter(line => clean(chartMap.get(clean(line.accountCode))?.control).toLowerCase() === "suspense" && money(Number(line.debit || 0) - Number(line.credit || 0)) !== 0).map(line => ({ journalEntryId: clean(journal.financialDocumentId), accountCode: clean(line.accountCode), amount: money(Number(line.debit || 0) - Number(line.credit || 0)) })));
  const ar = operationalBalance({ documents: population, sourceTypes: ["invoice"], paymentDirection: "inflow" });
  const ap = operationalBalance({ documents: population.filter(document => !["bill", "supplier-invoice"].includes(clean(document.documentType).toLowerCase()) || document?.accountingTreatment?.createsPayable === true), sourceTypes: ["bill", "supplier-invoice"], paymentDirection: "outflow", creditTypes: ["credit"] });
  const arGl = accountBalance(endingTrialBalance, "ar");
  const apGl = money(-accountBalance(endingTrialBalance, "ap"));
  const treasury = treasuryControl(population, endingTrialBalance, period);
  const reconciliations = {
    accountsReceivable: { subledger: ar.open, generalLedger: arGl, difference: money(arGl - ar.open), balanced: money(arGl - ar.open) === 0, ...ar },
    accountsPayable: { subledger: ap.open, generalLedger: apGl, difference: money(apGl - ap.open), balanced: money(apGl - ap.open) === 0, ...ap },
    treasury
  };
  const exceptions = [
    ...draftJournals.map(document => ({ code: "UNPOSTED_JOURNAL", financialDocumentId: clean(document.financialDocumentId) })),
    ...unpostedEconomicDocuments.map(document => ({ code: "UNPOSTED_ECONOMIC_DOCUMENT", financialDocumentId: clean(document.financialDocumentId), documentType: clean(document.documentType) })),
    ...unclassifiedLines.map(item => ({ code: "UNCLASSIFIED_GL_ACCOUNT", ...item })),
    ...suspenseLines.map(item => ({ code: "SUSPENSE_ACTIVITY", ...item })),
    ...(reconciliations.accountsReceivable.balanced ? [] : [{ code: "AR_SUBLEDGER_GL_DIFFERENCE", amount: reconciliations.accountsReceivable.difference }]),
    ...(reconciliations.accountsPayable.balanced ? [] : [{ code: "AP_SUBLEDGER_GL_DIFFERENCE", amount: reconciliations.accountsPayable.difference }]),
    ...(treasury.balancedToGL ? [] : [{ code: "TREASURY_GL_DIFFERENCE", amount: treasury.difference }]),
    ...(treasury.allAccountsReconciled ? [] : treasury.accounts.filter(item => !item.reconciled).map(item => ({ code: "BANK_RECONCILIATION_REQUIRED", accountId: item.accountId })))
  ];
  return {
    schema: "ixi-financial-close-controls-v1",
    period,
    browserCalculated: false,
    counts: { draftJournals: draftJournals.length, unpostedEconomicDocuments: unpostedEconomicDocuments.length, unclassifiedLines: unclassifiedLines.length, suspenseLines: suspenseLines.length, exceptions: exceptions.length },
    reconciliations,
    exceptions,
    ready: exceptions.length === 0
  };
}

module.exports = { buildFinancialCloseControls };
