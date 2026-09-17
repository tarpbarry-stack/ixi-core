"use strict";

const providerService = require("./IXIFinancialProviderService");
const clean = value => String(value ?? "").trim();
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = value => Array.isArray(value) ? value : [];
const money = value => Math.round(Number(value || 0) * 100) / 100;

const ACTIVE_RECEIPT_STATES = new Set(["paid", "posted", "collected", "closed"]);
const ACTIVE_CREDIT_STATES = new Set(["approved", "incurred", "posted", "closed"]);

function financialDocument(record = {}) {
  const envelope = record?.record || record;
  return object(
    envelope?.financialDocument ||
      envelope?.document?.financialDocument ||
      envelope?.document ||
      envelope,
  );
}

function amount(document = {}) {
  const total = Number(document?.totals?.total ?? document?.amount);
  if (Number.isFinite(total)) return money(Math.abs(total));
  return money(
    array(document?.lines).reduce(
      (sum, line) => sum + Math.abs(Number(line?.amount || 0)),
      0,
    ),
  );
}

function isActiveReceipt(document = {}) {
  return (
    clean(document.documentType).toLowerCase() === "payment" &&
    clean(document.paymentDirection).toLowerCase() === "inflow" &&
    ACTIVE_RECEIPT_STATES.has(clean(document.financialState).toLowerCase())
  );
}

function isActiveCredit(document = {}) {
  return (
    clean(document.documentType).toLowerCase() === "credit" &&
    ACTIVE_CREDIT_STATES.has(clean(document.financialState).toLowerCase())
  );
}

async function getInvoiceCollectionPosition({ invoice = {}, entityPassportId = "" } = {}) {
  const invoiceId = clean(invoice.financialDocumentId);
  if (!invoiceId || clean(invoice.documentType).toLowerCase() !== "invoice") {
    throw Object.assign(new Error("Sales closeout requires a canonical Invoice."), {
      name: "IXIFinancialSalesInvoiceRequiredError",
    });
  }
  const listed = await providerService.listDocumentsByPassport({
    passportId: clean(entityPassportId),
  });
  if (!listed?.ok) {
    throw Object.assign(new Error("Invoice collection balance could not be verified."), {
      name: "IXIFinancialSalesCollectionReadError",
      details: { financialDocumentId: invoiceId },
    });
  }
  const related = array(listed?.data?.documents)
    .map(financialDocument)
    .filter(document => clean(document.sourceFinancialDocumentId) === invoiceId);
  const receipts = related.filter(isActiveReceipt);
  const credits = related.filter(isActiveCredit);
  const invoiceAmount = amount(invoice);
  const received = money(receipts.reduce((sum, document) => sum + amount(document), 0));
  const credited = money(credits.reduce((sum, document) => sum + amount(document), 0));
  const tradeCorrections = require("./IXIFinancialTradeCorrections").tradeCredits(invoiceId, related);
  const correctedTradeValue = money(tradeCorrections.reduce((sum, document) => sum + amount(document), 0));
  const settled = money(received + credited);
  const balance = money(Math.max(0, invoiceAmount - settled));
  const expectedFinancialState =
    balance <= 0.005
      ? "collected"
      : settled > 0
        ? "partially-collected"
        : "billed";
  return {
    invoiceId,
    invoiceAmount,
    received,
    credited,
    tradeCorrections,
    correctedTradeValue,
    settled,
    balance,
    expectedFinancialState,
    receiptIds: receipts.map(document => clean(document.financialDocumentId)).filter(Boolean),
    creditIds: credits.map(document => clean(document.financialDocumentId)).filter(Boolean),
  };
}

