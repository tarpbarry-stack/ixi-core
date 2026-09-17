"use strict";
const { assetOf } = require("./IXIFinancialInventoryLifecycle");
const { loadInventory } = require("./IXIFinancialInventoryService");
const clean = value => String(value ?? "").trim();
const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function protectedMonetary(document = {}) {
  return ["revenue-credit", "trade-credit"].includes(document.creditType) || document.tradeCorrection || document.metadata?.tradeCredit === true || document.metadata?.tradeCorrectionControl || document.metadata?.customerRefund === true ||
    document.assetSaleAdjustment || document.metadata?.saleBalanceControl || document.metadata?.saleCashRefundControl;
}

function assertGenericSaleMutation({ existing = {}, next = {}, mode = "patch" } = {}) {
  if (protectedMonetary(existing) || protectedMonetary(next)) throw new Error("Customer sale credits and refunds must use the dedicated sale adjustment workflow. Existing records are immutable.");
  for (const key of ["inventoryLifecycle", "inventoryMutation"]) {
    if (!equal(existing.metadata?.[key], next.metadata?.[key])) throw new Error("Inventory movement must follow a recorded sale or return command.");
  }
  const sold = existing.metadata?.assetSaleRecord?.status === "sold";
  if (mode === "create" && next.metadata?.assetSaleRecord) throw new Error("Record SOLD against the existing invoice after verifying funds.");
  if (!sold) return;
  if (mode === "replace") throw new Error("A completed sale cannot be replaced. Record a linked adjustment or return.");
  if (!equal(existing.metadata.assetSaleRecord, next.metadata?.assetSaleRecord) ||
      !equal(existing.metadata?.assetSale, next.metadata?.assetSale) ||
      !equal([existing.status, existing.financialState, existing.occurredAt, existing.documentType], [next.status, next.financialState, next.occurredAt, next.documentType]) ||
      !equal([existing.totals, existing.lines, existing.references, existing.currency, existing.sourceFinancialDocumentId],
        [next.totals, next.lines, next.references, next.currency, next.sourceFinancialDocumentId])) {
    throw new Error("Completed sale facts are preserved. Use a linked adjustment or return.");
  }
}

async function bindSoldInventory({ existing = {}, next = {}, accessContext, commandId, inventoryLoader = loadInventory }) {
  if (existing.metadata?.assetSaleRecord?.status === "sold" || next.metadata?.assetSaleRecord?.status !== "sold") return next.metadata;
  const sale = next.metadata.assetSaleRecord;
  if (existing.documentType !== "invoice" || next.metadata.assetSale !== true ||
      clean(sale.identity?.financialInvoiceId || sale.identity?.saleId) !== clean(existing.financialDocumentId)) {
    throw new Error("SOLD must identify the original invoice and retain its canonical sale designation.");
  }
  const { businessDate } = require("./IXIFinancialSaleReturnService");
  businessDate(sale.sale?.saleDate);
  const price = Number(sale.sale?.machineSalePrice);
  const tradeValue = (existing.metadata?.trades || []).reduce((sum, trade) => sum + Math.round(Number(trade.allowance) * 100), 0) / 100;
  const invoiceTotal = Number(existing.totals?.total) + tradeValue;
  if (!Number.isFinite(invoiceTotal) || !Number.isFinite(price) || price <= 0 || price > invoiceTotal || Math.abs(Math.round(price * 100) - price * 100) > 0.000001) throw new Error("Record the actual machine sale price, excluding invoice additions, before completing SOLD.");
  const passportId = assetOf(existing);
  if (!passportId || clean(sale.context?.assetPassportId) !== passportId) throw new Error("The sold machine must match the original invoice's verified Passport reference.");
  const projection = await inventoryLoader(accessContext.entityPassportId);
  const current = projection.current[passportId];
  if (current?.state === "sold" && current.documentId !== existing.financialDocumentId) throw new Error("This machine already has a completed sale. Record its return or a later acquisition before another sale.");
  const previousSale = projection.sales.find(item => item.passportId === passportId);
  const recordedAt = new Date().toISOString();
  return { ...next.metadata,
    assetSaleRecord: { ...sale,
      sale: { ...sale.sale, saleDateSource: sale.sale.saleDateSource === "invoice" && sale.sale.saleDate === clean(existing.occurredAt).slice(0, 10) ? "invoice" : "operator" },
      context: { ...sale.context, entityPassportId: accessContext.entityPassportId, actorPassportId: accessContext.actorPassportId },
      audit: { ...sale.audit, createdBy: accessContext.actorPassportId, closedAt: recordedAt, updatedAt: recordedAt } },
    inventoryMutation: { commandId, sequence: Number(current?.sequence || 0) + 1, type: "sale", passportId, state: "sold", previousSaleId: previousSale?.saleId || "", effectiveDate: sale.sale.saleDate, recordedAt }
  };
}

module.exports = { protectedMonetary, assertGenericSaleMutation, bindSoldInventory };
