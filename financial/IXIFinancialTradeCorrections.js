"use strict";
const crypto = require("crypto");
const clean = value => String(value ?? "").trim();
const array = value => Array.isArray(value) ? value : [];
const cents = value => Math.round(Number(value || 0) * 100);
const active = document => ["incurred", "approved", "posted", "closed"].includes(document.financialState);
const documentOf = item => item?.financialDocument || item?.record?.financialDocument || item;

function isTradeCredit(document = {}) {
  return document.documentType === "credit" && document.creditType === "trade-credit";
}
function tradeCredits(invoiceId, documents = []) {
  return array(documents).map(documentOf).filter(doc => isTradeCredit(doc) && active(doc) && doc.sourceFinancialDocumentId === invoiceId);
}
function correctionTrades(invoiceId, documents = []) {
  return tradeCredits(invoiceId, documents).map(doc => ({ ...doc.tradeCorrection.trade, tradeCreditId: doc.financialDocumentId }));
}
function collectionPosition(invoice, documents) {
  const related = array(documents).map(documentOf).filter(doc => doc.sourceFinancialDocumentId === invoice.financialDocumentId);
  const receivedCents = related.filter(doc => doc.documentType === "payment" && doc.paymentDirection === "inflow" && ["paid", "posted", "collected", "closed"].includes(doc.financialState)).reduce((sum, doc) => sum + cents(doc.totals?.total), 0);
  const creditedCents = related.filter(doc => doc.documentType === "credit" && active(doc)).reduce((sum, doc) => sum + cents(doc.totals?.total), 0);
  return { invoiceAmount: cents(invoice.totals?.total) / 100, received: receivedCents / 100, credited: creditedCents / 100,
    tradeCredit: tradeCredits(invoice.financialDocumentId, documents).reduce((sum, doc) => sum + cents(doc.totals.total), 0) / 100,
    balance: Math.max(0, cents(invoice.totals?.total) - receivedCents - creditedCents) / 100 };
}
function correctionBlock(invoice, documents = []) {
  if (!["billed", "partially-collected", "collected"].includes(invoice.financialState)) return "Trade corrections require an issued invoice.";
  if (invoice.metadata?.assetSaleRecord?.status === "sold" || invoice.metadata?.assetSale === true) return "This sale is already closed. Reopen its commercial correction workflow before adding a trade.";
  if (documents.map(documentOf).some(doc => doc.documentType === "settlement" && doc.sourceFinancialDocumentId === invoice.financialDocumentId && !["draft", "void", "reversed"].includes(doc.financialState))) return "The existing settlement must be resolved before adding a trade.";
  return "";
}

function planTradeCorrection({ order, invoice, documents, body, accessContext, verifyTrades = require("../mos/onboarding/tradeMachineService").verifiedOrderTrades }) {
  const { normalizeSalesTrades } = require("./IXIFinancialTradeContract");
  const trade = body.trade || {};
  const amount = Number(trade.allowance);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(cents(amount)) || Math.abs(amount * 100 - cents(amount)) > 0.000001) throw new Error("Enter a positive trade allowance with at most two decimal places.");
  const candidate = normalizeSalesTrades({ ...order, trades: [trade] });
  verifyTrades(candidate);
  const effectiveDate = clean(body.effectiveDate), reason = clean(body.reason);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || !Number.isFinite(Date.parse(effectiveDate)) || new Date(effectiveDate).toISOString().slice(0, 10) !== effectiveDate || effectiveDate < clean(invoice.occurredAt).slice(0, 10)) throw new Error("Enter a valid credit date on or after the invoice date.");
  if (reason.length < 3) throw new Error("Enter the reason for adding this trade to the issued invoice.");
  const entityPassportId = accessContext.entityPassportId;
  const identity = crypto.createHash("sha256").update(JSON.stringify([entityPassportId, invoice.financialDocumentId, trade.passportId])).digest("hex").slice(0, 24);
  const financialDocumentId = `ifd_trade_credit_${identity}`;
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify([order.identity.salesOrderId, trade, effectiveDate, reason])).digest("hex");
  const prior = documents.map(documentOf).find(doc => doc.financialDocumentId === financialDocumentId);
  if (prior) {
    if (!isTradeCredit(prior) || prior.tradeCorrection?.fingerprint !== fingerprint || !active(prior)) throw new Error("This machine already has a different trade correction on this invoice. Open the saved trade instead of adding it again.");
    return { replay: prior };
  }
  const blocked = correctionBlock(invoice, documents);
  if (blocked) throw new Error(blocked);
  if ([...array(order.trades), ...array(invoice.metadata?.trades), ...correctionTrades(invoice.financialDocumentId, documents)].some(row => row.passportId === trade.passportId || row.tradeId === trade.tradeId)) throw new Error("This machine is already included in this deal's trade allowance.");
  const position = collectionPosition(invoice, documents);
  if (cents(amount) > cents(position.balance)) throw new Error("The trade allowance exceeds the invoice's remaining balance. Resolve any overpayment separately.");
  const document = require("./IXIFinancialCreditFactory").createCostCreditDocument({ financialDocumentId,
    documentNumber: `TC-${identity.slice(-8).toUpperCase()}`, amount, currency: invoice.currency, occurredAt: effectiveDate,
    description: `Trade allowance · ${trade.year} ${trade.make} ${trade.model} · ${invoice.documentNumber || invoice.financialDocumentId}`,
    reasonCode: "omitted-trade", sourceFinancialDocumentId: invoice.financialDocumentId, recordedByPassportId: accessContext.actorPassportId,
    references: [...array(invoice.references), { passportId: trade.passportId, role: "trade-in", objectType: "machine" }],
    metadata: { transactModule: "equipment-sale", arCredit: true, tradeCredit: true, dealId: order.identity.dealId,
      salesOrderId: order.identity.salesOrderId, tradeContext: order.context, reason,
      saleBalanceControl: { sourceId: invoice.financialDocumentId, kind: "credit", limitCents: cents(invoice.totals.total) - cents(position.received), baselineCents: cents(position.credited) } } });
  document.creditType = "trade-credit";
  document.creditSide = "trade";
  document.tradeCorrection = { schema: "ixi.trade-correction.v1", trade: candidate.trades[0], salesOrderId: order.identity.salesOrderId,
    invoiceId: invoice.financialDocumentId, dealId: order.identity.dealId, entityPassportId, effectiveDate, reason, fingerprint,
    actorPassportId: accessContext.actorPassportId, recordedAt: new Date().toISOString() };
  return { document, commandId: `trade-credit:${identity}`, idempotencyKey: `trade-credit:${identity}` };
}
module.exports = { isTradeCredit, tradeCredits, correctionTrades, collectionPosition, correctionBlock, planTradeCorrection };
