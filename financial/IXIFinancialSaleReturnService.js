"use strict";

const crypto = require("node:crypto");
const provider = require("./IXIFinancialProviderService");
const { createCostCreditDocument } = require("./IXIFinancialCreditFactory");
const { createPaymentDocument } = require("./IXIFinancialPaymentFactory");
const { documentOf, entityOf, totalOf, isActive, isRevenueCredit, isCustomerRefund, resolveSoldBusinessDate } = require("./IXIFinancialInventoryLifecycle");
const clean = value => String(value ?? "").trim();
const array = value => Array.isArray(value) ? value : [];
const cents = value => Math.round(Number(value) * 100);
const fail = (message, status = 409) => Object.assign(new Error(message), { status });

function businessDate(value) {
  const day = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) {
    throw fail("Enter a valid original transaction date.");
  }
  return day;
}

function commandIdentity(body = {}) {
  const commandId = clean(body.commandId);
  if (!/^[a-zA-Z0-9:_.-]{8,160}$/.test(commandId)) throw fail("A stable command ID is required. Retry the existing action.");
  return { commandId, idempotencyKey: `sale-return:${commandId}` };
}

async function readSale({ saleId, accessContext, service = provider }) {
  const result = await service.getDocument({ financialDocumentId: clean(saleId) });
  if (!result?.ok) throw fail("The original sale could not be loaded.");
  const record = result.data?.record;
  const invoice = documentOf(record);
  if (entityOf(record) !== clean(accessContext.entityPassportId)) throw fail("This sale is outside your company.", 403);
  if (invoice.documentType !== "invoice" || invoice.metadata?.assetSale !== true || invoice.metadata?.assetSaleRecord?.status !== "sold") {
    throw fail("Select a completed machine sale.");
  }
  const listed = await service.listDocumentsByPassport({ passportId: accessContext.entityPassportId });
  if (!listed?.ok) throw fail("Sale adjustments and refunds could not be verified.");
  const documents = array(listed.data?.documents).filter(item => entityOf(item) === clean(accessContext.entityPassportId)).map(documentOf);
  return { record, invoice, documents };
}

function priorCommand(documents, commandId, action) {
  return documents.find(doc => doc.metadata?.saleLifecycleCommandId === commandId && doc.metadata?.saleLifecycleAction === action);
}

