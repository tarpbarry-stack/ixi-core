"use strict";

/*
 * IXI FINANCIAL LIFECYCLE ENGINE
 *
 * PURPOSE
 * -------
 *
 * Converts canonical Financial Documents
 * into lifecycle economic state.
 *
 *
 * CORE PROBLEM
 * ------------
 *
 * A business process may contain:
 *
 * PO
 *   ↓
 * BILL
 *   ↓
 * PAYMENT
 *
 * Those are THREE documents describing
 * progression of economic reality.
 *
 * They must NOT automatically become three
 * independent costs.
 *
 *
 * THIS ENGINE TRACKS
 * ------------------
 *
 * commitment
 * remaining commitment
 * incurred cost
 * paid
 * unpaid
 *
 * revenue
 * collected
 * receivable
 *
 * projected outflow
 * operating net
 *
 *
 * IMPORTANT
 * ---------
 *
 * This engine:
 *
 * - consumes canonical IXI Financial docs
 * - does not discover AOS hierarchy
 * - does not persist
 * - does not authorize
 * - does not modify source documents
 *
 *
 * LINKING
 * -------
 *
 * Documents may be related through:
 *
 * parentFinancialDocumentId
 * sourceFinancialDocumentId
 * relatedFinancialDocumentIds
 *
 * or:
 *
 * relationships: [
 *   {
 *     financialDocumentId,
 *     relationshipType
 *   }
 * ]
 *
 *
 * Supported lifecycle chains include:
 *
 * PURCHASE ORDER
 *      ↓
 * BILL / SUPPLIER INVOICE
 *      ↓
 * PAYMENT
 *
 *
 * INVOICE
 *      ↓
 * PAYMENT
 */


/* =========================================================
   DOCUMENT TYPES
   ========================================================= */

const OUTFLOW_INCURRED_TYPES =
  new Set([
    "expense",
    "bill",
    "supplier-invoice",
    "work-order",
    "time-entry"
  ]);


const COMMITMENT_TYPES =
  new Set([
    "purchase-order",
    "rental-expense"
  ]);

const REVENUE_COMMITMENT_TYPES =
  new Set([
    "rental-income",
    "service-quote"
  ]);


const REVENUE_TYPES =
  new Set([
    "invoice"
  ]);


const PAYMENT_TYPES =
  new Set([
    "payment"
  ]);


const CREDIT_TYPES =
  new Set([
    "credit"
  ]);


/* =========================================================
   STATES
   ========================================================= */

const DEAD_STATES =
  new Set([
    "rejected",
    "void",
    "reversed"
  ]);


const DRAFT_STATES =
  new Set([
    "draft"
  ]);


const COMMITTED_STATES =
  new Set([
    "submitted",
    "approved",
    "committed"
  ]);


const INCURRED_STATES =
  new Set([
    "incurred",
    "billed",
    "partially-paid",
    "paid"
  ]);


const REVENUE_STATES =
  new Set([
    "billed",
    "partially-collected",
    "collected"
  ]);


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


/* =========================================================
   DOCUMENT TOTAL
   ========================================================= */

function getFinancialDocumentTotal(
  document = {}
) {
  const source =
    safeObject(
      document
    );

  const supplied =
    source
      ?.totals
      ?.total;

  if (
    supplied !== undefined &&
    supplied !== null &&
    Number.isFinite(
      Number(
        supplied
      )
    )
  ) {
    return roundMoney(
      supplied
    );
  }

  return roundMoney(
    safeArray(
      source.lines
    ).reduce(
      (
        total,
        line
      ) =>
        total +
        safeNumber(
          line?.amount,
          0
        ),
      0
    )
  );
}


/* =========================================================
   RELATIONSHIP EXTRACTION
   ========================================================= */

