"use strict";

const clean = value => String(value ?? "").trim();
const cents = value => Math.round(Number(value || 0) * 100);
const document = record => record?.financialDocument || record || {};
const amount = doc => cents(doc?.totals?.total ?? doc?.billRecord?.bill?.amount ?? doc?.amount);

// Read model only: the canonical financial revision is the source of amounts.
// A request stores a link, never a second editable accounting balance.
function projectFreightFinancials(order, records = [], entityPassportId = "") {
  const orderId = clean(order?.identity?.freightOrderId);
  const legacy = new Map((order.invoices || []).map(item => [clean(item.billDocumentId), item]));
  const scoped = records.filter(record => {
    const doc = document(record);
    const entity = clean(record?.server?.entityPassportId || doc?.billRecord?.context?.entityPassportId);
    return entity === clean(entityPassportId) || (!entity && (doc.references || []).some(ref => ref.role === "entity" && clean(ref.passportId) === clean(entityPassportId)));
  });
  const unique = [...new Map(scoped.map(record => [clean(document(record).financialDocumentId), record])).values()];
  const bills = unique.filter(record => {
    const doc = document(record);
    return ["bill", "supplier-invoice"].includes(doc.documentType) &&
      (clean(doc?.metadata?.freightOrderId) === orderId || legacy.has(clean(doc.financialDocumentId)));
  });
  const billIds = new Set(bills.map(record => clean(document(record).financialDocumentId)));
  const linked = unique.filter(record => billIds.has(clean(document(record).financialDocumentId)) ||
    (["credit", "payment"].includes(document(record).documentType) && billIds.has(clean(document(record).sourceFinancialDocumentId))));
  const active = linked.map(document).filter(doc => !["void", "reversed", "cancelled"].includes(clean(doc.financialState)));
  const sum = predicate => active.filter(predicate).reduce((total, doc) => total + amount(doc), 0);
  const billed = sum(doc => ["bill", "supplier-invoice"].includes(doc.documentType));
  const credited = sum(doc => doc.documentType === "credit");
  const paid = sum(doc => doc.documentType === "payment" && doc.paymentDirection === "outflow");
  const net = billed - credited;
  const invoices = linked.map(document).filter(doc => doc.documentType !== "payment").map(doc => ({
    ...(legacy.get(clean(doc.financialDocumentId)) || {}),
    invoiceId: doc.financialDocumentId, billDocumentId: doc.financialDocumentId,
    sourceBillDocumentId: clean(doc.sourceFinancialDocumentId),
    documentType: doc.documentType === "credit" ? "carrier-credit" : "carrier-invoice",
    invoiceNumber: clean(doc.invoiceNumber || doc.documentNumber),
    invoiceDate: clean(doc.occurredAt).slice(0, 10),
    amount: amount(doc) / 100, status: clean(doc.financialState)
  }));
  const missingFinancialDocumentIds = [...legacy.keys()].filter(id => !unique.some(record => clean(document(record).financialDocumentId) === id));
  return {
    ...order, invoices, financialRecords: linked,
    economics: { ...order.economics, actualTotal: net / 100 },
    financial: { ...order.financial, source: "canonical-financial-documents", invoicedTotal: billed / 100, creditTotal: credited / 100,
      paidTotal: paid / 100, openPayableTotal: Math.max(0, net - paid) / 100, carrierCreditTotal: Math.max(0, paid - net) / 100,
      missingFinancialDocumentIds }
  };
}

module.exports = { projectFreightFinancials };
