"use strict";

/*
 * IXI FINANCIAL PERIOD CLOSE FACTORY
 *
 * Canonical immutable accounting-period close
 * evidence for AWS IXI Financial.
 *
 * A Period Close does NOT create an economic
 * inflow/outflow. It records accounting control
 * state and the evidence used to close a period.
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

      if (
        !passportId &&
        !externalId
      ) {
        return null;
      }

      const normalized = {
        ...source,

        passportId,

        externalId,

        role:
          clean(
            source.role
          ),

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

      const key =
        [
          normalized.passportId,
          normalized.externalId,
          normalized.role
        ].join("|");

      if (
        seen.has(key)
      ) {
        return null;
      }

      seen.add(key);

      return normalized;
    })
    .filter(Boolean);
}


function normalizeTrialBalance(
  rows = []
) {
  return safeArray(
    rows
  ).map(
    row => {
      const source =
        safeObject(
          row
        );

      return {
        ...source,

        accountCode:
          clean(
            source.accountCode ||
            source.code
          ),

        accountName:
          clean(
            source.accountName ||
            source.name
          ),

        debit:
          money(
            source.debit
          ),

        credit:
          money(
            source.credit
          ),

        balance:
          money(
            source.balance
          )
      };
    }
  );
}


function normalizeCloseChecks(
  checks = []
) {
  return safeArray(
    checks
  ).map(
    check => {
      const source =
        safeObject(
          check
        );

      return {
        ...source,

        id:
          clean(
            source.id
          ),

        label:
          clean(
            source.label
          ),

        ok:
          Boolean(
            source.ok
          ),

        detail:
          clean(
            source.detail
          )
      };
    }
  );
}


/* =========================================================
   PERIOD CLOSE DOCUMENT
   ========================================================= */

function createPeriodCloseDocument({
  financialDocumentId = "",
  documentNumber = "",
  documentDate = "",
  occurredAt = "",

  period = "",
  currency = "USD",

  financialState = "closed",
  status = "closed",

  closedAt = "",
  closedBy = "",

  trialBalance = [],
  closeChecks = [],

  postingRuleVersion = "",

  references = [],

  sourceSystem =
    "ixi-transact-general-ledger",

  sourceDocumentId = "",
  externalReference = "",

  metadata = {}
} = {}) {

  const resolvedPeriod =
    clean(
      period
    );

  if (
    !/^\d{4}-\d{2}$/.test(
      resolvedPeriod
    )
  ) {
    const error =
      new Error(
        "Period Close requires period in YYYY-MM format."
      );

    error.name =
      "IXIFinancialPeriodCloseError";

    throw error;
  }


  const resolvedStatus =
    clean(
      status ||
      "closed"
    ).toLowerCase();


  const resolvedState =
    clean(
      financialState ||
      "closed"
    ).toLowerCase();


  if (
    resolvedStatus !==
      "closed" ||
    resolvedState !==
      "closed"
  ) {
    const error =
      new Error(
        "Period Close must be in closed state."
      );

    error.name =
      "IXIFinancialPeriodCloseStateError";

    throw error;
  }


  const resolvedCloseChecks =
    normalizeCloseChecks(
      closeChecks
    );


  const failedChecks =
    resolvedCloseChecks.filter(
      check =>
        !check.ok
    );


  if (
    failedChecks.length
  ) {
    const error =
      new Error(
        `Period Close contains ${failedChecks.length} failed close control(s).`
      );

    error.name =
      "IXIFinancialPeriodCloseControlError";

    error.failedChecks =
      failedChecks;

    throw error;
  }


  const resolvedTrialBalance =
    normalizeTrialBalance(
      trialBalance
    );


  const trialDebit =
    money(
      resolvedTrialBalance.reduce(
        (
          total,
          row
        ) =>
          total +
          number(
            row.debit
          ),
        0
      )
    );


  const trialCredit =
    money(
      resolvedTrialBalance.reduce(
        (
          total,
          row
        ) =>
          total +
          number(
            row.credit
          ),
        0
      )
    );


  if (
    trialDebit !==
      trialCredit
  ) {
    const error =
      new Error(
        `Period Close trial balance is not balanced: debits ${trialDebit}, credits ${trialCredit}.`
      );

    error.name =
      "IXIFinancialPeriodCloseBalanceError";

    throw error;
  }


  const resolvedDocumentId =
    clean(
      financialDocumentId
    ) ||
    randomId(
      "ifd"
    );


  const resolvedClosedAt =
    clean(
      closedAt
    ) ||
    nowIso();


  const resolvedOccurredAt =
    clean(
      occurredAt ||
      documentDate ||
      resolvedClosedAt
    );


  return {
    financialDocumentId:
      resolvedDocumentId,

    documentType:
      "period-close",

    documentNumber:
      clean(
        documentNumber ||
        `CLOSE-${resolvedPeriod}`
      ),

    financialState:
      resolvedState,

    currency:
      normalizeCurrency(
        currency
      ),

    occurredAt:
      resolvedOccurredAt,

    documentDate:
      clean(
        documentDate
      ),

    period:
      resolvedPeriod,

    status:
      resolvedStatus,

    description:
      `ACCOUNTING PERIOD CLOSE ${resolvedPeriod}`,

    memo:
      "",

    paymentMethod:
      "",

    sourceSystem:
      clean(
        sourceSystem
      ),

    sourceDocumentId:
      clean(
        sourceDocumentId
      ),

    externalReference:
      clean(
        externalReference
      ),

    references:
      normalizeReferences(
        references
      ),

    /*
     * Period Close is control evidence,
     * not another economic event.
     */
    lines:
      [],

    totals: {
      subtotal:
        0,

      total:
        0
    },

    closedAt:
      resolvedClosedAt,

    closedBy:
      clean(
        closedBy
      ),

    trialBalance:
      resolvedTrialBalance,

    trialBalanceTotals: {
      debit:
        trialDebit,

      credit:
        trialCredit,

      difference:
        money(
          trialDebit -
          trialCredit
        )
    },

    closeChecks:
      resolvedCloseChecks,

    postingRuleVersion:
      clean(
        postingRuleVersion
      ),

    accounting: {
      period:
        resolvedPeriod,

      closed:
        true,

      controlsPassed:
        true,

      balanced:
        true
    },

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

      accountingControlDocument:
        true
    }
  };
}


module.exports = {
  createPeriodCloseDocument
};
