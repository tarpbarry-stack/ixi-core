"use strict";

// Inventory is a projection of recorded business events. This module never
// creates Objects, Passports, relationships, payments, or workspace placement.
const clean = value => String(value ?? "").trim();
const array = value => Array.isArray(value) ? value : [];
const inactive = new Set(["draft", "submitted", "rejected", "void", "voided", "reversed", "cancelled"]);
const cents = value => value != null && value !== "" && Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : null;
const money = value => cents(value) === null ? null : cents(value) / 100;
const date = value => clean(value).slice(0, 10);

function documentOf(record = {}) {
  return record.financialDocument || record.record?.financialDocument || record.document?.financialDocument || record.document || record;
}

function entityOf(record = {}) {
  const doc = documentOf(record);
  return clean(record.server?.entityPassportId || record.record?.server?.entityPassportId ||
    array(doc.references).find(ref => ref.role === "entity")?.passportId ||
    doc.metadata?.assetSaleRecord?.context?.entityPassportId);
}

function assetOf(record = {}) {
  const doc = documentOf(record);
  return clean(array(doc.references).find(ref => ["asset", "machine", "equipment"].includes(ref.role))?.passportId ||
    doc.metadata?.assetSaleRecord?.context?.assetPassportId);
}

function totalOf(doc = {}) {
  if (doc.totals?.total != null || doc.amount != null) return money(doc.totals?.total ?? doc.amount);
  return money(array(doc.lines).reduce((sum, line) => sum + Number(line.amount || 0), 0));
}

// Current closeouts store a machine-specific price. Earlier closeouts already
// recorded it as the source invoice's commercial subtotal. Resolve that existing
// fact only for a single matching machine and a reconciled commercial breakdown.
function resolveMachineSalePrice(doc = {}, sale = {}, passportId = "") {
  const explicit = money(sale.sale?.machineSalePrice);
  if (explicit !== null && explicit >= 0) return { amount: explicit, source: "sold-record" };
  const assetRoles = new Set(["asset", "machine", "equipment"]);
  const assetIds = new Set([
    ...array(doc.references),
    ...array(doc.lines).flatMap(line => array(line.references))
  ].filter(ref => assetRoles.has(ref.role)).map(ref => clean(ref.passportId)).filter(Boolean));
  const saleAsset = clean(sale.context?.assetPassportId);
  if (!passportId || assetIds.size !== 1 || !assetIds.has(passportId) || (saleAsset && saleAsset !== passportId)) {
    return { amount: null, source: "" };
  }
  const breakdown = doc.metadata?.commercialBreakdown;
  const fields = ["subtotal", "tax", "freight", "fees", "tradeAllowance", "total"];
  const values = fields.map(field => cents(breakdown?.[field]));
  if (values.some(value => value === null || value < 0)) return { amount: null, source: "" };
  const [subtotal, tax, freight, fees, tradeAllowance, total] = values;
  if (subtotal + tax + freight + fees - tradeAllowance !== total || cents(totalOf(doc)) !== total) {
    return { amount: null, source: "" };
  }
  return { amount: subtotal / 100, source: "invoice-commercial-subtotal" };
}

function isRevenueCredit(doc = {}) {
  return doc.documentType === "credit" && doc.creditType === "revenue-credit";
}

function isCustomerRefund(doc = {}) {
  return doc.documentType === "payment" && doc.paymentDirection === "outflow" && doc.metadata?.customerRefund === true;
}

function isActive(doc = {}) {
  return !inactive.has(clean(doc.financialState || doc.status).toLowerCase());
}

