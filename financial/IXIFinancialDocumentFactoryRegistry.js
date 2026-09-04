"use strict";

/*
 * IXI FINANCIAL DOCUMENT FACTORY REGISTRY
 *
 * PURPOSE
 * -------
 *
 * One canonical server-side entry point for
 * creating all supported Financial Documents.
 *
 *
 * WHY THIS EXISTS
 * ---------------
 *
 * Faces should NOT import individual factories.
 *
 * Future UI / API / automation code calls:
 *
 * createFinancialDocumentByType({
 *   documentType,
 *   input
 * })
 *
 * and this registry dispatches to the correct
 * canonical factory.
 */


const {
  createExpenseDocument
} =
  require(
    "./IXIFinancialExpenseFactory"
  );


const {
  createPurchaseOrderDocument
} =
  require(
    "./IXIFinancialPurchaseOrderFactory"
  );


const {
  createBillDocument,
  createSupplierInvoiceDocument
} =
  require(
    "./IXIFinancialBillFactory"
  );


const {
  createPaymentDocument
} =
  require(
    "./IXIFinancialPaymentFactory"
  );


const {
  createInvoiceDocument
} =
  require(
    "./IXIFinancialInvoiceFactory"
  );


const {
  createWorkOrderDocument
} =
  require(
    "./IXIFinancialWorkOrderFactory"
  );


const {
  createTimeEntryDocument
} =
  require(
    "./IXIFinancialTimeEntryFactory"
  );

const {
  createMaterialUsageDocument
} =
  require(
    "./IXIFinancialMaterialUsageFactory"
  );

const {
  createAssetAcquisitionDocument
} =
  require(
    "./IXIFinancialAssetAcquisitionFactory"
  );

const {
  createRentalExpenseDocument
} =
  require(
    "./IXIFinancialRentalExpenseFactory"
  );

const {
  createRentalIncomeDocument
} =
  require(
    "./IXIFinancialRentalIncomeFactory"
  );

const {
  createServiceQuoteDocument
} = require("./IXIFinancialServiceQuoteFactory");

const {
  createQuoteDocument
} = require("./IXIFinancialQuoteFactory");

const { createPayablesControlDocument } = require("./IXIFinancialPayablesControlFactory");
const { createTreasuryAccountDocument, createTreasuryReconciliationDocument } = require("./IXIFinancialTreasuryFactory");
const { createCollectionDocument, createSettlementDocument } = require("./IXIFinancialOperationalControlFactory");


const {
  createCostCreditDocument
} =
  require(
    "./IXIFinancialCreditFactory"
  );



const {
  createJournalEntryDocument
} =
  require(
    "./IXIFinancialJournalEntryFactory"
  );



const {
  createPeriodCloseDocument
} =
  require(
    "./IXIFinancialPeriodCloseFactory"
  );

const {
  createPeriodReopenDocument,
  createPostingRuleDocument
} = require("./IXIFinancialAccountingControlFactory");


/* =========================================================
   TYPES
   ========================================================= */

const IXI_FINANCIAL_DOCUMENT_TYPES =
  Object.freeze({
    EXPENSE:
      "expense",

    PURCHASE_ORDER:
      "purchase-order",

    BILL:
      "bill",

    SUPPLIER_INVOICE:
      "supplier-invoice",

    PAYMENT:
      "payment",

    INVOICE:
      "invoice",

    WORK_ORDER:
      "work-order",

    TIME_ENTRY:
      "time-entry",

    MATERIAL_USAGE:
      "material-usage",

    ASSET_ACQUISITION:
      "asset-acquisition",

    RENTAL_EXPENSE:
      "rental-expense",

    RENTAL_INCOME:
      "rental-income",

    SERVICE_QUOTE:
      "service-quote",

    QUOTE:
      "quote",

    COLLECTION:
      "collection",

    SETTLEMENT:
      "settlement",

    PAYABLES_CONTROL:
      "payables-control",

    TREASURY_ACCOUNT:
      "treasury-account",

    TREASURY_RECONCILIATION:
      "treasury-reconciliation",

    CREDIT:
      "credit",

    JOURNAL_ENTRY:
      "journal-entry",

    PERIOD_CLOSE:
      "period-close",

    PERIOD_REOPEN:
      "period-reopen",

    POSTING_RULE:
      "posting-rule"
  });


/* =========================================================
   HELPERS
   ========================================================= */

function clean(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


function safeObject(
  value
) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}


function normalizeFinancialDocumentType(
  value
) {
  return clean(
    value
  ).toLowerCase();
}


/* =========================================================
   FACTORY MAP
   ========================================================= */

