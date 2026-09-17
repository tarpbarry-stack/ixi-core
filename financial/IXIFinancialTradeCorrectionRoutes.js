"use strict";
const express = require("express");
const provider = require("./IXIFinancialProviderService");
const { resolveFinancialAccessContextFromRequest } = require("./IXIFinancialAccessContextBridge");
const { authorizeFinancialAction, authorizeFinancialDocumentWrite, IXI_FINANCIAL_ACTIONS: ACTIONS } = require("./IXIFinancialPermissionEngine");
const { entityOf } = require("./IXIFinancialInventoryLifecycle");
const { assertFinancialPeriodOpen } = require("./IXIFinancialCommandEngine");
const { tradeCredits, collectionPosition, correctionBlock, planTradeCorrection } = require("./IXIFinancialTradeCorrections");
const router = express.Router({ mergeParams: true });
const fail = (message, status = 409) => Object.assign(new Error(message), { status });

async function source(req) {
  const context = await resolveFinancialAccessContextFromRequest(req);
  if (!context.authenticated) throw fail("Sign in to your company to open trades.", 401);
  const action = req.method === "GET" ? ACTIONS.VIEW_PASSPORT_DOCUMENTS : ACTIONS.PATCH_DOCUMENT;
  if (!context.entityPassportId || !authorizeFinancialAction({ accessContext: context, action }).allowed) throw fail("Your account cannot access this trade correction.", 403);
  const loaded = await provider.getDocument({ financialDocumentId: req.params.financialDocumentId });
  const orderRecord = loaded?.data?.record, orderDocument = orderRecord?.financialDocument, order = orderDocument?.salesOrder;
  if (!loaded?.ok || orderDocument?.documentType !== "sales-order" || !order) throw fail("The saved sales order could not be loaded.");
  if (entityOf(orderDocument) !== context.entityPassportId || !authorizeFinancialDocumentWrite({ accessContext: context, financialDocument: orderDocument, action }).allowed) throw fail("This sales order is outside your company access.", 403);
  const invoiceLoaded = await provider.getDocument({ financialDocumentId: order.related?.invoiceId });
  const invoiceRecord = invoiceLoaded?.data?.record, invoice = invoiceRecord?.financialDocument;
  if (!invoiceLoaded?.ok || invoice?.documentType !== "invoice" || invoice.sourceFinancialDocumentId !== orderDocument.financialDocumentId) throw fail("The order's linked invoice could not be verified.");
  if (entityOf(invoice) !== context.entityPassportId || !authorizeFinancialDocumentWrite({ accessContext: context, financialDocument: invoice, action }).allowed) throw fail("This invoice is outside your company access.", 403);
  const listed = await provider.listDocumentsByPassport({ passportId: context.entityPassportId });
  if (!listed?.ok || !Array.isArray(listed.data?.documents)) throw fail("The invoice balance could not be verified. Retry.");
  const documents = listed.data.documents.map(item => item.financialDocument || item).filter(doc => entityOf(doc) === context.entityPassportId);
  return { context, orderRecord, order, invoiceRecord, invoice, documents };
}
function view(state) {
  return { corrections: tradeCredits(state.invoice.financialDocumentId, state.documents),
    position: collectionPosition(state.invoice, state.documents), blockedReason: correctionBlock(state.invoice, state.documents) };
}
router.get("/", async (req, res) => {
  try { const state = await source(req); res.set("Cache-Control", "private, no-store"); return res.json({ ok: true, data: view(state) }); }
  catch (error) { return res.status(error.status || 409).json({ ok: false, errors: [{ message: error.message }] }); }
});
router.post("/", async (req, res) => {
  try {
    const state = await source(req);
    const plan = planTradeCorrection({ ...state, body: req.body || {}, accessContext: state.context });
    if (plan.replay) return res.json({ ok: true, data: { ...view(state), credit: plan.replay, replayed: true } });
    await assertFinancialPeriodOpen({ financialDocument: plan.document, entityPassportId: state.context.entityPassportId });
    plan.document.metadata.tradeCorrectionControl = { invoiceId: state.invoice.financialDocumentId, revision: state.invoiceRecord.server.revision };
    const result = await provider.createDocument({ financialDocument: plan.document, actorPassportId: state.context.actorPassportId,
      entityPassportId: state.context.entityPassportId, commandId: plan.commandId, idempotencyKey: plan.idempotencyKey });
    if (!result?.ok) return res.status(409).json(result);
    const credit = result.data.record.financialDocument;
    if (credit.tradeCorrection?.fingerprint !== plan.document.tradeCorrection.fingerprint) throw fail("This machine was just credited with different details. Reload the saved trade.");
    const refreshed = await source(req);
    return res.status(201).json({ ok: true, data: { ...view(refreshed), credit, replayed: result.data.idempotentReplay === true } });
  } catch (error) { return res.status(error.status || 409).json({ ok: false, errors: [{ message: error.message }] }); }
});
module.exports = router;