// Older closeout forms defaulted to the entry day. Recover the business date
// only when the original invoice and fully collected canonical receipts agree.
// Explicit operator dates and the original audit record remain untouched.
function resolveSoldBusinessDate(invoice = {}, documents = []) {
  const sale = invoice.metadata?.assetSaleRecord || {};
  const stored = date(sale.sale?.saleDate);
  const fallback = { date: stored, source: clean(sale.sale?.saleDateSource) || "sold-record" };
  const invoiceDate = date(invoice.occurredAt);
  const valid = day => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
  if (sale.sale?.saleDateSource || !valid(stored) || !valid(invoiceDate) || invoiceDate >= stored ||
      stored !== date(sale.audit?.closedAt) || !entityOf(invoice) || !clean(invoice.currency)) return fallback;
  const invoiceCents = cents(totalOf(invoice));
  if (!(invoiceCents > 0)) return fallback;
  const receipts = new Map();
  for (const record of array(documents)) {
    const doc = documentOf(record);
    if (clean(doc.sourceFinancialDocumentId) !== clean(invoice.financialDocumentId) ||
        !clean(doc.financialDocumentId) || entityOf(record) !== entityOf(invoice) ||
        clean(doc.currency) !== clean(invoice.currency) || doc.documentType !== "payment" ||
        doc.paymentDirection !== "inflow" || !["paid", "posted", "collected", "closed"].includes(doc.financialState) ||
        !valid(date(doc.occurredAt)) || date(doc.occurredAt) > invoiceDate || !(cents(totalOf(doc)) > 0)) continue;
    receipts.set(doc.financialDocumentId, doc);
  }
  const received = [...receipts.values()];
  const receivedCents = received.reduce((sum, doc) => sum + cents(totalOf(doc)), 0);
  const lastReceiptDate = received.map(doc => date(doc.occurredAt)).sort().at(-1);
  return receivedCents >= invoiceCents && lastReceiptDate === invoiceDate
    ? { date: invoiceDate, source: "invoice-and-collection" } : fallback;
}

