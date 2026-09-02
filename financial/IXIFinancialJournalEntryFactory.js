"use strict";

/*
 * IXI FINANCIAL JOURNAL ENTRY FACTORY
 *
 * Canonical AWS representation of posted
 * TRAN$ACT General Ledger Journal Entries.
 *
 * Business truth remains in the originating
 * Financial Document.
 *
 * This record is ACCOUNTING TRUTH.
 */

const crypto =
  require("crypto");


function clean(value) {
  return String(
    value ??
    ""
  ).trim();
}


function safeArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}


function safeObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}


function number(value) {
  const resolved =
    Number(value);

  return Number.isFinite(resolved)
    ? resolved
    : 0;
}


function money(value) {
  return Math.round(
    (
      number(value) +
      Number.EPSILON
    ) * 100
  ) / 100;
}


function randomId(prefix) {
  return `${prefix}_${crypto
    .randomBytes(12)
    .toString("hex")}`;
}


function nowIso() {
  return new Date()
    .toISOString();
}


function normalizeCurrency(value) {
  const resolved =
    clean(
      value ||
      "USD"
    ).toUpperCase();

  return /^[A-Z]{3}$/.test(
    resolved
  )
    ? resolved
    : "USD";
}


function normalizeReferences(
  references = []
) {
  const seen =
    new Set();

  return safeArray(
    references
  )
    .map(reference => {
      const source =
        safeObject(
          reference
        );

      const passportId =
        clean(
          source.passportId
        );

      const externalId =
        clean(
          source.externalId
        );

      const role =
        clean(
          source.role
        );

      const key =
        [
          passportId,
          externalId,
          role
        ].join("|");

      if (
        !passportId &&
        !externalId
      ) {
        return null;
      }

      if (
        seen.has(key)
      ) {
        return null;
      }

      seen.add(key);

      return {
        ...source,

        passportId,

        externalId,

        role,

        label:
          clean(
            source.label
          ),

        objectType:
          clean(
            source.objectType
          ),

        metadata:
          safeObject(
            source.metadata
          )
      };
    })
    .filter(Boolean);
}


/* =========================================================
   JOURNAL LINE
   ========================================================= */

function createJournalEntryLine({
  financialDocumentId = "",
  financialLineId = "",
  lineId = "",
  accountCode = "",
  accountName = "",
  description = "",
  memo = "",
  debit = 0,
  credit = 0,
  currency = "USD",
  occurredAt = "",
  references = [],
  dimensions = {},
  metadata = {}
} = {}) {

  const resolvedDebit =
    money(
      debit
    );

  const resolvedCredit =
    money(
      credit
    );

  const amount =
    money(
      Math.max(
        resolvedDebit,
        resolvedCredit
      )
    );

  return {
    financialLineId:
      clean(
        financialLineId ||
        lineId
      ) ||
      randomId(
        "ifl"
      ),

    financialDocumentId:
      clean(
        financialDocumentId
      ),

    lineType:
      "journal",

    description:
      clean(
        description ||
        memo ||
        accountName ||
        accountCode ||
        "JOURNAL LINE"
      ),

    category:
      "general-ledger",

    costCode:
      clean(
        accountCode
      ),

    quantity:
      1,

    rate:
      amount,

    amount,

    currency:
      normalizeCurrency(
        currency
      ),

    /*
     * Journal lines are accounting entries,
     * not new operating cashflow.
     *
     * The accounting side is carried by
     * debit / credit below.
     */
    direction:
      "neutral",

    occurredAt:
      clean(
        occurredAt
      ) ||
      nowIso(),

    references:
      normalizeReferences(
        references
      ),

    accountCode:
      clean(
        accountCode
      ),

    accountName:
      clean(
        accountName
      ),

    debit:
      resolvedDebit,

    credit:
      resolvedCredit,

    dimensions:
      safeObject(
        dimensions
      ),

    memo:
      clean(
        memo
      ),

    metadata: {
      ...safeObject(
        metadata
      ),

      accountingSide:
        resolvedDebit > 0
          ? "debit"
          : (
              resolvedCredit > 0
                ? "credit"
                : ""
            )
    }
  };
}


/* =========================================================
   JOURNAL DOCUMENT
   ========================================================= */