function getRelatedFinancialDocumentIds(
  document = {}
) {
  const source =
    safeObject(
      document
    );

  const ids =
    new Set();


  [
    source.parentFinancialDocumentId,
    source.sourceFinancialDocumentId
  ]
    .map(
      clean
    )
    .filter(
      Boolean
    )
    .forEach(
      id =>
        ids.add(
          id
        )
    );


  safeArray(
    source.relatedFinancialDocumentIds
  )
    .map(
      clean
    )
    .filter(
      Boolean
    )
    .forEach(
      id =>
        ids.add(
          id
        )
    );


  safeArray(
    source.relationships
  ).forEach(
    relationship => {
      const id =
        clean(
          relationship
            ?.financialDocumentId
        );

      if (
        id
      ) {
        ids.add(
          id
        );
      }
    }
  );


  return Array.from(
    ids
  );
}


/* =========================================================
   DIRECT SOURCE DOCUMENT
   ========================================================= */

function getSourceFinancialDocumentId(
  document = {}
) {
  const source =
    safeObject(
      document
    );

  const direct =
    clean(
      source.sourceFinancialDocumentId ||
      source.parentFinancialDocumentId
    );

  if (
    direct
  ) {
    return direct;
  }


  const preferred =
    safeArray(
      source.relationships
    ).find(
      relationship => {
        const type =
          clean(
            relationship
              ?.relationshipType
          ).toLowerCase();

        return (
          type === "source" ||
          type === "parent" ||
          type === "derived-from" ||
          type === "fulfills" ||
          type === "settles"
        );
      }
    );


  return clean(
    preferred
      ?.financialDocumentId
  );
}


/* =========================================================
   DOCUMENT INDEX
   ========================================================= */

function createFinancialDocumentIndex(
  documents = []
) {
  const map =
    new Map();


  safeArray(
    documents
  ).forEach(
    document => {
      const id =
        clean(
          document
            ?.financialDocumentId
        );

      if (
        id
      ) {
        map.set(
          id,
          document
        );
      }
    }
  );


  return map;
}


/* =========================================================
   CHILD INDEX
   ========================================================= */

function createFinancialChildIndex(
  documents = []
) {
  const childrenByParent =
    new Map();


  safeArray(
    documents
  ).forEach(
    document => {
      const childId =
        clean(
          document
            ?.financialDocumentId
        );

      if (
        !childId
      ) {
        return;
      }


      getRelatedFinancialDocumentIds(
        document
      ).forEach(
        parentId => {
          if (
            !childrenByParent.has(
              parentId
            )
          ) {
            childrenByParent.set(
              parentId,
              []
            );
          }

          childrenByParent
            .get(
              parentId
            )
            .push(
              document
            );
        }
      );
    }
  );


  return childrenByParent;
}


/* =========================================================
   ACTIVE DOCUMENT
   ========================================================= */

function isActiveFinancialDocument(
  document = {}
) {
  const state =
    normalizeState(
      document
        ?.financialState
    );

  return (
    !DEAD_STATES.has(
      state
    ) &&
    !DRAFT_STATES.has(
      state
    )
  );
}


/* =========================================================
   PAYMENT DIRECTION
   ========================================================= */

function getPaymentEconomicDirection(
  payment = {}
) {
  const source =
    safeObject(
      payment
    );


  const explicit =
    clean(
      source.paymentDirection ||
      source.direction
    ).toLowerCase();


  if (
    explicit === "inflow" ||
    explicit === "outflow"
  ) {
    return explicit;
  }


  const lineDirection =
    safeArray(
      source.lines
    )
      .map(
        line =>
          clean(
            line?.direction
          ).toLowerCase()
      )
      .find(
        direction =>
          direction === "inflow" ||
          direction === "outflow"
      );


  if (
    lineDirection
  ) {
    return lineDirection;
  }


  return "outflow";
}


/* =========================================================
   PAYMENT TOTALS
   ========================================================= */

