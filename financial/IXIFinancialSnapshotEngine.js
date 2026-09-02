"use strict";

/*
 * IXI FINANCIAL SNAPSHOT ENGINE
 *
 * PURPOSE
 * -------
 *
 * Build Passport-scoped and recursive-scope
 * financial snapshots from canonical IXI
 * Financial Documents.
 *
 *
 * OUTPUT CONTRACT
 * ---------------
 *
 * {
 *   financialSnapshot,
 *   lifecycleSnapshot,
 *   recentActivity
 * }
 *
 *
 * This is the exact server package consumed
 * by the AOF2 Financial Face adapter.
 *
 *
 * CORE RULE
 * ---------
 *
 * ONE FINANCIAL FACT MAY BE REFERENCED BY
 * MULTIPLE PASSPORTS.
 *
 * WITHIN ONE REQUESTED SCOPE IT MUST BE
 * COUNTED ONCE.
 *
 *
 * Example:
 *
 * $680 expense references:
 *
 * machine passport
 * job passport
 *
 * recursive Entity scope contains:
 *
 * machine
 * job
 *
 * ENTITY TOTAL:
 *
 * $680
 *
 * NOT:
 *
 * $1,360
 *
 *
 * RESPONSIBILITIES
 * ----------------
 *
 * - load persisted documents by Passport
 * - deduplicate documents
 * - deduplicate financial lines / facts
 * - filter by date
 * - filter by currency
 * - calculate inflow/outflow
 * - group by financial state
 * - group by line type
 * - group by document type
 * - lifecycle calculation
 * - recent activity
 * - Passport snapshots
 * - recursive scope snapshots
 *
 *
 * DOES NOT
 * --------
 *
 * - discover hierarchy
 * - authorize
 * - persist
 * - modify documents
 */


const {
  createFinancialLifecycleSnapshot
} =
  require(
    "./IXIFinancialLifecycleEngine"
  );


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


