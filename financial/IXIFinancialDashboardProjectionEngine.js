"use strict";

/*
 * IXI FINANCIAL DASHBOARD PROJECTION ENGINE
 *
 * PURPOSE
 * -------
 *
 * Enterprise read model for IXI TRAN$ACT Desktop.
 *
 * IMPORTANT:
 *
 * This engine DOES NOT recreate accounting.
 *
 * Financial truth remains owned by:
 *
 *   Financial Documents
 *      ↓
 *   Financial Snapshot Engine
 *      +
 *   Financial Lifecycle Engine
 *
 * This projection packages those authoritative
 * results into a stable Desktop contract.
 */


function clean(value) {
  return String(
    value ??
    ""
  ).trim();
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


function safeArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}


function uniqueStrings(values = []) {
  return Array.from(
    new Set(
      safeArray(values)
        .map(clean)
        .filter(Boolean)
    )
  );
}


function createProjectionId() {
  return [
    "ixfdp",
    Date.now(),
    Math.random()
      .toString(36)
      .slice(2, 10)
  ].join("_");
}


function resolveCurrencySnapshot(
  financialSnapshot,
  currency
) {
  const source =
    safeObject(
      financialSnapshot
    );

  const snapshots =
    safeObject(
      source.snapshots
    );

  const requested =
    clean(
      currency
    ).toUpperCase();


  if (
    requested &&
    snapshots[requested]
  ) {
    return snapshots[requested];
  }


  const currencies =
    safeArray(
      source.currencies
    );


  for (
    const candidate of currencies
  ) {
    const id =
      clean(
        candidate
      ).toUpperCase();

    if (
      id &&
      snapshots[id]
    ) {
      return snapshots[id];
    }
  }


  return {};
}


/*
 * IMPORTANT:
 *
 * Executive metrics here are ONLY aliases
 * over values already calculated by the
 * Financial Snapshot Engine.
 *
 * No independent accounting equations.
 */

function createExecutiveProjection({
  financialSnapshot,
  currency
} = {}) {
  const rollup =
    safeObject(
      resolveCurrencySnapshot(
        financialSnapshot,
        currency
      )
    );


  return {
    currency:
      clean(
        rollup.currency ||
        currency ||
        "USD"
      ).toUpperCase(),

    factCount:
      Number(
        rollup.factCount ||
        0
      ),

    documentCount:
      Number(
        rollup.documentCount ||
        0
      ),

    inflow:
      Number(
        rollup.inflow ||
        0
      ),

    outflow:
      Number(
        rollup.outflow ||
        0
      ),

    net:
      Number(
        rollup.net ||
        0
      ),

    neutral:
      Number(
        rollup.neutral ||
        0
      ),

    byFinancialState:
      safeObject(
        rollup.byFinancialState
      ),

    byLineType:
      safeObject(
        rollup.byLineType
      ),

    byDocumentType:
      safeObject(
        rollup.byDocumentType
      )
  };
}


function createFinancialDashboardProjection({
  scopeSnapshot = {},
  query = {},
  accessContext = {}
} = {}) {
  const scope =
    safeObject(
      scopeSnapshot
    );

  const financialSnapshot =
    safeObject(
      scope.financialSnapshot
    );

  const lifecycleSnapshot =
    safeObject(
      scope.lifecycleSnapshot
    );

  const recentActivity =
    safeArray(
      scope.recentActivity
    );

  const requestedQuery =
    safeObject(
      query
    );

  const access =
    safeObject(
      accessContext
    );


  const currency =
    clean(
      scope.currency ||
      requestedQuery.currency ||
      "USD"
    ).toUpperCase();


  return {
    schema:
      "ixi-financial-dashboard-v1",

    contract:
      "ixi-financial-dashboard",

    contractVersion:
      "1.0.0",

    projectionId:
      createProjectionId(),

    generatedAt:
      new Date()
        .toISOString(),

    scope: {
      rootPassportId:
        clean(
          scope.rootPassportId ||
          requestedQuery.rootPassportId
        ),

      scopePassportIds:
        uniqueStrings(
          scope.scopePassportIds ||
          requestedQuery.scopePassportIds
        ),

      entityPassportId:
        clean(
          access.entityPassportId
        ),

      actorPassportId:
        clean(
          access.actorPassportId
        ),

      currency,

      startAt:
        clean(
          financialSnapshot.startAt ||
          requestedQuery.startAt
        ),

      endAt:
        clean(
          financialSnapshot.endAt ||
          requestedQuery.endAt
        )
    },


    /*
     * EXECUTIVE
     *
     * Aliases only over canonical financial
     * snapshot rollups.
     */

    executive:
      createExecutiveProjection({
        financialSnapshot,
        currency
      }),


    /*
     * AUTHORITATIVE DOMAIN PROJECTIONS
     *
     * These remain intact so no accounting
     * semantics are lost in Desktop transport.
     */

    financialSnapshot,

    lifecycleSnapshot,

    recentActivity,


    /*
     * Desktop domains.
     *
     * We intentionally expose the canonical
     * source structures rather than inventing
     * alternate balances.
     *
     * Domain-specific queue/read models can be
     * added here as IXI Financial adds explicit
     * server projections for them.
     */

    domains: {
      receivables: {
        source:
          "lifecycleSnapshot",

        snapshot:
          lifecycleSnapshot
      },

      payables: {
        source:
          "lifecycleSnapshot",

        snapshot:
          lifecycleSnapshot
      },

      treasury: {
        source:
          "financialSnapshot+lifecycleSnapshot",

        financialSnapshot,
        lifecycleSnapshot
      },

      generalLedger: {
        source:
          "financialSnapshot",

        snapshot:
          financialSnapshot
      },

      reporting: {
        source:
          "financialSnapshot+lifecycleSnapshot",

        financialSnapshot,
        lifecycleSnapshot
      }
    },


    attention: {
      recentActivity,

      warnings:
        safeArray(
          scope.warnings
        )
    },


    lineage: {
      storageProvider:
        scope.storageProvider ||
        null,

      sourceOperation:
        "financial.scope.snapshot",

      sourceContract:
        "ixi-financial",

      sourceContractVersion:
        "1.0.0",

      serverCalculated:
        true,

      browserCalculated:
        false
    }
  };
}


module.exports = {
  createExecutiveProjection,
  createFinancialDashboardProjection
};