async function assertInvoiceCollectionPatchAvailable({
  existing = {},
  merged = {},
  entityPassportId = "",
} = {}) {
  if (clean(merged.documentType).toLowerCase() !== "invoice") return { checked: false };
  const metadata = object(merged.metadata);
  const nextState = clean(merged.financialState).toLowerCase();
  const collectionTransition = ["partially-collected", "collected"].includes(nextState);
  const saleCloseout = metadata.assetSale === true || clean(metadata.transactModule).toLowerCase() === "sold";
  if (!collectionTransition && !saleCloseout) return { checked: false };

  const position = await getInvoiceCollectionPosition({ invoice: existing, entityPassportId });
  if (nextState !== position.expectedFinancialState) {
    throw Object.assign(
      new Error(
        `Invoice collection state must be ${position.expectedFinancialState}; canonical balance is ${position.balance.toFixed(2)}.`,
      ),
      {
        name: "IXIFinancialInvoiceCollectionStateError",
        details: position,
      },
    );
  }

  if (saleCloseout) {
    const sale = object(metadata.assetSaleRecord);
    if (position.balance > 0.005) {
      throw Object.assign(
        new Error("SOLD requires a fully collected Invoice with a zero canonical balance."),
        {
          name: "IXIFinancialSoldCollectionRequiredError",
          details: position,
        },
      );
    }
    const trades = array(existing.metadata?.trades);
    for (const credit of position.tradeCorrections) {
      const registry = require("../mos/onboarding/tradeMachineService");
      const rows = registry.verifiedOrderTrades({ trades: [credit.tradeCorrection.trade], identity: { dealId: credit.metadata.dealId }, context: credit.metadata.tradeContext });
      for (const row of rows) {
        if (row.status !== "acquired" || !row.acquisitionId) throw new Error("Record each trade acquisition before completing SOLD.");
        await registry.loadVerifiedAcquisition(row, row.acquisitionId);
      }
    }
    if (trades.length) {
      const linked = require("../mos/onboarding/tradeMachineService").verifiedOrderTrades({
        trades, identity: { dealId: existing.metadata?.dealId }, context: existing.metadata?.tradeContext
      });
      if (linked.some(row => row.status !== "acquired" || !row.acquisitionId)) throw new Error("Record each trade acquisition before completing SOLD.");
      for (const row of linked) await require("../mos/onboarding/tradeMachineService").loadVerifiedAcquisition(row, row.acquisitionId);
    }
    const fullyTraded = (trades.length > 0 || position.correctedTradeValue > 0) && position.invoiceAmount === position.correctedTradeValue && position.credited === position.correctedTradeValue;
    if (!fullyTraded && (!(position.received > 0) || position.invoiceAmount <= position.credited)) {
      throw Object.assign(new Error("SOLD requires recorded sale funds. A fully credited or zero-value invoice is not a collected machine sale."), {
        name: "IXIFinancialSoldReceiptRequiredError", details: position,
      });
    }
    if (clean(sale.status).toLowerCase() !== "sold") {
      throw Object.assign(new Error("SOLD closeout requires a canonical sold record."), {
        name: "IXIFinancialSoldRecordRequiredError",
      });
    }
    const saleInvoiceId = clean(
      sale?.identity?.financialInvoiceId ||
        sale?.identity?.saleId ||
        sale?.financialBinding?.financialDocumentId,
    );
    if (saleInvoiceId && saleInvoiceId !== position.invoiceId) {
      throw Object.assign(new Error("SOLD record Invoice lineage does not match the canonical Invoice."), {
        name: "IXIFinancialSoldInvoiceLineageError",
      });
    }
  }
  return { checked: true, ...position };
}

async function assertCollectedAssetSaleInvoice({ invoice = {}, entityPassportId = "" } = {}) {
  const metadata = object(invoice.metadata);
  if (array(metadata.inventoryLifecycle?.events).some(event => event.type === "return-to-private")) {
    throw new Error("This sale was returned. Resolve its existing settlement obligations through recorded corrections.");
  }
  if (metadata.assetSale !== true || clean(metadata?.assetSaleRecord?.status).toLowerCase() !== "sold") {
    throw Object.assign(new Error("Settlement requires a completed SOLD closeout."), {
      name: "IXIFinancialSoldCloseoutRequiredError",
    });
  }
  const position = await getInvoiceCollectionPosition({ invoice, entityPassportId });
  if (clean(invoice.financialState).toLowerCase() !== "collected" || position.balance > 0.005) {
    throw Object.assign(
      new Error("Settlement requires a fully collected Invoice with a zero canonical balance."),
      {
        name: "IXIFinancialSettlementCollectionRequiredError",
        details: position,
      },
    );
  }
  return { checked: true, ...position };
}

module.exports = {
  getInvoiceCollectionPosition,
  assertInvoiceCollectionPatchAvailable,
  assertCollectedAssetSaleInvoice,
};