function safeArray(
  value
) {
  return Array.isArray(
    value
  )
    ? value
    : [];
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


function safeNumber(
  value,
  fallback = 0
) {
  const number =
    Number(
      value
    );

  return Number.isFinite(
    number
  )
    ? number
    : fallback;
}


function roundMoney(
  value
) {
  return Math.round(
    (
      safeNumber(
        value,
        0
      ) +
      Number.EPSILON
    ) *
    100
  ) / 100;
}


function normalizeCurrency(
  value
) {
  const currency =
    clean(
      value ||
      "USD"
    ).toUpperCase();

  return /^[A-Z]{3}$/.test(
    currency
  )
    ? currency
    : "USD";
}


function normalizeType(
  value
) {
  return clean(
    value
  ).toLowerCase();
}


function normalizeState(
  value
) {
  return clean(
    value ||
    "draft"
  ).toLowerCase();
}


function dateToTime(
  value
) {
  const text =
    clean(
      value
    );

  if (
    !text
  ) {
    return null;
  }

  const time =
    new Date(
      text
    ).getTime();

  return Number.isNaN(
    time
  )
    ? null
    : time;
}


/* =========================================================
   DOCUMENT EXTRACTION
   ========================================================= */

function unwrapFinancialRecord(
  value
) {
  const source =
    safeObject(
      value
    );

  return source.financialDocument
    ? safeObject(
        source.financialDocument
      )
    : source;
}


/* =========================================================
   DOCUMENT ID
   ========================================================= */

function getFinancialDocumentId(
  document
) {
  return clean(
    unwrapFinancialRecord(
      document
    )
      ?.financialDocumentId
  );
}


/* =========================================================
   LINE ID / FACT KEY
   ========================================================= */

function getFinancialLineFactKey({
  document = {},
  line = {},
  lineIndex = 0
} = {}) {
  const financialLineId =
    clean(
      line
        ?.financialLineId
    );

  if (
    financialLineId
  ) {
    return financialLineId;
  }

  const financialDocumentId =
    getFinancialDocumentId(
      document
    );

  return [
    financialDocumentId ||
      "document",
    "line",
    lineIndex
  ].join(":");
}


/* =========================================================
   DOCUMENT DATE
   ========================================================= */

function getFinancialDocumentDate(
  document = {}
) {
  const source =
    unwrapFinancialRecord(
      document
    );

  return clean(
    source.occurredAt ||
    source.transactionDate ||
    source.createdAt ||
    source.updatedAt
  );
}


/* =========================================================
   LINE DATE
   ========================================================= */

function getFinancialLineDate({
  document = {},
  line = {}
} = {}) {
  return clean(
    line.occurredAt ||
    line.transactionDate ||
    getFinancialDocumentDate(
      document
    )
  );
}


/* =========================================================
   PERIOD FILTER
   ========================================================= */

function isDateInPeriod(
  value,
  {
    startAt = "",
    endAt = ""
  } = {}
) {
  const valueTime =
    dateToTime(
      value
    );

  const startTime =
    dateToTime(
      startAt
    );

  const endTime =
    dateToTime(
      endAt
    );

  /*
   * Undated facts remain eligible when no
   * explicit period was requested.
   */
  if (
    valueTime === null
  ) {
    return (
      startTime === null &&
      endTime === null
    );
  }

  if (
    startTime !== null &&
    valueTime <
      startTime
  ) {
    return false;
  }

  if (
    endTime !== null &&
    valueTime >
      endTime
  ) {
    return false;
  }

  return true;
}


/* =========================================================
   UNIQUE DOCUMENTS
   ========================================================= */

function deduplicateFinancialDocuments(
  records = []
) {
  const map =
    new Map();

  safeArray(
    records
  ).forEach(
    record => {
      const document =
        unwrapFinancialRecord(
          record
        );

      const id =
        clean(
          document
            ?.financialDocumentId
        );

      if (
        !id
      ) {
        return;
      }

      /*
       * Same document may arrive from several
       * Passport indexes.
       *
       * One document ID = one current doc.
       */
      if (
        !map.has(
          id
        )
      ) {
        map.set(
          id,
          document
        );
      }
    }
  );

  return Array.from(
    map.values()
  );
}


/* =========================================================
   LOAD DOCUMENTS FOR PASSPORTS
   ========================================================= */

/*
 * STORAGE NOTE
 * ------------
 *
 * Snapshot Engine is calculation-only.
 *
 * Financial Documents MUST be loaded through
 * IXIFinancialProviderService and supplied to
 * the canonical calculation functions below.
 */


/* =========================================================
   DOCUMENT PERIOD FILTER
   ========================================================= */

function filterFinancialDocumentsForPeriod(
  documents = [],
  {
    startAt = "",
    endAt = ""
  } = {}
) {
  if (
    !clean(
      startAt
    ) &&
    !clean(
      endAt
    )
  ) {
    return safeArray(
      documents
    );
  }

  return safeArray(
    documents
  ).filter(
    document =>
      isDateInPeriod(
        getFinancialDocumentDate(
          document
        ),
        {
          startAt,
          endAt
        }
      )
  );
}


/* =========================================================
   FACT CREATION
   ========================================================= */

function createFinancialFacts(
  documents = [],
  {
    startAt = "",
    endAt = ""
  } = {}
) {
  const factsByKey =
    new Map();

  safeArray(
    documents
  ).forEach(
    document => {
      const source =
        unwrapFinancialRecord(
          document
        );

      const financialDocumentId =
        clean(
          source
            ?.financialDocumentId
        );

      const documentType =
        normalizeType(
          source
            ?.documentType
        );

      const financialState =
        normalizeState(
          source
            ?.financialState
        );

      const documentNumber =
        clean(
          source
            ?.documentNumber
        );

      const documentCurrency =
        normalizeCurrency(
          source
            ?.currency
        );

      safeArray(
        source.lines
      ).forEach(
        (
          line,
          lineIndex
        ) => {
          const occurredAt =
            getFinancialLineDate({
              document:
                source,

              line
            });

          if (
            !isDateInPeriod(
              occurredAt,
              {
                startAt,
                endAt
              }
            )
          ) {
            return;
          }

          const factKey =
            getFinancialLineFactKey({
              document:
                source,

              line,

              lineIndex
            });

          /*
           * This is the recursion protection.
           *
           * Same line reached from Machine,
           * Job, Container, etc. still has
           * one fact key and is counted once.
           */
          if (
            factsByKey.has(
              factKey
            )
          ) {
            return;
          }

          const direction =
            normalizeType(
              line
                ?.direction ||
              "neutral"
            );

          const amount =
            roundMoney(
              Math.abs(
                safeNumber(
                  line
                    ?.amount,
                  0
                )
              )
            );

          const currency =
            normalizeCurrency(
              line
                ?.currency ||
              documentCurrency
            );

          factsByKey.set(
            factKey,
            {
              factKey,

              financialDocumentId,

              financialLineId:
                clean(
                  line
                    ?.financialLineId
                ),

              documentType,

              documentNumber,

              financialState,

              lineType:
                normalizeType(
                  line
                    ?.lineType ||
                  "unknown"
                ),

              description:
                clean(
                  line
                    ?.description ||
                  source
                    ?.description ||
                  source
                    ?.title
                ),

              currency,

              direction,

              amount,

              occurredAt,

              references:
                safeArray(
                  line
                    ?.references
                ).length
                  ? safeArray(
                      line
                        ?.references
                    )
                  : safeArray(
                      source
                        ?.references
                    )
            }
          );
        }
      );
    }
  );

  return Array.from(
    factsByKey.values()
  );
}


/* =========================================================
   EMPTY BUCKET
   ========================================================= */

function createEmptyRollupBucket() {
  return {
    factCount:
      0,

    inflow:
      0,

    outflow:
      0,

    neutral:
      0,

    net:
      0
  };
}


/* =========================================================
   APPLY FACT TO BUCKET
   ========================================================= */

function applyFactToBucket(
  bucket,
  fact
) {
  const target =
    bucket ||
    createEmptyRollupBucket();

  const amount =
    roundMoney(
      fact
        ?.amount
    );

  const direction =
    normalizeType(
      fact
        ?.direction
    );

  target.factCount +=
    1;

  if (
    direction ===
      "inflow"
  ) {
    target.inflow =
      roundMoney(
        target.inflow +
        amount
      );
  } else if (
    direction ===
      "outflow"
  ) {
    target.outflow =
      roundMoney(
        target.outflow +
        amount
      );
  } else {
    target.neutral =
      roundMoney(
        target.neutral +
        amount
      );
  }

  target.net =
    roundMoney(
      target.inflow -
      target.outflow
    );

  return target;
}


/* =========================================================
   ROLLUP BY KEY
   ========================================================= */

function createFactBreakdown(
  facts = [],
  keyName
) {
  const result = {};

  safeArray(
    facts
  ).forEach(
    fact => {
      const key =
        clean(
          fact
            ?.[
              keyName
            ] ||
          "unknown"
        );

      if (
        !result[
          key
        ]
      ) {
        result[
          key
        ] =
          createEmptyRollupBucket();
      }

      applyFactToBucket(
        result[
          key
        ],
        fact
      );

      result[
        key
      ][
        keyName
      ] =
        key;
    }
  );

  return result;
}


/* =========================================================
   DOCUMENT TYPE BREAKDOWN
   ========================================================= */

function createDocumentTypeBreakdown(
  facts = []
) {
  const result = {};

  safeArray(
    facts
  ).forEach(
    fact => {
      const type =
        clean(
          fact
            ?.documentType ||
          "unknown"
        );

      if (
        !result[
          type
        ]
      ) {
        result[
          type
        ] = {
          documentType:
            type,

          factCount:
            0,

          documentIds:
            [],

          inflow:
            0,

          outflow:
            0,

          neutral:
            0,

          net:
            0
        };
      }

      const bucket =
        result[
          type
        ];

      applyFactToBucket(
        bucket,
        fact
      );

      const documentId =
        clean(
          fact
            ?.financialDocumentId
        );

      if (
        documentId &&
        !bucket.documentIds
          .includes(
            documentId
          )
      ) {
        bucket.documentIds.push(
          documentId
        );
      }
    }
  );

  return result;
}


/* =========================================================
   SINGLE CURRENCY ROLLUP
   ========================================================= */

function createCurrencyFinancialRollup(
  facts = [],
  currency = "USD"
) {
  const resolvedCurrency =
    normalizeCurrency(
      currency
    );

  const currencyFacts =
    safeArray(
      facts
    ).filter(
      fact =>
        normalizeCurrency(
          fact
            ?.currency
        ) ===
          resolvedCurrency
    );

  const total =
    createEmptyRollupBucket();

  currencyFacts.forEach(
    fact =>
      applyFactToBucket(
        total,
        fact
      )
  );

  const documentIds =
    Array.from(
      new Set(
        currencyFacts
          .map(
            fact =>
              clean(
                fact
                  ?.financialDocumentId
              )
          )
          .filter(
            Boolean
          )
      )
    );

  return {
    currency:
      resolvedCurrency,

    factCount:
      total.factCount,

    documentCount:
      documentIds.length,

    inflow:
      roundMoney(
        total.inflow
      ),

    outflow:
      roundMoney(
        total.outflow
      ),

    neutral:
      roundMoney(
        total.neutral
      ),

    net:
      roundMoney(
        total.net
      ),

    byFinancialState:
      createFactBreakdown(
        currencyFacts,
        "financialState"
      ),

    byLineType:
      createFactBreakdown(
        currencyFacts,
        "lineType"
      ),

    byDocumentType:
      createDocumentTypeBreakdown(
        currencyFacts
      )
  };
}


/* =========================================================
   FINANCIAL SNAPSHOT
   ========================================================= */

function createFinancialSnapshot({
  documents = [],
  startAt = "",
  endAt = "",
  includeFacts = true
} = {}) {
  const deduplicatedDocuments =
    deduplicateFinancialDocuments(
      documents
    );

  const facts =
    createFinancialFacts(
      deduplicatedDocuments,
      {
        startAt,
        endAt
      }
    );

  const currencies =
    Array.from(
      new Set(
        facts
          .map(
            fact =>
              normalizeCurrency(
                fact
                  ?.currency
              )
          )
          .filter(
            Boolean
          )
      )
    );

  const snapshots = {};

  currencies.forEach(
    currency => {
      snapshots[
        currency
      ] =
        createCurrencyFinancialRollup(
          facts,
          currency
        );
    }
  );

  return {
    startAt:
      clean(
        startAt
      ),

    endAt:
      clean(
        endAt
      ),

    currencies,

    snapshots,

    facts:
      includeFacts
        ? facts
        : []
  };
}


/* =========================================================
   RECENT ACTIVITY
   ========================================================= */

function createRecentFinancialActivity(
  facts = [],
  {
    limit = 3,
    currency = ""
  } = {}
) {
  const resolvedLimit =
    Math.max(
      0,
      Math.min(
        100,
        safeNumber(
          limit,
          3
        )
      )
    );

  const requestedCurrency =
    clean(
      currency
    )
      ? normalizeCurrency(
          currency
        )
      : "";

  return safeArray(
    facts
  )
    .filter(
      fact =>
        !requestedCurrency ||
        normalizeCurrency(
          fact
            ?.currency
        ) ===
          requestedCurrency
    )
    .slice()
    .sort(
      (
        a,
        b
      ) => {
        const aTime =
          dateToTime(
            a
              ?.occurredAt
          ) ||
          0;

        const bTime =
          dateToTime(
            b
              ?.occurredAt
          ) ||
          0;

        return (
          bTime -
          aTime
        );
      }
    )
    .slice(
      0,
      resolvedLimit
    )
    .map(
      fact => ({
        id:
          clean(
            fact
              ?.factKey
          ),

        financialDocumentId:
          clean(
            fact
              ?.financialDocumentId
          ),

        financialLineId:
          clean(
            fact
              ?.financialLineId
          ),

        documentType:
          clean(
            fact
              ?.documentType
          ),

        documentNumber:
          clean(
            fact
              ?.documentNumber
          ),

        lineType:
          clean(
            fact
              ?.lineType
          ),

        label:
          clean(
            fact
              ?.description ||
            fact
              ?.documentNumber ||
            fact
              ?.documentType ||
            fact
              ?.lineType ||
            "FINANCIAL ACTIVITY"
          ),

        occurredAt:
          clean(
            fact
              ?.occurredAt
          ),

        amount:
          safeNumber(
            fact
              ?.amount,
            0
          ),

        direction:
          clean(
            fact
              ?.direction
          ),

        currency:
          normalizeCurrency(
            fact
              ?.currency
          )
      })
    );
}


/* =========================================================
   AOF2 PACKAGE FROM DOCUMENTS
   ========================================================= */

function createAof2FinancialPackage({
  documents = [],
  currency = "USD",
  startAt = "",
  endAt = "",
  includeFacts = true,
  recentActivityLimit = 3
} = {}) {
  const resolvedCurrency =
    normalizeCurrency(
      currency
    );

  const deduplicatedDocuments =
    deduplicateFinancialDocuments(
      documents
    );

  /*
   * Lifecycle is calculated from unique
   * canonical documents.
   *
   * This is independent from raw fact totals.
   */
  const lifecycleDocuments =
    filterFinancialDocumentsForPeriod(
      deduplicatedDocuments,
      {
        startAt,
        endAt
      }
    );

  const financialSnapshot =
    createFinancialSnapshot({
      documents:
        deduplicatedDocuments,

      startAt,

      endAt,

      /*
       * We build facts internally regardless.
       * Keep them temporarily for activity.
       */
      includeFacts:
        true
    });

  const lifecycleSnapshot =
    createFinancialLifecycleSnapshot({
      documents:
        lifecycleDocuments,

      currency:
        resolvedCurrency
    });

  const recentActivity =
    createRecentFinancialActivity(
      financialSnapshot
        .facts,
      {
        limit:
          recentActivityLimit,

        currency:
          resolvedCurrency
      }
    );

  if (
    !includeFacts
  ) {
    financialSnapshot.facts =
      [];
  }

  return {
    currency:
      resolvedCurrency,

    financialSnapshot,

    lifecycleSnapshot,

    recentActivity
  };
}


/* =========================================================
   PASSPORT SNAPSHOT
   ========================================================= */

module.exports = {
  unwrapFinancialRecord,

  getFinancialDocumentId,
  getFinancialLineFactKey,

  getFinancialDocumentDate,
  getFinancialLineDate,

  isDateInPeriod,

  deduplicateFinancialDocuments,


  filterFinancialDocumentsForPeriod,

  createFinancialFacts,

  createCurrencyFinancialRollup,
  createFinancialSnapshot,

  createRecentFinancialActivity,

  createAof2FinancialPackage,

};