function getPaymentSettlementEffect(
  payment = {}
) {
  const source =
    safeObject(
      payment
    );

  /* Treasury book events move or establish cash; they do not settle A/R or A/P. */
  if (clean(source?.treasuryMovement?.transactionClass)) {
    return {
      paid: 0,
      collected: 0
    };
  }


  if (
    !isActiveFinancialDocument(
      source
    )
  ) {
    return {
      paid:
        0,

      collected:
        0
    };
  }


  const amount =
    Math.abs(
      getFinancialDocumentTotal(
        source
      )
    );


  const direction =
    getPaymentEconomicDirection(
      source
    );


  const paymentKind =
    normalizeType(
      source.paymentKind ||
      source.settlementKind
    );


  const refundSide =
    normalizeType(
      source.refundSide
    );


  /*
   * REFUND
   *
   * Customer refund reverses collection.
   *
   * Vendor refund reverses amount paid.
   */
  if (
    paymentKind ===
      "refund"
  ) {

    if (
      refundSide ===
        "customer" ||
      refundSide ===
        "receivable"
    ) {
      return {
        paid:
          0,

        collected:
          roundMoney(
            -amount
          )
      };
    }


    if (
      refundSide ===
        "vendor" ||
      refundSide ===
        "payable"
    ) {
      return {
        paid:
          roundMoney(
            -amount
          ),

        collected:
          0
      };
    }


    /*
     * Defensive fallback if an imported
     * refund lacks refundSide.
     *
     * Outflow refund normally reverses
     * customer collection.
     *
     * Inflow refund normally reverses
     * vendor payment.
     */
    if (
      direction ===
        "outflow"
    ) {
      return {
        paid:
          0,

        collected:
          roundMoney(
            -amount
          )
      };
    }


    return {
      paid:
        roundMoney(
          -amount
        ),

      collected:
        0
    };
  }


  /*
   * NORMAL SETTLEMENT
   */
  if (
    direction ===
      "inflow"
  ) {
    return {
      paid:
        0,

      collected:
        roundMoney(
          amount
        )
    };
  }


  return {
    paid:
      roundMoney(
        amount
      ),

    collected:
      0
  };
}


function getPaymentTotals(
  documents = []
) {
  let paid =
    0;

  let collected =
    0;


  safeArray(
    documents
  ).forEach(
    document => {

      if (
        normalizeType(
          document
            ?.documentType
        ) !==
          "payment"
      ) {
        return;
      }


      const effect =
        getPaymentSettlementEffect(
          document
        );


      paid +=
        effect.paid;


      collected +=
        effect.collected;
    }
  );


  return {
    paid:
      roundMoney(
        paid
      ),

    collected:
      roundMoney(
        collected
      )
  };
}


/* =========================================================
   LINKED CHILD TOTAL
   ========================================================= */

function sumLinkedDocuments({
  parentDocumentId = "",
  childIndex,
  allowedTypes = []
} = {}) {
  const allowed =
    new Set(
      safeArray(
        allowedTypes
      )
        .map(
          normalizeType
        )
        .filter(
          Boolean
        )
    );


  const children =
    safeArray(
      childIndex
        ?.get(
          clean(
            parentDocumentId
          )
        )
    );


  return roundMoney(
    children.reduce(
      (
        total,
        child
      ) => {
        const type =
          normalizeType(
            child
              ?.documentType
          );


        if (
          allowed.size &&
          !allowed.has(
            type
          )
        ) {
          return total;
        }


        if (
          !isActiveFinancialDocument(
            child
          )
        ) {
          return total;
        }


        return (
          total +
          Math.abs(
            getFinancialDocumentTotal(
              child
            )
          )
        );
      },
      0
    )
  );
}


/* =========================================================
   PURCHASE ORDER EFFECT
   ========================================================= */