function projectInventory({ records = [], entityPassportId = "" } = {}) {
  const entity = clean(entityPassportId);
  if (!entity) throw new Error("Inventory requires an authenticated Entity Passport.");
  const scoped = array(records).filter(record => entityOf(record) === entity);
  const documents = scoped.map(documentOf);
  const bySource = new Map();
  documents.forEach(doc => {
    const source = clean(doc.sourceFinancialDocumentId);
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source).push(doc);
  });
  const sales = [], issues = [], events = new Map(), holds = new Map();
  const addEvent = (passportId, event) => {
    if (!passportId || !event.effectiveDate) return;
    if (!events.has(passportId)) events.set(passportId, []);
    events.get(passportId).push(event);
  };
  for (const doc of documents) {
    if (!isActive(doc)) continue;
    const passportId = assetOf(doc);
    if (doc.documentType === "asset-acquisition") {
      addEvent(passportId, { state: "owned", effectiveDate: date(doc.occurredAt),
        sequence: Number(doc.metadata?.inventoryMutation?.sequence || 0), recordedAt: clean(doc.createdAt || doc.occurredAt), documentId: doc.financialDocumentId, kind: "acquisition" });
      continue;
    }
    const sale = doc.metadata?.assetSaleRecord;
    if (doc.documentType !== "invoice" || sale?.status !== "sold" || doc.metadata?.assetSale !== true) continue;
    const saleId = clean(doc.financialDocumentId);
    const businessDate = resolveSoldBusinessDate(doc, documents);
    const effectiveDate = businessDate.date;
    if (!passportId || !effectiveDate || !saleId || clean(sale.identity?.financialInvoiceId || sale.identity?.saleId) !== saleId) {
      issues.push({ documentId: saleId, passportId, code: "INCOMPLETE_SALE_IDENTITY", message: "The recorded sale needs its machine, invoice lineage, and original sale date reconciled." });
      if (passportId) holds.set(passportId, { state: "sold", documentId: saleId, reconciliationRequired: true });
      continue;
    }
    const related = (bySource.get(saleId) || []).filter(isActive);
    const receipts = related.filter(item => item.documentType === "payment" && item.paymentDirection === "inflow" &&
      ["paid", "posted", "collected", "closed"].includes(item.financialState));
    const receivedCents = receipts.reduce((sum, item) => sum + (cents(totalOf(item)) || 0), 0);
    const correctedTrades = require("./IXIFinancialTradeCorrections").tradeCredits(saleId, related);
    const correctedTradeCents = correctedTrades.reduce((sum, item) => sum + (cents(totalOf(item)) || 0), 0);
    const legacyCredits = related.filter(item => item.documentType === "credit" && !isRevenueCredit(item) && !require("./IXIFinancialTradeCorrections").isTradeCredit(item));
    const credits = related.filter(isRevenueCredit);
    const creditCents = credits.reduce((sum, item) => sum + (cents(totalOf(item)) || 0), 0);
    const refunds = credits.flatMap(credit => (bySource.get(credit.financialDocumentId) || []).filter(item => isActive(item) && isCustomerRefund(item)));
    const refundedCents = refunds.reduce((sum, item) => sum + (cents(totalOf(item)) || 0), 0);
    const customerTotal = totalOf(doc);
    const lifecycle = array(doc.metadata?.inventoryLifecycle?.events);
    const returns = lifecycle.filter(event => event.type === "return-to-private");
    const returned = returns[returns.length - 1];
    const settlements = related.filter(item => item.documentType === "settlement");
    const settlement = settlements.sort((a, b) => clean(a.updatedAt || a.occurredAt).localeCompare(clean(b.updatedAt || b.occurredAt))).at(-1);
    const settlementClosed = ["closed", "settled"].includes(clean(settlement?.assetSettlement?.status || settlement?.financialState));
    const machinePrice = resolveMachineSalePrice(doc, sale, passportId);
    const recordedSalePrice = machinePrice.amount;
    const summary = {
      saleId, passportId, entityPassportId: entity,
      objectId: clean(sale.context?.assetObjectId),
      listingId: clean(sale.context?.assetListingId),
      label: clean(sale.context?.assetLabel),
      saleDate: effectiveDate, saleDateSource: businessDate.source, recordedSaleDate: date(sale.sale?.saleDate),
      salePrice: recordedSalePrice, salePriceSource: machinePrice.source,
      customerTotal, currency: clean(doc.currency || sale.sale?.currency || "USD"),
      buyerLabel: clean(sale.sale?.buyerLabel), buyerPassportId: clean(sale.sale?.buyerPassportId),
      soldByLabel: clean(sale.sale?.soldByLabel), soldByPassportId: clean(sale.sale?.soldByPassportId),
      recordedByPassportId: clean(sale.audit?.createdBy || sale.context?.actorPassportId),
      recordedByLabel: clean(sale.audit?.createdByLabel || sale.context?.actorLabel),
      recordedAt: clean(sale.audit?.closedAt || doc.metadata?.soldAt || doc.occurredAt),
      amountReceived: receivedCents / 100, creditedAmount: creditCents / 100,
      tradeCreditAmount: correctedTradeCents / 100,
      refundedAmount: refundedCents / 100, refundDue: Math.max(0, Math.min(receivedCents, creditCents) - refundedCents) / 100,
      settlementStatus: settlementClosed && !returned && Math.round(Number(settlement?.assetSettlement?.projection?.credited || 0) * 100) === creditCents && Math.round(Number(settlement?.assetSettlement?.projection?.refunded || 0) * 100) === refundedCents ? "closed" : "open",
      settlementId: clean(settlement?.financialDocumentId),
      returnStatus: returned ? "returned" : credits.some(credit => credit.assetSaleAdjustment?.kind === "return") ? "return-pending" : "none",
      returnedAt: date(returned?.effectiveDate),
      status: returned ? "returned" : "sold",
      invoiceNumber: clean(doc.documentNumber || sale.sale?.invoiceNumber),
      originalInvoiceId: saleId,
    };
    sales.push(summary);
    // A questionable historical closeout stays excluded from available stock;
    // it is reported for reconciliation instead of being silently put back.
    // Itemized all-trade SOLD writes verify the incoming acquisitions at closeout.
    // Their recorded noncash consideration must not be presented as missing cash.
    const tradeCents = array(doc.metadata?.trades).reduce((sum, trade) => sum + (cents(trade.allowance) || 0), 0) + correctedTradeCents;
    const fullyTraded = cents(customerTotal) === correctedTradeCents && tradeCents > 0 && cents(sale.collection?.tradeValue) === tradeCents;
    if ((receivedCents <= 0 && !fullyTraded) || legacyCredits.length) issues.push({ documentId: saleId, passportId,
      code: "COLLECTION_RECONCILIATION_REQUIRED", message: "Check receipts and legacy credits for this recorded sale." });
    if (!summary.soldByLabel) issues.push({ documentId: saleId, passportId, code: "SALESPERSON_NOT_RECORDED", message: "The historical salesperson has not been recorded." });
    if (recordedSalePrice === null) issues.push({ documentId: saleId, passportId, code: "MACHINE_SALE_PRICE_NOT_RECORDED", message: "Verify the historical machine sale price separately from the invoice total." });
    addEvent(passportId, { state: "sold", effectiveDate, sequence: Number(doc.metadata?.inventoryMutation?.sequence || 1), recordedAt: summary.recordedAt, documentId: saleId, kind: "sale" });
    if (returned) addEvent(passportId, { state: "owned", effectiveDate: date(returned.effectiveDate),
      sequence: Number(returned.sequence || 2), recordedAt: clean(returned.recordedAt), documentId: saleId, kind: "return", forcePrivate: true });
  }
  const current = {};
  for (const [passportId, history] of events) {
    const priority = { acquisition: 1, sale: 2, return: 3 };
    history.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) ||
      Number(a.sequence || 0) - Number(b.sequence || 0) || priority[a.kind] - priority[b.kind] || a.recordedAt.localeCompare(b.recordedAt) || clean(a.documentId).localeCompare(clean(b.documentId)));
    const last = history.at(-1);
    current[passportId] = { ...last, passportId, entityPassportId: entity };
  }
  // Incomplete recorded sales cannot silently reappear as available stock.
  for (const [passportId, hold] of holds) current[passportId] = { ...hold, passportId, entityPassportId: entity };
  sales.sort((a, b) => b.saleDate.localeCompare(a.saleDate) || b.recordedAt.localeCompare(a.recordedAt) || a.saleId.localeCompare(b.saleId));
  return { schema: "ixi.inventory-lifecycle.v1", entityPassportId: entity, sales, current, issues };
}