function createJournalEntryDocument({
  financialDocumentId = "",
  documentNumber = "",
  documentDate = "",
  occurredAt = "",
  period = "",
  currency = "USD",
  financialState = "posted",
  status = "posted",
  description = "",
  memo = "",

  sourceFinancialDocumentId = "",
  sourceDocumentType = "",
  sourceDocumentNumber = "",

  postingRuleId = "",
  postingRuleVersion = "",

  lines = [],
  dimensions = {},

  totalDebit = null,
  totalCredit = null,

  references = [],
  sourceSystem = "ixi-transact-general-ledger",
  sourceDocumentId = "",
  externalReference = "",
  metadata = {}
} = {}) {

  const resolvedDocumentId =
    clean(
      financialDocumentId
    ) ||
    randomId(
      "ifd"
    );

  const resolvedCurrency =
    normalizeCurrency(
      currency
    );

  const resolvedOccurredAt =
    clean(
      occurredAt ||
      documentDate
    ) ||
    nowIso();

  const normalizedReferences =
    normalizeReferences(
      references
    );

  const resolvedLines =
    safeArray(
      lines
    ).map(
      line =>
        createJournalEntryLine({
          ...safeObject(
            line
          ),

          financialDocumentId:
            resolvedDocumentId,

          currency:
            line?.currency ||
            resolvedCurrency,

          occurredAt:
            line?.occurredAt ||
            resolvedOccurredAt,

          references:
            line?.references ||
            normalizedReferences,

          dimensions:
            line?.dimensions ||
            dimensions
        })
    );


  const calculatedDebit =
    money(
      resolvedLines.reduce(
        (
          total,
          line
        ) =>
          total +
          number(
            line.debit
          ),
        0
      )
    );


  const calculatedCredit =
    money(
      resolvedLines.reduce(
        (
          total,
          line
        ) =>
          total +
          number(
            line.credit
          ),
        0
      )
    );


  const resolvedDebit =
    totalDebit === null ||
    totalDebit === undefined
      ? calculatedDebit
      : money(
          totalDebit
        );


  const resolvedCredit =
    totalCredit === null ||
    totalCredit === undefined
      ? calculatedCredit
      : money(
          totalCredit
        );


  if (
    resolvedLines.length <
      2
  ) {
    const error =
      new Error(
        "Journal Entry requires at least two accounting lines."
      );

    error.name =
      "IXIFinancialJournalEntryError";

    throw error;
  }


  if (
    resolvedDebit <= 0 ||
    resolvedCredit <= 0 ||
    resolvedDebit !==
      resolvedCredit
  ) {
    const error =
      new Error(
        `Journal Entry is unbalanced: debits ${resolvedDebit}, credits ${resolvedCredit}.`
      );

    error.name =
      "IXIFinancialJournalEntryBalanceError";

    throw error;
  }


  /*
   * Canonical Financial totals are zero.
   *
   * A Journal Entry does NOT create another
   * economic event on top of its source
   * Financial Document.
   *
   * Debit / credit accounting totals live
   * separately below.
   */
  return {
    financialDocumentId:
      resolvedDocumentId,

    documentType:
      "journal-entry",

    documentNumber:
      clean(
        documentNumber
      ),

    financialState:
      clean(
        financialState ||
        "posted"
      ).toLowerCase(),

    currency:
      resolvedCurrency,

    occurredAt:
      resolvedOccurredAt,

    documentDate:
      clean(
        documentDate
      ),

    period:
      clean(
        period
      ),

    status:
      clean(
        status ||
        "posted"
      ).toLowerCase(),

    description:
      clean(
        description
      ),

    memo:
      clean(
        memo
      ),

    paymentMethod:
      "",

    sourceSystem:
      clean(
        sourceSystem
      ),

    sourceDocumentId:
      clean(
        sourceDocumentId ||
        sourceFinancialDocumentId
      ),

    externalReference:
      clean(
        externalReference
      ),

    references:
      normalizedReferences,

    /*
     * Preserve canonical Financial lines,
     * but zero their economic amount before
     * persistence so journals cannot double
     * count the source event in operating
     * Financial snapshots.
     */
    lines:
      resolvedLines.map(
        line => ({
          ...line,

          amount:
            0,

          rate:
            0,

          direction:
            "neutral"
        })
      ),

    totals: {
      subtotal:
        0,

      total:
        0,

      debit:
        resolvedDebit,

      credit:
        resolvedCredit
    },

    accounting: {
      balanced:
        true,

      totalDebit:
        resolvedDebit,

      totalCredit:
        resolvedCredit
    },

    sourceFinancialDocumentId:
      clean(
        sourceFinancialDocumentId
      ),

    sourceDocumentType:
      clean(
        sourceDocumentType
      ),

    sourceDocumentNumber:
      clean(
        sourceDocumentNumber
      ),

    postingRuleId:
      clean(
        postingRuleId
      ),

    postingRuleVersion:
      clean(
        postingRuleVersion
      ),

    dimensions:
      safeObject(
        dimensions
      ),

    metadata: {
      ...safeObject(
        metadata
      ),

      transactModule:
        clean(
          metadata
            ?.transactModule ||
          "general-ledger"
        ),

      accountingDocument:
        true
    }
  };
}


module.exports = {
  createJournalEntryLine,
  createJournalEntryDocument
};
