"use strict";

const express = require("express");
const provider = require("./IXIFinancialProviderService");
const { resolveFinancialAccessContextFromRequest } = require("./IXIFinancialAccessContextBridge");
const { authorizeFinancialAction, authorizeFinancialDocumentWrite, canAccessFinancialPassport, IXI_FINANCIAL_ACTIONS: ACTIONS } = require("./IXIFinancialPermissionEngine");
const { assertFinancialPeriodOpen, validateJournalAccounts } = require("./IXIFinancialCommandEngine");
const { loadInventory } = require("./IXIFinancialInventoryService");
const { querySoldInventory } = require("./IXIFinancialInventoryLifecycle");
const { readSale, planAdjustment, planRefund, planReturn } = require("./IXIFinancialSaleReturnService");
const router = express.Router();

function denied(message) { return Object.assign(new Error(message), { status: 403 }); }
function errorResponse(res, error) {
  return res.status(error.status || 409).json({ ok: false, data: null, errors: [{ message: error.message }], warnings: [] });
}
async function access(req, action) {
  const context = await resolveFinancialAccessContextFromRequest(req);
  if (!context.authenticated) throw Object.assign(new Error("Sign in to your company to open SOLD."), { status: 401 });
  if (!context.entityPassportId || !authorizeFinancialAction({ accessContext: context, action }).allowed) throw denied("Your account does not have authority for this action.");
  return context;
}

router.get("/", async (req, res) => {
  try {
    const context = await access(req, ACTIONS.VIEW_PASSPORT_DOCUMENTS);
    const projection = await loadInventory(context.entityPassportId);
    const allowed = passportId => canAccessFinancialPassport({ accessContext: context, passportId });
    const scoped = { ...projection,
      sales: projection.sales.filter(sale => allowed(sale.passportId)),
      current: Object.fromEntries(Object.entries(projection.current).filter(([passportId]) => allowed(passportId))),
      issues: projection.issues.filter(issue => !issue.passportId || allowed(issue.passportId)) };
    res.set("Cache-Control", "private, no-store");
    return res.json({ ok: true, data: req.query.all === "1" ? scoped : querySoldInventory(scoped, req.query), errors: [], warnings: [] });
  } catch (error) { return errorResponse(res, error); }
});

for (const action of ["adjustment", "refund", "return"]) {
  router.post(`/sales/:saleId/${action}`, async (req, res) => {
    try {
      const permission = action === "refund" ? ACTIONS.RECORD_PAYMENT : ACTIONS.REVERSE_DOCUMENT;
      const context = await access(req, permission);
      const source = await readSale({ saleId: req.params.saleId, accessContext: context });
      const authorization = authorizeFinancialDocumentWrite({ accessContext: context,
        financialDocument: source.invoice, action: permission });
      if (!authorization.allowed) throw denied("You cannot change this sale.");
      const plan = (action === "adjustment" ? planAdjustment : action === "refund" ? planRefund : planReturn)({
        ...source, body: req.body || {}, accessContext: context });
      if (plan.replay) return res.json({ ok: true, data: { replayed: true, record: plan.replay }, errors: [], warnings: [] });
      await assertFinancialPeriodOpen({ financialDocument: plan.document || { ...source.invoice, occurredAt: plan.event.effectiveDate }, entityPassportId: context.entityPassportId });
      if (plan.document) await validateJournalAccounts({ financialDocument: plan.document, entityPassportId: context.entityPassportId });
      const result = plan.document
        ? await provider.createDocument({ financialDocument: plan.document, actorPassportId: context.actorPassportId,
          entityPassportId: context.entityPassportId, commandId: plan.commandId, idempotencyKey: plan.idempotencyKey })
        : await provider.patchDocument({ financialDocumentId: source.invoice.financialDocumentId, patch: plan.patch,
          expectedRevision: plan.expectedRevision, actorPassportId: context.actorPassportId,
          commandId: plan.commandId, idempotencyKey: plan.idempotencyKey });
      if (!result?.ok) return res.status(409).json(result);
      return res.json(result);
    } catch (error) { return errorResponse(res, error); }
  });
}

module.exports = router;