const FACTORIES =
  Object.freeze({

    [IXI_FINANCIAL_DOCUMENT_TYPES.EXPENSE]:
      createExpenseDocument,


    [IXI_FINANCIAL_DOCUMENT_TYPES.PURCHASE_ORDER]:
      createPurchaseOrderDocument,


    [IXI_FINANCIAL_DOCUMENT_TYPES.BILL]:
      createBillDocument,


    [IXI_FINANCIAL_DOCUMENT_TYPES.SUPPLIER_INVOICE]:
      createSupplierInvoiceDocument,


    [IXI_FINANCIAL_DOCUMENT_TYPES.PAYMENT]:
      createPaymentDocument,


    [IXI_FINANCIAL_DOCUMENT_TYPES.INVOICE]:
      createInvoiceDocument,


    [IXI_FINANCIAL_DOCUMENT_TYPES.WORK_ORDER]:
      createWorkOrderDocument,


    [IXI_FINANCIAL_DOCUMENT_TYPES.TIME_ENTRY]:
      createTimeEntryDocument,

    [IXI_FINANCIAL_DOCUMENT_TYPES.MATERIAL_USAGE]:
      createMaterialUsageDocument,

    [IXI_FINANCIAL_DOCUMENT_TYPES.ASSET_ACQUISITION]:
      createAssetAcquisitionDocument,

    [IXI_FINANCIAL_DOCUMENT_TYPES.RENTAL_EXPENSE]:
      createRentalExpenseDocument,

    [IXI_FINANCIAL_DOCUMENT_TYPES.RENTAL_INCOME]:
      createRentalIncomeDocument,

    [IXI_FINANCIAL_DOCUMENT_TYPES.SERVICE_QUOTE]:
      createServiceQuoteDocument,

    [IXI_FINANCIAL_DOCUMENT_TYPES.QUOTE]:
      createQuoteDocument,

    [IXI_FINANCIAL_DOCUMENT_TYPES.COLLECTION]:
      createCollectionDocument,

    [IXI_FINANCIAL_DOCUMENT_TYPES.SETTLEMENT]:
      createSettlementDocument,

    [IXI_FINANCIAL_DOCUMENT_TYPES.PAYABLES_CONTROL]:
      createPayablesControlDocument,

    [IXI_FINANCIAL_DOCUMENT_TYPES.TREASURY_ACCOUNT]:
      createTreasuryAccountDocument,

    [IXI_FINANCIAL_DOCUMENT_TYPES.TREASURY_RECONCILIATION]:
      createTreasuryReconciliationDocument,


    [IXI_FINANCIAL_DOCUMENT_TYPES.CREDIT]:
      createCostCreditDocument,


    [IXI_FINANCIAL_DOCUMENT_TYPES.JOURNAL_ENTRY]:
      createJournalEntryDocument,


    [IXI_FINANCIAL_DOCUMENT_TYPES.PERIOD_CLOSE]:
      createPeriodCloseDocument,

    [IXI_FINANCIAL_DOCUMENT_TYPES.PERIOD_REOPEN]:
      createPeriodReopenDocument,

    [IXI_FINANCIAL_DOCUMENT_TYPES.POSTING_RULE]:
      createPostingRuleDocument
  });


/* =========================================================
   SUPPORTED TYPES
   ========================================================= */

function listFinancialDocumentFactoryTypes() {
  return Object.keys(
    FACTORIES
  );
}


/* =========================================================
   FACTORY LOOKUP
   ========================================================= */

function getFinancialDocumentFactory(
  documentType
) {
  const resolvedType =
    normalizeFinancialDocumentType(
      documentType
    );


  const factory =
    FACTORIES[
      resolvedType
    ];


  if (
    !factory
  ) {
    const error =
      new Error(
        `Unsupported financial document type: ${resolvedType || "(empty)"}`
      );

    error.name =
      "IXIFinancialUnsupportedDocumentTypeError";

    error.details = {
      documentType:
        resolvedType,

      supportedTypes:
        listFinancialDocumentFactoryTypes()
    };

    throw error;
  }


  return factory;
}


/* =========================================================
   CREATE BY TYPE
   ========================================================= */

function createFinancialDocumentByType({
  documentType = "",
  input = {}
} = {}) {
  const resolvedType =
    normalizeFinancialDocumentType(
      documentType
    );


  const factory =
    getFinancialDocumentFactory(
      resolvedType
    );


  const document =
    factory(
      safeObject(
        input
      )
    );


  /*
   * Defensive contract check.
   *
   * Factory output must match the requested
   * type except supplier-invoice alias which
   * intentionally returns supplier-invoice.
   */
  if (
    normalizeFinancialDocumentType(
      document?.documentType
    ) !==
      resolvedType
  ) {
    const error =
      new Error(
        `Financial factory type mismatch: requested ${resolvedType}, created ${document?.documentType}`
      );

    error.name =
      "IXIFinancialFactoryContractError";

    error.details = {
      requestedType:
        resolvedType,

      createdType:
        normalizeFinancialDocumentType(
          document?.documentType
        )
    };

    throw error;
  }


  return document;
}


/* =========================================================
   REGISTRY DESCRIPTION
   ========================================================= */

function describeFinancialDocumentFactoryRegistry() {
  return {
    registry:
      "IXIFinancialDocumentFactoryRegistry",

    supportedTypes:
      listFinancialDocumentFactoryTypes()
  };
}


/* =========================================================
   EXPORTS
   ========================================================= */

module.exports = {
  IXI_FINANCIAL_DOCUMENT_TYPES,

  FACTORIES,

  normalizeFinancialDocumentType,

  listFinancialDocumentFactoryTypes,

  getFinancialDocumentFactory,

  createFinancialDocumentByType,

  describeFinancialDocumentFactoryRegistry
};
