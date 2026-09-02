"use strict";

/*
 * IXI FINANCIAL GENERAL LEDGER PROJECTION ENGINE
 *
 * PURPOSE
 * -------
 *
 * Convert canonical persisted IXI Financial
 * Journal Entry documents into server-calculated:
 *
 * - journal
 * - trial balance
 * - profit & loss
 * - balance sheet
 * - period status
 * - accounting controls
 *
 * This engine NEVER persists accounting truth.
 * It projects immutable truth already persisted
 * in AWS IXI Financial.
 */


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


function num(value) {
  const resolved =
    Number(value);

  return Number.isFinite(resolved)
    ? resolved
    : 0;
}


function money(value) {
  return Math.round(
    (
      num(value) +
      Number.EPSILON
    ) * 100
  ) / 100;
}


/* =========================================================
   SERVER CHART OF ACCOUNTS
   ========================================================= */

const IXI_GL_DEFAULT_ACCOUNTS =
  Object.freeze([
    {
      code: "1010",
      name: "Operating Checking",
      type: "asset",
      control: "cash"
    },
    {
      code: "1020",
      name: "Payroll Checking",
      type: "asset",
      control: "cash"
    },
    {
      code: "1050",
      name: "Petty Cash",
      type: "asset",
      control: "cash"
    },
    {
      code: "1100",
      name: "Accounts Receivable",
      type: "asset",
      control: "ar"
    },
    {
      code: "1200",
      name: "Inventory",
      type: "asset",
      control: "inventory"
    },
    {
      code: "1510",
      name: "Equipment Acquisition Basis",
      type: "asset",
      control: "fixed-asset"
    },
    {
      code: "1520",
      name: "Capitalized Improvements",
      type: "asset",
      control: "fixed-asset"
    },
    {
      code: "1600",
      name: "Accumulated Depreciation",
      type: "contra-asset",
      control: "fixed-asset"
    },
    {
      code: "2000",
      name: "Accounts Payable",
      type: "liability",
      control: "ap"
    },
    {
      code: "2100",
      name: "Credit Cards Payable",
      type: "liability",
      control: "credit-card"
    },
    {
      code: "2200",
      name: "Loans Payable",
      type: "liability",
      control: "debt"
    },
    {
      code: "3000",
      name: "Equity",
      type: "equity",
      control: "equity"
    },
    {
      code: "4100",
      name: "Equipment Sales",
      type: "revenue",
      control: "revenue"
    },
    {
      code: "4200",
      name: "Rental Revenue",
      type: "revenue",
      control: "revenue"
    },
    {
      code: "4300",
      name: "Service Revenue",
      type: "revenue",
      control: "revenue"
    },
    {
      code: "5100",
      name: "Cost of Equipment Sold",
      type: "expense",
      control: "cogs"
    },
    {
      code: "6110",
      name: "Repairs & Maintenance",
      type: "expense",
      control: "expense"
    },
    {
      code: "6120",
      name: "Bank Fees",
      type: "expense",
      control: "expense"
    },
    {
      code: "6200",
      name: "Fuel",
      type: "expense",
      control: "expense"
    },
    {
      code: "6300",
      name: "Freight",
      type: "expense",
      control: "expense"
    },
    {
      code: "6400",
      name: "Technology",
      type: "expense",
      control: "expense"
    },
    {
      code: "6900",
      name: "Other Operating Expense",
      type: "expense",
      control: "expense"
    },
    {
      code: "6990",
      name: "Unclassified / Review",
      type: "expense",
      control: "suspense"
    }
  ]);


function createChartMap(
  accounts =
    IXI_GL_DEFAULT_ACCOUNTS
) {
  const map =
    new Map();

  safeArray(
    accounts
  ).forEach(account => {
    const source =
      safeObject(
        account
      );

    const code =
      clean(
        source.code
      );

    if (code) {
      map.set(
        code,
        {
          code,
          name:
            clean(
              source.name
            ),
          type:
            clean(
              source.type
            ),
          control:
            clean(
              source.control
            )
        }
      );
    }
  });

  return map;
}


/* =========================================================
   DOCUMENT NORMALIZATION
   ========================================================= */

function unwrapFinancialDocument(
  value
) {
  const source =
    safeObject(
      value
    );

  return safeObject(
    source.financialDocument ||
    source.record
      ?.financialDocument ||
    source
  );
}