function getPurchaseOrderEffect({
  document,
  childIndex
} = {}) {
  const state =
    normalizeState(
      document
        ?.financialState
    );


  if (
    DEAD_STATES.has(
      state
    ) ||
    DRAFT_STATES.has(
      state
    )
  ) {
    return {
      commitment:
        0,

      remainingCommitment:
        0
    };
  }


  const total =
    Math.abs(
      getFinancialDocumentTotal(
        document
      )
    );


  const convertedToBills =
    sumLinkedDocuments({
      parentDocumentId:
        document
          ?.financialDocumentId,

      childIndex,

      allowedTypes: [
        "bill",
        "supplier-invoice"
      ]
    });


  const remaining =
    Math.max(
      0,
      total -
      convertedToBills
    );


  return {
    commitment:
      roundMoney(
        total
      ),

    remainingCommitment:
      roundMoney(
        remaining
      )
  };
}

function getRevenueCommitmentEffect({ document, childIndex } = {}) {
  const state = normalizeState(document?.financialState);
  if (DEAD_STATES.has(state) || DRAFT_STATES.has(state)) return { contractedRevenue: 0, remainingContractedRevenue: 0 };
  const total = Math.abs(getFinancialDocumentTotal(document));
  const invoiced = sumLinkedDocuments({
    parentDocumentId: document?.financialDocumentId,
    childIndex,
    allowedTypes: ["invoice"]
  });
  return {
    contractedRevenue: roundMoney(total),
    remainingContractedRevenue: roundMoney(Math.max(0, total - invoiced))
  };
}


/* =========================================================
   INCURRED EFFECT
   ========================================================= */

function getIncurredEffect(
  document = {}
) {
  const type =
    normalizeType(
      document
        ?.documentType
    );


  const state =
    normalizeState(
      document
        ?.financialState
    );


  if (
    !OUTFLOW_INCURRED_TYPES.has(
      type
    )
  ) {
    return 0;
  }


  if (
    DEAD_STATES.has(
      state
    ) ||
    DRAFT_STATES.has(
      state
    )
  ) {
    return 0;
  }


  /*
   * Expense / WO / Time may become incurred
   * once submitted/approved depending on
   * business workflow.
   *
   * Bills are economically incurred when
   * billed/incurred/paid.
   */

  if (
    type === "bill" ||
    type === "supplier-invoice"
  ) {
    if (
      !INCURRED_STATES.has(
        state
      )
    ) {
      return 0;
    }
  }


  return roundMoney(
    Math.abs(
      getFinancialDocumentTotal(
        document
      )
    )
  );
}


/* =========================================================
   REVENUE EFFECT
   ========================================================= */

function getRevenueEffect(
  document = {}
) {
  const type =
    normalizeType(
      document
        ?.documentType
    );


  const state =
    normalizeState(
      document
        ?.financialState
    );


  if (
    !REVENUE_TYPES.has(
      type
    )
  ) {
    return 0;
  }


  if (
    DEAD_STATES.has(
      state
    ) ||
    DRAFT_STATES.has(
      state
    )
  ) {
    return 0;
  }


  if (
    !REVENUE_STATES.has(
      state
    ) &&
    state !== "approved" &&
    state !== "submitted"
  ) {
    return 0;
  }


  return roundMoney(
    Math.abs(
      getFinancialDocumentTotal(
        document
      )
    )
  );
}


/* =========================================================
   CREDIT EFFECT
   ========================================================= */

function getCreditEffect(
  document = {}
) {
  const type =
    normalizeType(
      document
        ?.documentType
    );


  if (
    !CREDIT_TYPES.has(
      type
    )
  ) {
    return 0;
  }


  if (
    !isActiveFinancialDocument(
      document
    )
  ) {
    return 0;
  }


  return roundMoney(
    Math.abs(
      getFinancialDocumentTotal(
        document
      )
    )
  );
}


/* =========================================================
   CREATE LIFECYCLE SNAPSHOT
   ========================================================= */