function fingerprint(body) {
  return crypto.createHash("sha256").update(JSON.stringify(Object.entries(body).filter(([key]) => !["expectedRevision", "commandId"].includes(key)).sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
}
function checkedReplay(record, body) {
  const recorded = record.metadata?.saleLifecycleFingerprint || record.fingerprint;
  if (recorded !== fingerprint(body)) throw fail("This command was already used with different details. Open the saved record before starting a correction.");
  return { replay: record };
}

function planAdjustment({ invoice, documents, body, accessContext }) {
  const identity = commandIdentity(body);
  const replay = priorCommand(documents, identity.commandId, "adjustment");
  if (replay) { if ((replay.metadata?.saleId || replay.sourceFinancialDocumentId) !== invoice.financialDocumentId) throw fail("This command already belongs to a different sale."); return checkedReplay(replay, body); }
  const kind = clean(body.kind);
  if (!["price-adjustment", "return"].includes(kind)) throw fail("Choose a price adjustment or a machine return.");
  if (kind === "return" && (array(invoice.metadata?.trades).length || require("./IXIFinancialTradeCorrections").tradeCredits(invoice.financialDocumentId, documents).length)) throw fail("This sale includes trade-in machines. A full return must account for those machines and their acquisition reversals; the cash-only return action cannot close this deal.");
  const effectiveDate = businessDate(body.effectiveDate);
  if (effectiveDate < resolveSoldBusinessDate(invoice, documents).date) throw fail("An adjustment cannot predate this sale.");
  const reason = clean(body.reason);
  if (reason.length < 3) throw fail("Record the reason for the adjustment.");
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || cents(amount) !== amount * 100 && Math.abs(cents(amount) - amount * 100) > 0.000001) throw fail("Enter a positive amount with at most two decimal places.");
  const credits = documents.filter(doc => doc.sourceFinancialDocumentId === invoice.financialDocumentId && isRevenueCredit(doc) && isActive(doc));
  if (documents.some(doc => doc.documentType === "credit" && doc.sourceFinancialDocumentId === invoice.financialDocumentId && isActive(doc) && !isRevenueCredit(doc) && !require("./IXIFinancialTradeCorrections").isTradeCredit(doc))) throw fail("Reconcile the existing legacy customer credit before adding a sale adjustment.");
  const originalTaxCents = cents(invoice.totals?.tax ?? invoice.metadata?.commercialBreakdown?.tax ?? 0);
  const priorTaxCents = credits.reduce((sum, doc) => sum + cents(doc.totals?.tax || 0), 0);
  const taxAmount = kind === "return" ? (originalTaxCents - priorTaxCents) / 100 : Number(body.taxAmount ?? 0);
  if (!Number.isFinite(taxAmount) || taxAmount < 0 || taxAmount > amount || cents(taxAmount) > originalTaxCents - priorTaxCents || Math.abs(cents(taxAmount) - taxAmount * 100) > 0.000001) throw fail("The tax credit must match the remaining original invoice tax and cannot exceed the credit amount.");
  if (kind !== "return" && originalTaxCents > 0 && body.taxAmount == null) throw fail("Specify the tax included in this credit, including zero if no tax is being credited.");
  const creditedCents = [...credits, ...require("./IXIFinancialTradeCorrections").tradeCredits(invoice.financialDocumentId, documents)].reduce((sum, doc) => sum + cents(totalOf(doc)), 0);
  const remainingCents = cents(totalOf(invoice)) - creditedCents;
  if (cents(amount) > remainingCents) throw fail("The credit exceeds the remaining original invoice amount.");
  if (kind === "return" && cents(amount) !== remainingCents) throw fail("A full sale return must credit the remaining invoice amount. Use a price adjustment when the buyer keeps the machine.");
  if (credits.some(doc => doc.assetSaleAdjustment?.kind === "return")) throw fail("A return has already been recorded for this sale.");
  const financialDocumentId = `ifd_sale_credit_${crypto.createHash("sha256").update(`${accessContext.entityPassportId}:${identity.commandId}`).digest("hex").slice(0,24)}`;
  const document = createCostCreditDocument({ financialDocumentId, documentNumber: `CR-${financialDocumentId.slice(-8).toUpperCase()}`,
    amount, currency: invoice.currency, occurredAt: effectiveDate, financialState: "incurred", reasonCode: kind,
    description: `${kind === "return" ? "Sale return" : "Sale price adjustment"} · ${invoice.documentNumber || invoice.financialDocumentId}`,
    references: invoice.references, sourceFinancialDocumentId: invoice.financialDocumentId,
    recordedByPassportId: accessContext.actorPassportId,
    metadata: { saleLifecycleCommandId: identity.commandId, saleLifecycleAction: "adjustment", saleLifecycleFingerprint: fingerprint(body), reason } });
  document.totals = { ...document.totals, subtotal: amount - taxAmount, tax: taxAmount, total: amount };
  document.metadata.saleId = invoice.financialDocumentId;
  document.creditType = "revenue-credit";
  document.creditSide = "revenue";
  document.lines = document.lines.map(line => ({ ...line, direction: "outflow", metadata: { ...line.metadata, creditSide: "revenue" } }));
  document.assetSaleAdjustment = { schema: "ixi.asset-sale-adjustment.v1", kind, saleId: invoice.financialDocumentId,
    effectiveDate, reason, amount, currency: invoice.currency, entityPassportId: accessContext.entityPassportId,
    actorPassportId: accessContext.actorPassportId, recordedAt: new Date().toISOString(),
    machineReturned: false, originalSalePrice: invoice.metadata.assetSaleRecord.sale.machineSalePrice ?? invoice.metadata.assetSaleRecord.sale.salePrice,
    settlementReviewRequired: true };
  document.metadata.saleBalanceControl = { sourceId: invoice.financialDocumentId, kind: "credit", limitCents: cents(totalOf(invoice)), baselineCents: creditedCents };
  if (taxAmount > 0) document.metadata.saleTaxCreditControl = { sourceId: invoice.financialDocumentId, kind: "tax-credit", amountCents: cents(taxAmount), limitCents: originalTaxCents, baselineCents: priorTaxCents };
  return { document, ...identity };
}

function planRefund({ invoice, documents, body, accessContext }) {
  const identity = commandIdentity(body);
  const replay = priorCommand(documents, identity.commandId, "refund");
  if (replay) { if ((replay.metadata?.saleId || replay.sourceFinancialDocumentId) !== invoice.financialDocumentId) throw fail("This command already belongs to a different sale."); return checkedReplay(replay, body); }
  const credit = documents.find(doc => doc.financialDocumentId === clean(body.creditId) &&
    doc.sourceFinancialDocumentId === invoice.financialDocumentId && isRevenueCredit(doc) && isActive(doc));
  if (!credit) throw fail("Select the recorded customer credit being refunded.");
  if (credit.currency !== invoice.currency) throw fail("The customer credit currency must match the original sale.");
  const effectiveDate = businessDate(body.effectiveDate);
  if (effectiveDate < clean(credit.occurredAt).slice(0,10)) throw fail("The refund cannot predate its credit.");
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(cents(amount) - amount * 100) > 0.000001) throw fail("Enter the amount actually refunded, with at most two decimal places.");
  const refunds = documents.filter(doc => doc.sourceFinancialDocumentId === credit.financialDocumentId && isCustomerRefund(doc) && isActive(doc));
  const refundedCents = refunds.reduce((sum, doc) => sum + cents(totalOf(doc)), 0);
  if (cents(amount) + refundedCents > cents(totalOf(credit))) throw fail("The refund exceeds the unpaid customer credit.");
  const credits = new Set(documents.filter(doc => doc.sourceFinancialDocumentId === invoice.financialDocumentId && isRevenueCredit(doc) && isActive(doc)).map(doc => doc.financialDocumentId));
  const received = documents.filter(doc => doc.sourceFinancialDocumentId === invoice.financialDocumentId && doc.documentType === "payment" && doc.paymentDirection === "inflow" && ["paid", "posted", "collected", "closed"].includes(doc.financialState) && isActive(doc)).reduce((sum, doc) => sum + cents(totalOf(doc)), 0);
  const returnedFunds = documents.filter(doc => credits.has(doc.sourceFinancialDocumentId) && isCustomerRefund(doc) && isActive(doc)).reduce((sum, doc) => sum + cents(totalOf(doc)), 0);
  if (cents(amount) + returnedFunds > received) throw fail("The refund exceeds the sale funds actually received and not already refunded.");
  if (!clean(body.reference) || !clean(body.paymentMethod)) throw fail("Record the refund method and actual payment reference.");
  const financialDocumentId = `ifd_sale_refund_${crypto.createHash("sha256").update(`${accessContext.entityPassportId}:${identity.commandId}`).digest("hex").slice(0,24)}`;
  const document = createPaymentDocument({ financialDocumentId, documentNumber: `REF-${financialDocumentId.slice(-8).toUpperCase()}`,
    amount, currency: credit.currency, occurredAt: effectiveDate, paymentDirection: "outflow", financialState: "paid",
    paymentMethod: clean(body.paymentMethod), transactionReference: clean(body.reference),
    sourceFinancialDocumentId: credit.financialDocumentId, references: invoice.references,
    description: `Customer refund · ${invoice.documentNumber || invoice.financialDocumentId}`,
    metadata: { customerRefund: true, saleId: invoice.financialDocumentId, saleLifecycleCommandId: identity.commandId, saleLifecycleFingerprint: fingerprint(body),
      saleLifecycleAction: "refund", recordedByPassportId: accessContext.actorPassportId,
      saleBalanceControl: { sourceId: credit.financialDocumentId, kind: "refund", limitCents: cents(totalOf(credit)), baselineCents: refundedCents } } });
  document.paymentKind = "refund";
  document.refundSide = "customer";
  document.metadata.saleCashRefundControl = { sourceId: invoice.financialDocumentId, kind: "cash-refund", limitCents: received, baselineCents: returnedFunds };
  return { document, ...identity };
}