function resolveDocumentAccountingPeriod(
  financialDocument = {}
) {
  const document =
    safeObject(
      financialDocument
    );


  const explicitPeriod =
    clean(
      document.period
    );


  if (
    /^\d{4}-\d{2}$/.test(
      explicitPeriod
    )
  ) {
    return explicitPeriod;
  }


  const dateCandidates = [
    document.occurredAt,
    document.documentDate
  ];


  for (
    const candidate
    of dateCandidates
  ) {
    const value =
      clean(
        candidate
      );


    const match =
      value.match(
        /^(\d{4}-\d{2})/
      );


    if (
      match
    ) {
      return match[1];
    }
  }


  return "";
}


function documentMatchesCurrency(
  financialDocument,
  currency
) {
  return (
    clean(
      financialDocument
        ?.currency ||
      "USD"
    ).toUpperCase() ===
      clean(
        currency ||
        "USD"
      ).toUpperCase()
  );
}


function documentIsInPeriod(
  financialDocument,
  period
) {
  const requestedPeriod =
    clean(
      period
    );


  if (
    !requestedPeriod
  ) {
    return true;
  }


  return (
    resolveDocumentAccountingPeriod(
      financialDocument
    ) ===
      requestedPeriod
  );
}


function documentIsThroughPeriod(
  financialDocument,
  period
) {
  const requestedPeriod =
    clean(
      period
    );


  if (
    !requestedPeriod
  ) {
    return true;
  }


  const documentPeriod =
    resolveDocumentAccountingPeriod(
      financialDocument
    );


  if (
    !documentPeriod
  ) {
    return false;
  }


  /*
   * YYYY-MM is lexically sortable.
   */
  return (
    documentPeriod <=
      requestedPeriod
  );
}


function uniqueDocuments(
  records = []
) {
  const map =
    new Map();

  safeArray(
    records
  ).forEach(record => {
    const document =
      unwrapFinancialDocument(
        record
      );

    const id =
      clean(
        document
          .financialDocumentId
      );

    if (id) {
      map.set(
        id,
        document
      );
    }
  });

  return Array.from(
    map.values()
  );
}


/* =========================================================
   ACCOUNT BALANCES
   ========================================================= */

function buildTrialBalance({
  journals = [],
  chart =
    IXI_GL_DEFAULT_ACCOUNTS
} = {}) {
  const chartMap =
    createChartMap(
      chart
    );

  const balances =
    new Map();


  safeArray(
    journals
  ).forEach(document => {
    safeArray(
      document.lines
    ).forEach(line => {
      const accountCode =
        clean(
          line?.accountCode
        ) ||
        "6990";

      const configured =
        chartMap.get(
          accountCode
        ) ||
        {
          code:
            accountCode,
          name:
            clean(
              line?.accountName
            ) ||
            "Unclassified / Review",
          type:
            "expense",
          control:
            "suspense"
        };

      const current =
        balances.get(
          accountCode
        ) ||
        {
          accountCode,
          accountName:
            configured.name,
          accountType:
            configured.type,
          control:
            configured.control,
          debit:
            0,
          credit:
            0
        };

      current.debit =
        money(
          current.debit +
          num(
            line?.debit
          )
        );

      current.credit =
        money(
          current.credit +
          num(
            line?.credit
          )
        );

      balances.set(
        accountCode,
        current
      );
    });
  });


  const rows =
    Array.from(
      balances.values()
    )
      .map(row => ({
        ...row,

        balance:
          money(
            row.debit -
            row.credit
          )
      }))
      .sort(
        (
          a,
          b
        ) =>
          a.accountCode.localeCompare(
            b.accountCode
          )
      );


  const debits =
    money(
      rows.reduce(
        (
          total,
          row
        ) =>
          total +
          row.debit,
        0
      )
    );


  const credits =
    money(
      rows.reduce(
        (
          total,
          row
        ) =>
          total +
          row.credit,
        0
      )
    );


  return {
    rows,

    debits,

    credits,

    difference:
      money(
        debits -
        credits
      ),

    balanced:
      Math.abs(
        debits -
        credits
      ) <
        0.005
  };
}


/* =========================================================
   PROFIT & LOSS
   ========================================================= */

function buildProfitAndLoss(
  trialBalance
) {
  const rows =
    safeArray(
      trialBalance
        ?.rows
    );


  const revenueRows =
    rows.filter(
      row =>
        row.accountType ===
          "revenue"
    );


  const expenseRows =
    rows.filter(
      row =>
        row.accountType ===
          "expense"
    );


  const revenue =
    money(
      revenueRows.reduce(
        (
          total,
          row
        ) =>
          total +
          (
            row.credit -
            row.debit
          ),
        0
      )
    );


  const cogs =
    money(
      expenseRows
        .filter(
          row =>
            row.control ===
              "cogs"
        )
        .reduce(
          (
            total,
            row
          ) =>
            total +
            (
              row.debit -
              row.credit
            ),
          0
        )
    );


  const operatingExpense =
    money(
      expenseRows
        .filter(
          row =>
            row.control !==
              "cogs"
        )
        .reduce(
          (
            total,
            row
          ) =>
            total +
            (
              row.debit -
              row.credit
            ),
          0
        )
    );


  const grossProfit =
    money(
      revenue -
      cogs
    );


  const netIncome =
    money(
      grossProfit -
      operatingExpense
    );


  return {
    revenue,
    cogs,
    grossProfit,
    operatingExpense,
    netIncome,

    revenueAccounts:
      revenueRows,

    expenseAccounts:
      expenseRows
  };
}


