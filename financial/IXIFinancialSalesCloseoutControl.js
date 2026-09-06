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