function createFinancialLifecycleSnapshot({
  documents = [],
  currency = "USD"
} = {}) {
  const resolvedCurrency =
    normalizeCurrency(
      currency
    );


  const filtered =
    safeArray(
      documents
    ).filter(
      document =>
        normalizeCurrency(
          document
            ?.currency
        ) ===
          resolvedCurrency
    );


  const childIndex =
    createFinancialChildIndex(
      filtered
    );


  let commitment =
    0;

  let remainingCommitment =
    0;

  let incurredCost =
    0;

  let contractedRevenue =
    0;

  let remainingContractedRevenue =
    0;

  let revenue =
    0;

  let credits =
    0;


  filtered.forEach(
    document => {
      const type =
        normalizeType(
          document
            ?.documentType
        );


      if (
        COMMITMENT_TYPES.has(
          type
        )
      ) {
        const effect =
          getPurchaseOrderEffect({
            document,
            childIndex
          });

        commitment +=
          effect.commitment;

        remainingCommitment +=
          effect.remainingCommitment;

        return;
      }

      if (REVENUE_COMMITMENT_TYPES.has(type)) {
        const effect = getRevenueCommitmentEffect({ document, childIndex });
        contractedRevenue += effect.contractedRevenue;
        remainingContractedRevenue += effect.remainingContractedRevenue;
        return;
      }


      if (
        OUTFlowGuard(
          type
        )
      ) {
        incurredCost +=
          getIncurredEffect(
            document
          );

        return;
      }


      if (
        REVENUE_TYPES.has(
          type
        )
      ) {
        revenue +=
          getRevenueEffect(
            document
          );

        return;
      }


      if (
        CREDIT_TYPES.has(
          type
        )
      ) {
        credits +=
          getCreditEffect(
            document
          );
      }
    }
  );


  /*
   * Credits reduce incurred cost.
   */
  incurredCost =
    Math.max(
      0,
      incurredCost -
      credits
    );


  const paymentTotals =
    getPaymentTotals(
      filtered
    );


  const paid =
    paymentTotals.paid;


  const collected =
    paymentTotals.collected;


  const unpaid =
    Math.max(
      0,
      incurredCost -
      paid
    );


  const receivable =
    Math.max(
      0,
      revenue -
      collected
    );


  const projectedOutflow =
    incurredCost +
    remainingCommitment;


  const operatingNet =
    revenue -
    incurredCost;


  return {
    currency:
      resolvedCurrency,

    commitment:
      roundMoney(
        commitment
      ),

    remainingCommitment:
      roundMoney(
        remainingCommitment
      ),

    incurredCost:
      roundMoney(
        incurredCost
      ),

    paid:
      roundMoney(
        paid
      ),

    unpaid:
      roundMoney(
        unpaid
      ),

    revenue:
      roundMoney(
        revenue
      ),

    collected:
      roundMoney(
        collected
      ),

    receivable:
      roundMoney(
        receivable
      ),

    projectedOutflow:
      roundMoney(
        projectedOutflow
      ),

    contractedRevenue:
      roundMoney(contractedRevenue),

    remainingContractedRevenue:
      roundMoney(remainingContractedRevenue),

    projectedInflow:
      roundMoney(revenue + remainingContractedRevenue),

    operatingNet:
      roundMoney(
        operatingNet
      )
  };
}


/* =========================================================
   INTERNAL TYPE GUARD
   ========================================================= */

function OUTFlowGuard(
  type
) {
  return OUTfLOW_INCURRED_TYPES_FIX.has(
    type
  );
}


/*
 * Keep one canonical Set reference after
 * declaration. This prevents accidental
 * mutation/reassignment in callers.
 */

const OUTfLOW_INCURRED_TYPES_FIX =
  OUTFLOW_INCURRED_TYPES;


/* =========================================================
   DOCUMENT LIFECYCLE FACT
   ========================================================= */