/* =========================================================
   BALANCE SHEET
   ========================================================= */

function buildBalanceSheet({
  trialBalance,
  profitAndLoss
} = {}) {
  const rows =
    safeArray(
      trialBalance
        ?.rows
    );


  const assetRows =
    rows.filter(
      row =>
        row.accountType ===
          "asset" ||
        row.accountType ===
          "contra-asset"
    );


  const liabilityRows =
    rows.filter(
      row =>
        row.accountType ===
          "liability"
    );


  const equityRows =
    rows.filter(
      row =>
        row.accountType ===
          "equity"
    );


  const assets =
    money(
      assetRows.reduce(
        (
          total,
          row
        ) => {
          const amount =
            row.accountType ===
              "contra-asset"
              ? row.credit -
                row.debit
              : row.debit -
                row.credit;

          return total +
            (
              row.accountType ===
                "contra-asset"
                ? -amount
                : amount
            );
        },
        0
      )
    );


  const liabilities =
    money(
      liabilityRows.reduce(
        (
          total,
          row
        ) =>
          total +
          (
            row.credit -
            row.debit
          ),
        0
      )
    );


  const contributedEquity =
    money(
      equityRows.reduce(
        (
          total,
          row
        ) =>
          total +
          (
            row.credit -
            row.debit
          ),
        0
      )
    );


  const currentEarnings =
    money(
      profitAndLoss
        ?.netIncome
    );


  const equity =
    money(
      contributedEquity +
      currentEarnings
    );


  const liabilitiesAndEquity =
    money(
      liabilities +
      equity
    );


  const difference =
    money(
      assets -
      liabilitiesAndEquity
    );


  return {
    assets,
    liabilities,
    contributedEquity,
    currentEarnings,
    equity,
    liabilitiesAndEquity,
    difference,

    balanced:
      Math.abs(
        difference
      ) <
        0.005,

    assetAccounts:
      assetRows,

    liabilityAccounts:
      liabilityRows,

    equityAccounts:
      equityRows
  };
}


/* =========================================================
   PERIOD
   ========================================================= */

function resolvePeriodStatus({
  period = "",
  periodCloseDocuments = []
} = {}) {
  const matching =
    safeArray(
      periodCloseDocuments
    )
      .filter(
        document =>
          clean(
            document.period
          ) ===
            clean(
              period
            ) &&
          clean(
            document.status
          ).toLowerCase() ===
            "closed"
      )
      .sort(
        (
          a,
          b
        ) =>
          clean(
            b.closedAt ||
            b.occurredAt
          ).localeCompare(
            clean(
              a.closedAt ||
              a.occurredAt
            )
          )
      );


  const latest =
    matching[0] ||
    null;


  return {
    period:
      clean(
        period
      ),

    status:
      latest
        ? "closed"
        : "open",

    closed:
      Boolean(
        latest
      ),

    closedAt:
      clean(
        latest
          ?.closedAt
      ),

    closedBy:
      clean(
        latest
          ?.closedBy
      ),

    closeDocumentId:
      clean(
        latest
          ?.financialDocumentId
      )
  };
}


/* =========================================================
   MASTER GL PROJECTION
   ========================================================= */

