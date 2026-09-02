"use strict";

/*
 * IXI FINANCIAL SERVER CONTRACT
 *
 * PURPOSE
 * -------
 *
 * Canonical AWS boundary for the IXI AOS
 * Financial subsystem.
 *
 * This file does NOT calculate accounting.
 * It does NOT own persistence.
 * It does NOT perform recursive traversal.
 *
 * It defines the exact envelope shapes that
 * IX-Core accepts and returns.
 *
 *
 * CORE RULE
 * ---------
 *
 * FRONTEND FINANCIAL ENGINE
 *          ||
 *          ||
 *          \/
 * AWS FINANCIAL CONTRACT
 *
 * AWS must conform to the front contract.
 * AWS must NOT invent a parallel schema.
 *
 *
 * DATA FAMILIES
 * -------------
 *
 * DOCUMENT
 * LINE
 * REFERENCE
 * HISTORY
 * AUDIT
 * PERMISSION
 * SNAPSHOT
 * LIFECYCLE
 *
 *
 * PASSPORT IS THE FINANCIAL ANCHOR.
 */

const IXI_FINANCIAL_SERVER_CONTRACT =
  "ixi-financial";

const IXI_FINANCIAL_SERVER_CONTRACT_VERSION =
  "1.0.0";


function clean(value) {
  return String(value ?? "").trim();
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


function safeNumber(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}


function uniqueStrings(values) {
  return Array.from(
    new Set(
      safeArray(values)
        .map(clean)
        .filter(Boolean)
    )
  );
}


function createFinancialEnvelope({
  ok = true,
  operation = "",
  data = null,
  errors = [],
  warnings = [],
  requestId = "",
  metadata = {}
} = {}) {
  return {
    ok:
      Boolean(ok) &&
      safeArray(errors).length === 0,

    contract:
      IXI_FINANCIAL_SERVER_CONTRACT,

    contractVersion:
      IXI_FINANCIAL_SERVER_CONTRACT_VERSION,

    operation:
      clean(operation),

    requestId:
      clean(requestId),

    data,

    errors:
      safeArray(errors),

    warnings:
      safeArray(warnings),

    metadata: {
      ...safeObject(metadata)
    }
  };
}


function normalizeFinancialDocumentWriteRequest(
  input = {}
) {
  const source =
    safeObject(input);

  return {
    financialDocument:
      safeObject(
        source.financialDocument ||
        source.document
      ),

    actorPassportId:
      clean(source.actorPassportId),

    entityPassportId:
      clean(source.entityPassportId),

    commandId:
      clean(source.commandId),

    idempotencyKey:
      clean(source.idempotencyKey),

    expectedRevision:
      source.expectedRevision === undefined ||
      source.expectedRevision === null
        ? null
        : safeNumber(
            source.expectedRevision,
            null
          ),

    metadata: {
      ...safeObject(source.metadata)
    }
  };
}


function normalizeFinancialDocumentPatchRequest(
  input = {}
) {
  const source =
    safeObject(input);

  return {
    financialDocumentId:
      clean(source.financialDocumentId),

    patch:
      safeObject(source.patch),

    actorPassportId:
      clean(source.actorPassportId),

    commandId:
      clean(source.commandId),

    idempotencyKey:
      clean(source.idempotencyKey),

    expectedRevision:
      source.expectedRevision === undefined ||
      source.expectedRevision === null
        ? null
        : safeNumber(
            source.expectedRevision,
            null
          ),

    metadata: {
      ...safeObject(source.metadata)
    }
  };
}


function normalizeFinancialPassportQuery(
  input = {}
) {
  const source =
    safeObject(input);

  return {
    passportId:
      clean(source.passportId),

    currency:
      clean(
        source.currency ||
        "USD"
      ).toUpperCase(),

    startAt:
      clean(source.startAt),

    endAt:
      clean(source.endAt),

    includeDocuments:
      Boolean(source.includeDocuments),

    includeFacts:
      Boolean(source.includeFacts),

    includeRecentActivity:
      source.includeRecentActivity === undefined
        ? true
        : Boolean(source.includeRecentActivity),

    recentActivityLimit:
      Math.max(
        0,
        Math.min(
          100,
          safeNumber(
            source.recentActivityLimit,
            3
          )
        )
      )
  };
}


function normalizeFinancialScopeQuery(
  input = {}
) {
  const source =
    safeObject(input);

  return {
    rootPassportId:
      clean(source.rootPassportId),

    scopePassportIds:
      uniqueStrings(
        source.scopePassportIds
      ),

    currency:
      clean(
        source.currency ||
        "USD"
      ).toUpperCase(),

    startAt:
      clean(source.startAt),

    endAt:
      clean(source.endAt),

    includeFacts:
      Boolean(source.includeFacts),

    includeRecentActivity:
      source.includeRecentActivity === undefined
        ? true
        : Boolean(source.includeRecentActivity),

    recentActivityLimit:
      Math.max(
        0,
        Math.min(
          100,
          safeNumber(
            source.recentActivityLimit,
            3
          )
        )
      )
  };
}


function createFinancialDocumentRecord({
  financialDocument = {},
  revision = 1,
  createdAt = "",
  updatedAt = "",
  createdByPassportId = "",
  updatedByPassportId = "",
  entityPassportId = "",
  idempotencyKey = "",
  storageMetadata = {}
} = {}) {
  return {
    financialDocument:
      safeObject(financialDocument),

    server: {
      revision:
        Math.max(
          1,
          safeNumber(
            revision,
            1
          )
        ),

      createdAt:
        clean(createdAt),

      updatedAt:
        clean(updatedAt),

      createdByPassportId:
        clean(createdByPassportId),

      updatedByPassportId:
        clean(updatedByPassportId),

      entityPassportId:
        clean(entityPassportId),

      idempotencyKey:
        clean(idempotencyKey),

      storageMetadata: {
        ...safeObject(storageMetadata)
      }
    }
  };
}


function createFinancialSnapshotResponse({
  passportId = "",
  rootPassportId = "",
  scopePassportIds = [],
  currency = "USD",
  startAt = "",
  endAt = "",
  financialSnapshot = {},
  lifecycleSnapshot = {},
  recentActivity = [],
  generatedAt = "",
  sourceRevision = 0
} = {}) {
  return {
    passportId:
      clean(passportId),

    rootPassportId:
      clean(rootPassportId),

    scopePassportIds:
      uniqueStrings(
        scopePassportIds
      ),

    currency:
      clean(
        currency ||
        "USD"
      ).toUpperCase(),

    startAt:
      clean(startAt),

    endAt:
      clean(endAt),

    financialSnapshot:
      safeObject(financialSnapshot),

    lifecycleSnapshot:
      safeObject(lifecycleSnapshot),

    recentActivity:
      safeArray(recentActivity),

    generatedAt:
      clean(generatedAt),

    sourceRevision:
      safeNumber(
        sourceRevision,
        0
      )
  };
}


function createFinancialDocumentListResponse({
  passportId = "",
  documents = [],
  count = null,
  cursor = "",
  hasMore = false
} = {}) {
  const normalizedDocuments =
    safeArray(documents);

  return {
    passportId:
      clean(passportId),

    documents:
      normalizedDocuments,

    count:
      count === null
        ? normalizedDocuments.length
        : safeNumber(
            count,
            normalizedDocuments.length
          ),

    cursor:
      clean(cursor),

    hasMore:
      Boolean(hasMore)
  };
}


function createFinancialHistoryResponse({
  financialDocumentId = "",
  history = [],
  audit = []
} = {}) {
  return {
    financialDocumentId:
      clean(financialDocumentId),

    history:
      safeArray(history),

    audit:
      safeArray(audit)
  };
}


function createFinancialHealthResponse({
  persistence = false,
  validation = false,
  snapshots = false,
  audit = false,
  idempotency = false
} = {}) {
  return {
    service:
      "ixi-financial",

    contract:
      IXI_FINANCIAL_SERVER_CONTRACT,

    contractVersion:
      IXI_FINANCIAL_SERVER_CONTRACT_VERSION,

    capabilities: {
      persistence:
        Boolean(persistence),

      validation:
        Boolean(validation),

      snapshots:
        Boolean(snapshots),

      audit:
        Boolean(audit),

      idempotency:
        Boolean(idempotency)
    }
  };
}


module.exports = {
  IXI_FINANCIAL_SERVER_CONTRACT,
  IXI_FINANCIAL_SERVER_CONTRACT_VERSION,

  createFinancialEnvelope,

  normalizeFinancialDocumentWriteRequest,
  normalizeFinancialDocumentPatchRequest,

  normalizeFinancialPassportQuery,
  normalizeFinancialScopeQuery,

  createFinancialDocumentRecord,

  createFinancialSnapshotResponse,
  createFinancialDocumentListResponse,
  createFinancialHistoryResponse,

  createFinancialHealthResponse
};