function querySoldInventory(projection, query = {}) {
  const text = clean(query.q).toLowerCase();
  const from = date(query.from), to = date(query.to);
  let sales = projection.sales.filter(sale =>
    (!text || [sale.label, sale.passportId, sale.invoiceNumber, sale.buyerLabel, sale.soldByLabel].some(value => clean(value).toLowerCase().includes(text))) &&
    (!from || sale.saleDate >= from) && (!to || sale.saleDate <= to) &&
    (!query.settlement || query.settlement === "all" || sale.settlementStatus === query.settlement) &&
    (!query.status || query.status === "all" || sale.status === query.status));
  const sort = clean(query.sort || "date-desc");
  sales.sort((a, b) => {
    let comparison;
    if (sort.startsWith("price")) comparison = (a.salePrice ?? -Infinity) - (b.salePrice ?? -Infinity);
    else if (sort.startsWith("buyer")) comparison = a.buyerLabel.localeCompare(b.buyerLabel);
    else if (sort.startsWith("seller")) comparison = a.soldByLabel.localeCompare(b.soldByLabel);
    else if (sort.startsWith("machine")) comparison = a.label.localeCompare(b.label);
    else comparison = a.saleDate.localeCompare(b.saleDate);
    return (sort.endsWith("-desc") ? -comparison : comparison) || a.saleId.localeCompare(b.saleId);
  });
  const total = sales.length, pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize, 10) || 24));
  const page = Math.min(Math.max(1, Math.ceil(total / pageSize)), Math.max(1, Number.parseInt(query.page, 10) || 1));
  return { ...projection, sales: sales.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize };
}

module.exports = { documentOf, entityOf, assetOf, totalOf, isActive, isRevenueCredit, isCustomerRefund, resolveSoldBusinessDate, projectInventory, querySoldInventory };