function buildFinancialGLProjection({
  records = [],
  period = "",
  currency = "USD",
  chart =
    IXI_GL_DEFAULT_ACCOUNTS
} = {}) {
  const documents =
    uniqueDocuments(
      records
    );


  const resolvedCurrency =
    clean(
      currency ||
      "USD"
    ).toUpperCase();


  const resolvedPeriod =
    clean(
      period
    );


  /*
   * =======================================================
   * ACCOUNTING POPULATIONS
   * =======================================================
   *
   * periodDocuments
   * ----------------
   * Activity belonging specifically to the requested
   * accounting period.
   *
   * Used for:
   *
   * - period counts
   * - journal register
   * - period Trial Balance
   * - period P&L
   * - period close state
   *
   *
   * throughPeriodDocuments
   * ----------------------
   * All accounting activity through the end of the
   * requested period.
   *
   * Used for:
   *
   * - ending Trial Balance
   * - cumulative earnings
   * - Balance Sheet
   *
   * Company ownership was already selected by the
   * Entity Financial estate before this projection.
   */


  const currencyDocuments =
    documents.filter(
      document =>
        documentMatchesCurrency(
          document,
          resolvedCurrency
        )
    );


  const periodDocuments =
    currencyDocuments.filter(
      document =>
        documentIsInPeriod(
          document,
          resolvedPeriod
        )
    );


  const throughPeriodDocuments =
    currencyDocuments.filter(
      document =>
        documentIsThroughPeriod(
          document,
          resolvedPeriod
        )
    );


  /*
   * =======================================================
   * PERIOD JOURNALS
   * =======================================================
   */

  const isPostedJournal =
    document =>
      clean(
        document?.documentType
      ) === "journal-entry" &&
      clean(
        document?.financialState
      ) === "posted" &&
      clean(
        document?.status
      ) === "posted";


  const journals =
    periodDocuments.filter(
      isPostedJournal
    );


  /*
   * =======================================================
   * ENDING / THROUGH-PERIOD JOURNALS
   * =======================================================
   */

  const throughPeriodJournals =
    throughPeriodDocuments.filter(
      isPostedJournal
    );


  /*
   * =======================================================
   * PERIOD CLOSE
   * =======================================================
   */

  const periodCloseDocuments =
    periodDocuments.filter(
      document =>
        clean(
          document.documentType
        ) ===
          "period-close"
    );


  /*
   * =======================================================
   * PERIOD ACCOUNTING
   * =======================================================
   */

  const trialBalance =
    buildTrialBalance({
      journals,
      chart
    });


  const profitAndLoss =
    buildProfitAndLoss(
      trialBalance
    );


  /*
   * =======================================================
   * ENDING ACCOUNTING POSITION
   * =======================================================
   *
   * Until formal income-statement closing entries are
   * persisted, cumulative revenue / expense activity
   * remains in the ending Trial Balance.
   *
   * Therefore cumulative earnings MUST be derived from
   * the same through-period population used by the
   * Balance Sheet.
   */

  const endingTrialBalance =
    buildTrialBalance({
      journals:
        throughPeriodJournals,

      chart
    });


  const cumulativeProfitAndLoss =
    buildProfitAndLoss(
      endingTrialBalance
    );


  const balanceSheet =
    buildBalanceSheet({
      trialBalance:
        endingTrialBalance,

      profitAndLoss:
        cumulativeProfitAndLoss
    });


  /*
   * =======================================================
   * PERIOD STATE
   * =======================================================
   */

  const periodStatus =
    resolvePeriodStatus({
      period:
        resolvedPeriod,

      periodCloseDocuments
    });


  /*
   * =======================================================
   * CONTROLS
   * =======================================================
   */

  const postingExceptions =
    journals.filter(
      document =>
        !document
          ?.accounting
          ?.balanced
    );


  const endingPostingExceptions =
    throughPeriodJournals.filter(
      document =>
        !document
          ?.accounting
          ?.balanced
    );


  return {
    schema:
      "ixi-financial-gl-projection-v2",

    generatedAt:
      new Date()
        .toISOString(),

    period:
      periodStatus,

    currency:
      resolvedCurrency,


    counts: {
      sourceDocuments:
        periodDocuments.length,

      journals:
        journals.length,

      periodCloses:
        periodCloseDocuments.length,

      postingExceptions:
        postingExceptions.length,

      throughPeriodDocuments:
        throughPeriodDocuments.length,

      throughPeriodJournals:
        throughPeriodJournals.length
    },


    /*
     * Period activity.
     */
    journal:
      journals,

    trialBalance,

    profitAndLoss,


    /*
     * Ending accounting position.
     */
    endingTrialBalance,

    cumulativeProfitAndLoss,

    balanceSheet,


    controls: {
      journalBalanced:
        trialBalance.balanced,

      endingTrialBalanceBalanced:
        endingTrialBalance.balanced,

      balanceSheetBalanced:
        balanceSheet.balanced,

      postingExceptions:
        postingExceptions.length,

      endingPostingExceptions:
        endingPostingExceptions.length,

      ready:
        trialBalance.balanced &&
        endingTrialBalance.balanced &&
        balanceSheet.balanced &&
        postingExceptions.length ===
          0 &&
        endingPostingExceptions.length ===
          0
    }
  };
}

module.exports = {
  IXI_GL_DEFAULT_ACCOUNTS,

  buildTrialBalance,
  buildProfitAndLoss,
  buildBalanceSheet,
  buildFinancialGLProjection
};