function planReturn({ record, invoice, documents, body, accessContext }) {
  const identity = commandIdentity(body);
  const prior = invoice.metadata?.inventoryLifecycle || { schema: "ixi.inventory-events.v1", events: [] };
  const events = array(prior.events);
  const replay = events.find(event => event.commandId === identity.commandId);
  if (replay) return checkedReplay(replay, body);
  if (events.some(event => event.type === "return-to-private")) throw fail("This sale has already been returned to private inventory.");
  const credit = documents.find(doc => doc.financialDocumentId === clean(body.creditId) && doc.sourceFinancialDocumentId === invoice.financialDocumentId &&
    isRevenueCredit(doc) && isActive(doc) && doc.assetSaleAdjustment?.kind === "return");
  if (!credit) throw fail("Record the sale return credit before restoring private inventory.");
  if (body.machineReturned !== true) throw fail("Confirm that the machine has returned to your inventory.");
  const effectiveDate = businessDate(body.effectiveDate);
  if (effectiveDate < resolveSoldBusinessDate(invoice, documents).date || effectiveDate < clean(credit.occurredAt).slice(0, 10)) throw fail("The machine return cannot predate the recorded sale reversal.");
  const reason = clean(body.reason);
  if (reason.length < 3) throw fail("Record the reason and evidence for returning this machine.");
  const expectedRevision = Number(body.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== Number(record.server?.revision)) throw fail("This sale changed. Reload it before recording the return.");
  const event = { eventId: `return_${identity.commandId}`, commandId: identity.commandId, type: "return-to-private",
    effectiveDate, sequence: Number(invoice.metadata?.inventoryMutation?.sequence || 1) + 1, recordedAt: new Date().toISOString(), actorPassportId: accessContext.actorPassportId,
    entityPassportId: accessContext.entityPassportId, creditId: credit.financialDocumentId, reason, machineReturned: true, fingerprint: fingerprint(body) };
  return { patch: { metadata: { ...invoice.metadata, inventoryLifecycle: { ...prior, events: [...events, event] },
    inventoryMutation: { commandId: identity.commandId, sequence: event.sequence, type: "return", state: "owned", passportId: invoice.metadata.assetSaleRecord.context.assetPassportId,
      previousSaleId: invoice.financialDocumentId, effectiveDate, recordedAt: event.recordedAt, forcePrivate: true } } },
    expectedRevision, ...identity, event };
}

module.exports = { readSale, planAdjustment, planRefund, planReturn, businessDate, commandIdentity };
