"use strict";
const clean = (value) => String(value ?? "").trim();
function normalizeSalesTrades(record = {}) {
  if (!Array.isArray(record.trades) || !record.trades.length) return record;
  const ids = new Set(),
    passports = new Set();
  let total = 0;
  const trades = record.trades.map((row) => {
    const amount = Number(row.allowance);
    if (
      !clean(row.tradeId) ||
      !clean(row.passportId) ||
      !clean(row.objectId) ||
      !clean(row.listingId) ||
      !Number.isFinite(amount) ||
      amount < 0 ||
      !Number.isSafeInteger(Math.round(amount * 100)) ||
      ids.has(row.tradeId) ||
      passports.has(row.passportId) ||
      row.passportId === record.asset?.passportId
    ) {
      throw new Error(
        "Each trade requires a unique machine, Passport, and valid allowance.",
      );
    }
    ids.add(row.tradeId);
    passports.add(row.passportId);
    const cents = Math.round(amount * 100);
    total += cents;
    return { ...row, allowance: cents / 100 };
  });
  const totals = { ...record.totals, tradeAllowance: total / 100 };
  totals.total =
    Math.round(
      (Number(totals.subtotal || 0) +
        Number(totals.tax || 0) +
        Number(totals.freight || 0) +
        Number(totals.fees || 0)) *
        100 -
        total,
    ) / 100;
  if (totals.total < 0)
    throw new Error(
      "Trade credits exceed this order's total. Record a separate payable for a reverse-cash deal.",
    );
  totals.balanceDue = Math.max(
    0,
    Math.round((totals.total - Number(totals.deposit || 0)) * 100) / 100,
  );
  return { ...record, trades, totals };
}
function tradeAcquisitionId(record) {
  if (!record?.trade) return "";
  return (
    "ifd_" +
    require("crypto")
      .createHash("sha256")
      .update(
        JSON.stringify([
          record.context?.entityPassportId,
          record.trade.dealId,
          record.trade.tradeId,
        ]),
      )
      .digest("hex")
      .slice(0, 24)
  );
}
function tradeValue(document) {
  if (document.documentType !== "invoice") return 0;
  return (
    (document.metadata?.trades || []).reduce(
      (sum, trade) => sum + Math.round(Number(trade.allowance) * 100),
      0,
    ) / 100
  );
}
async function assertFinancialTradeLinks(document, loadDocument) {
  const registry = require("../mos/onboarding/tradeMachineService");
  if (
    document.documentType === "sales-order" &&
    document.salesOrder?.trades?.length
  ) {
    const normalized = normalizeSalesTrades(document.salesOrder);
    registry.verifiedOrderTrades(normalized);
    if (
      normalized.totals.total !== document.salesOrder.totals.total ||
      normalized.totals.tradeAllowance !==
        document.salesOrder.totals.tradeAllowance
    )
      throw new Error("Sales order trade totals must match its machines.");
  }
  const acquisition =
    document.documentType === "asset-acquisition" && document.assetAcquisition;
  const trades =
    document.documentType === "invoice" && document.metadata?.trades;
  if (!acquisition?.trade && !trades?.length) return;
  const sourceId = document.sourceFinancialDocumentId;
  const source = await loadDocument(sourceId);
  const order = source?.financialDocument?.salesOrder;
  if (!order || !sourceId || !order.trades?.length)
    throw new Error(
      "Trade documents require their saved sales order and linked machines.",
    );
  const rows = registry.verifiedOrderTrades(order);
  if (trades?.length) {
    const invoiceOrder = {
      trades,
      identity: { dealId: document.metadata.dealId },
      context: document.metadata.tradeContext,
    };
    registry.verifiedOrderTrades(invoiceOrder);
    if (
      document.currency &&
      document.currency !== (order.commercial?.currency || "USD")
    )
      throw new Error("Trade invoice currency must match the sales order.");
    if (
      JSON.stringify(order.trades) !== JSON.stringify(trades) ||
      Number(document.totals?.total) !== Number(order.totals.total)
    )
      throw new Error(
        "Save the invoice with the sales order's current trade details and net amount.",
      );
  }
  if (acquisition?.trade) {
    const row = rows.find((item) => item.tradeId === acquisition.trade.tradeId);
    if (
      !row ||
      row.passportId !== acquisition.context?.primaryPassportId ||
      row.dealId !== acquisition.trade.dealId ||
      acquisition.context?.entityPassportId !==
        order.context.entityPassportId ||
      Math.round(Number(acquisition.acquisition?.purchasePrice) * 100) !==
        row.allowanceCents ||
      document.financialDocumentId !== tradeAcquisitionId(acquisition)
    )
      throw new Error(
        "The trade acquisition must match its machine, deal, allowance, and permanent acquisition identity.",
      );
  }
}
module.exports = {
  normalizeSalesTrades,
  tradeAcquisitionId,
  tradeValue,
  assertFinancialTradeLinks,
};