function createFinancialLifecycleFacts({
  documents = [],
  currency = "USD"
} = {}) {
  const resolvedCurrency =
    normalizeCurrency(
      currency
    );


  const childIndex =
    createFinancialChildIndex(
      documents
    );


  return safeArray(
    documents
  )
    .filter(
      document =>
        normalizeCurrency(
          document
            ?.currency
        ) ===
          resolvedCurrency
    )
    .map(
      document => {
        const type =
          normalizeType(
            document
              ?.documentType
          );


        const state =
          normalizeState(
            document
              ?.financialState
          );


        const total =
          getFinancialDocumentTotal(
            document
          );


        let commitment =
          0;

        let remainingCommitment =
          0;

        let incurredCost =
          0;

        let contractedRevenue =
          0;

        let remainingContractedRevenue =
          0;

        let revenue =
          0;

        let paid =
          0;

        let collected =
          0;


        if (
          COMMITMENT_TYPES.has(
            type
          )
        ) {
          const effect =
            getPurchaseOrderEffect({
              document,
              childIndex
            });

          commitment =
            effect.commitment;

          remainingCommitment =
            effect.remainingCommitment;
        }

        if (REVENUE_COMMITMENT_TYPES.has(type)) {
          const effect = getRevenueCommitmentEffect({ document, childIndex });
          contractedRevenue = effect.contractedRevenue;
          remainingContractedRevenue = effect.remainingContractedRevenue;
        }


        if (
          OUTFLOW_INCURRED_TYPES.has(
            type
          )
        ) {
          incurredCost =
            getIncurredEffect(
              document
            );
        }


        if (
          REVENUE_TYPES.has(
            type
          )
        ) {
          revenue =
            getRevenueEffect(
              document
            );
        }


        if (
          PAYMENT_TYPES.has(
            type
          )
        ) {
          const effect =
            getPaymentSettlementEffect(
              document
            );

          paid =
            effect.paid;

          collected =
            effect.collected;
        }


        return {
          financialDocumentId:
            clean(
              document
                ?.financialDocumentId
            ),

          documentType:
            type,

          financialState:
            state,

          currency:
            resolvedCurrency,

          total:
            roundMoney(
              total
            ),

          sourceFinancialDocumentId:
            getSourceFinancialDocumentId(
              document
            ),

          relatedFinancialDocumentIds:
            getRelatedFinancialDocumentIds(
              document
            ),

          commitment:
            roundMoney(
              commitment
            ),

          remainingCommitment:
            roundMoney(
              remainingCommitment
            ),

          contractedRevenue:
            roundMoney(contractedRevenue),

          remainingContractedRevenue:
            roundMoney(remainingContractedRevenue),

          incurredCost:
            roundMoney(
              incurredCost
            ),

          paid:
            roundMoney(
              paid
            ),

          revenue:
            roundMoney(
              revenue
            ),

          collected:
            roundMoney(
              collected
            )
        };
      }
    );
}


/* =========================================================
   EXPORTS
   ========================================================= */

module.exports = {
  OUTFLOW_INCURRED_TYPES,
  COMMITMENT_TYPES,
  REVENUE_COMMITMENT_TYPES,
  REVENUE_TYPES,
  PAYMENT_TYPES,
  CREDIT_TYPES,

  DEAD_STATES,
  DRAFT_STATES,
  COMMITTED_STATES,
  INCURRED_STATES,
  REVENUE_STATES,

  getFinancialDocumentTotal,

  getRelatedFinancialDocumentIds,
  getSourceFinancialDocumentId,

  createFinancialDocumentIndex,
  createFinancialChildIndex,

  isActiveFinancialDocument,

  getPaymentEconomicDirection,
  getPaymentSettlementEffect,
  getPaymentTotals,

  getPurchaseOrderEffect,
  getIncurredEffect,
  getRevenueEffect,
  getCreditEffect,

  createFinancialLifecycleFacts,
  createFinancialLifecycleSnapshot
};
