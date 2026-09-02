"use strict";

/*
 * IXI FINANCIAL SERVICE
 *
 * PURPOSE
 * -------
 *
 * Single server-side facade for the entire
 * IXI Financial subsystem.
 *
 *
 * ROUTES SHOULD CALL THIS FILE.
 *
 * Routes should NOT reach directly into:
 *
 * - validation
 * - persistence
 * - audit
 * - lifecycle
 * - snapshot
 * - server contract
 *
 *
 * CORE FLOW
 * ---------
 *
 * REQUEST
 *   ↓
 * normalize contract
 *   ↓
 * validate
 *   ↓
 * persist
 *   ↓
 * audit
 *   ↓
 * snapshot / history response
 *
 *
 * IMPORTANT
 * ---------
 *
 * This is the AWS equivalent of the frontend
 * IXIFinancialEngine facade.
 */


const crypto =
  require("crypto");


const {
  createFinancialEnvelope,
  normalizeFinancialDocumentWriteRequest,
  normalizeFinancialDocumentPatchRequest,
  normalizeFinancialPassportQuery,
  normalizeFinancialScopeQuery,
  createFinancialDocumentListResponse,
  createFinancialHistoryResponse,
  createFinancialHealthResponse
} =
  require(
    "./IXIFinancialServerContract"
  );


const {
  validateFinancialDocument
} =
  require(
    "./IXIFinancialValidationBridge"
  );


const {
  createFinancialDocument,
  replaceFinancialDocument,
  getFinancialDocumentRecord,
  getFinancialDocumentHistory,
  listFinancialDocumentsByPassport,
  getFinancialPersistenceHealth
} =
  require(
    "./IXIFinancialPersistenceEngine"
  );


const {
  recordFinancialAuditEvent,
  getFinancialAuditEvents,
  getFinancialAuditHealth
} =
  require(
    "./IXIFinancialAuditEngine"
  );


const {
  createPassportFinancialSnapshot,
  createScopeFinancialSnapshot
} =
  require(
    "./IXIFinancialSnapshotEngine"
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


function safeObject(
  value
) {
  return (
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}


function createRequestId() {
  return `ifr_${crypto
    .randomBytes(10)
    .toString("hex")}`;
}


function createCommandId() {
  return `ifc_${crypto
    .randomBytes(10)
    .toString("hex")}`;
}


function getRequestContext(
  input = {}
) {
  const source =
    safeObject(
      input
    );

  return {
    requestId:
      clean(
        source.requestId
      ) ||
      createRequestId(),

    source:
      clean(
        source.source ||
        "ixi-core"
      ),

    sourceIp:
      clean(
        source.sourceIp
      ),

    userAgent:
      clean(
        source.userAgent
      )
  };
}


/* =========================================================
   ERROR NORMALIZATION
   ========================================================= */

function normalizeServiceError(
  error
) {
  const source =
    error ||
    new Error(
      "Unknown financial error."
    );

  return {
    name:
      clean(
        source.name ||
        "IXIFinancialError"
      ),

    message:
      clean(
        source.message ||
        "Unknown financial error."
      ),

    details:
      safeObject(
        source.details
      ),

    validation:
      source.validation ||
      null
  };
}


/* =========================================================
   CREATE DOCUMENT
   ========================================================= */

function createDocument(
  input = {}
) {
  const request =
    normalizeFinancialDocumentWriteRequest(
      input
    );

  const context =
    getRequestContext(
      input
    );

  const commandId =
    request.commandId ||
    createCommandId();

  try {
    const validation =
      validateFinancialDocument(
        request.financialDocument
      );

    if (
      !validation.ok
    ) {
      return createFinancialEnvelope({
        ok:
          false,

        operation:
          "financial.document.create",

        requestId:
          context.requestId,

        errors:
          validation.errors,

        warnings:
          validation.warnings,

        data: {
          validation
        }
      });
    }

    const result =
      createFinancialDocument({
        financialDocument:
          validation.normalized,

        actorPassportId:
          request.actorPassportId,

        entityPassportId:
          request.entityPassportId,

        commandId,

        idempotencyKey:
          request.idempotencyKey,

        metadata:
          request.metadata
      });

    /*
     * Idempotent replay already has its
     * original audit event.
     */
    if (
      !result.idempotentReplay
    ) {
      recordFinancialAuditEvent({
        financialDocumentId:
          result
            .record
            .financialDocument
            .financialDocumentId,

        eventType:
          "create",

        actorPassportId:
          request.actorPassportId,

        entityPassportId:
          request.entityPassportId,

        commandId,

        idempotencyKey:
          request.idempotencyKey,

        requestId:
          context.requestId,

        source:
          context.source,

        sourceIp:
          context.sourceIp,

        userAgent:
          context.userAgent,

        revisionBefore:
          null,

        revisionAfter:
          result
            .record
            .server
            .revision,

        after:
          result
            .record
            .financialDocument
      });
    }

    return createFinancialEnvelope({
      ok:
        true,

      operation:
        "financial.document.create",

      requestId:
        context.requestId,

      warnings:
        validation.warnings,

      data: {
        created:
          result.created,

        idempotentReplay:
          result.idempotentReplay,

        indexedPassportIds:
          result.indexedPassportIds,

        record:
          result.record
      }
    });

  } catch (
    error
  ) {
    return createFinancialEnvelope({
      ok:
        false,

      operation:
        "financial.document.create",

      requestId:
        context.requestId,

      errors: [
        normalizeServiceError(
          error
        )
      ]
    });
  }
}


/* =========================================================
   REPLACE DOCUMENT
   ========================================================= */

function replaceDocument(
  input = {}
) {
  const request =
    normalizeFinancialDocumentWriteRequest(
      input
    );

  const context =
    getRequestContext(
      input
    );

  const commandId =
    request.commandId ||
    createCommandId();

  try {
    const validation =
      validateFinancialDocument(
        request.financialDocument
      );

    if (
      !validation.ok
    ) {
      return createFinancialEnvelope({
        ok:
          false,

        operation:
          "financial.document.replace",

        requestId:
          context.requestId,

        errors:
          validation.errors,

        warnings:
          validation.warnings,

        data: {
          validation
        }
      });
    }

    const financialDocumentId =
      validation
        .normalized
        .financialDocumentId;

    const beforeRecord =
      getFinancialDocumentRecord(
        financialDocumentId
      );

    const result =
      replaceFinancialDocument({
        financialDocument:
          validation.normalized,

        actorPassportId:
          request.actorPassportId,

        commandId,

        idempotencyKey:
          request.idempotencyKey,

        expectedRevision:
          request.expectedRevision,

        metadata:
          request.metadata
      });

    if (
      !result.idempotentReplay
    ) {
      recordFinancialAuditEvent({
        financialDocumentId,

        eventType:
          "replace",

        actorPassportId:
          request.actorPassportId,

        entityPassportId:
          beforeRecord
            ?.server
            ?.entityPassportId ||
          "",

        commandId,

        idempotencyKey:
          request.idempotencyKey,

        requestId:
          context.requestId,

        source:
          context.source,

        sourceIp:
          context.sourceIp,

        userAgent:
          context.userAgent,

        revisionBefore:
          beforeRecord
            ?.server
            ?.revision ??
          null,

        revisionAfter:
          result
            .record
            .server
            .revision,

        before:
          beforeRecord
            ?.financialDocument ||
          null,

        after:
          result
            .record
            .financialDocument
      });
    }

    return createFinancialEnvelope({
      ok:
        true,

      operation:
        "financial.document.replace",

      requestId:
        context.requestId,

      warnings:
        validation.warnings,

      data: {
        updated:
          result.updated,

        idempotentReplay:
          result.idempotentReplay,

        indexedPassportIds:
          result.indexedPassportIds,

        record:
          result.record
      }
    });

  } catch (
    error
  ) {
    return createFinancialEnvelope({
      ok:
        false,

      operation:
        "financial.document.replace",

      requestId:
        context.requestId,

      errors: [
        normalizeServiceError(
          error
        )
      ]
    });
  }
}


/* =========================================================
   PATCH DOCUMENT
   ========================================================= */

function patchDocument(
  input = {}
) {
  const request =
    normalizeFinancialDocumentPatchRequest(
      input
    );

  const context =
    getRequestContext(
      input
    );

  try {
    const existing =
      getFinancialDocumentRecord(
        request.financialDocumentId
      );

    if (
      !existing
    ) {
      return createFinancialEnvelope({
        ok:
          false,

        operation:
          "financial.document.patch",

        requestId:
          context.requestId,

        errors: [
          {
            name:
              "IXIFinancialNotFoundError",

            message:
              `Financial document not found: ${request.financialDocumentId}`
          }
        ]
      });
    }

    const mergedDocument = {
      ...existing
        .financialDocument,

      ...request.patch,

      /*
       * Identity cannot change through patch.
       */
      financialDocumentId:
        existing
          .financialDocument
          .financialDocumentId
    };

    return replaceDocument({
      financialDocument:
        mergedDocument,

      actorPassportId:
        request.actorPassportId,

      commandId:
        request.commandId,

      idempotencyKey:
        request.idempotencyKey,

      expectedRevision:
        request.expectedRevision,

      metadata:
        request.metadata,

      requestId:
        context.requestId,

      source:
        context.source,

      sourceIp:
        context.sourceIp,

      userAgent:
        context.userAgent
    });

  } catch (
    error
  ) {
    return createFinancialEnvelope({
      ok:
        false,

      operation:
        "financial.document.patch",

      requestId:
        context.requestId,

      errors: [
        normalizeServiceError(
          error
        )
      ]
    });
  }
}


/* =========================================================
   GET DOCUMENT
   ========================================================= */

function getDocument({
  financialDocumentId = "",
  requestId = ""
} = {}) {
  const resolvedRequestId =
    clean(
      requestId
    ) ||
    createRequestId();

  try {
    const record =
      getFinancialDocumentRecord(
        financialDocumentId
      );

    if (
      !record
    ) {
      return createFinancialEnvelope({
        ok:
          false,

        operation:
          "financial.document.get",

        requestId:
          resolvedRequestId,

        errors: [
          {
            name:
              "IXIFinancialNotFoundError",

            message:
              `Financial document not found: ${clean(financialDocumentId)}`
          }
        ]
      });
    }

    return createFinancialEnvelope({
      ok:
        true,

      operation:
        "financial.document.get",

      requestId:
        resolvedRequestId,

      data: {
        record
      }
    });

  } catch (
    error
  ) {
    return createFinancialEnvelope({
      ok:
        false,

      operation:
        "financial.document.get",

      requestId:
        resolvedRequestId,

      errors: [
        normalizeServiceError(
          error
        )
      ]
    });
  }
}


/* =========================================================
   LIST DOCUMENTS BY PASSPORT
   ========================================================= */

function listDocumentsByPassport(
  input = {}
) {
  const query =
    normalizeFinancialPassportQuery(
      input
    );

  const context =
    getRequestContext(
      input
    );

  try {
    const documents =
      listFinancialDocumentsByPassport(
        query.passportId
      );

    return createFinancialEnvelope({
      ok:
        true,

      operation:
        "financial.passport.documents",

      requestId:
        context.requestId,

      data:
        createFinancialDocumentListResponse({
          passportId:
            query.passportId,

          documents,

          count:
            documents.length,

          hasMore:
            false
        })
    });

  } catch (
    error
  ) {
    return createFinancialEnvelope({
      ok:
        false,

      operation:
        "financial.passport.documents",

      requestId:
        context.requestId,

      errors: [
        normalizeServiceError(
          error
        )
      ]
    });
  }
}


/* =========================================================
   DOCUMENT HISTORY + AUDIT
   ========================================================= */

function getDocumentHistory({
  financialDocumentId = "",
  requestId = ""
} = {}) {
  const resolvedRequestId =
    clean(
      requestId
    ) ||
    createRequestId();

  try {
    const history =
      getFinancialDocumentHistory(
        financialDocumentId
      );

    const audit =
      getFinancialAuditEvents(
        financialDocumentId
      );

    return createFinancialEnvelope({
      ok:
        true,

      operation:
        "financial.document.history",

      requestId:
        resolvedRequestId,

      data:
        createFinancialHistoryResponse({
          financialDocumentId,

          history,

          audit
        })
    });

  } catch (
    error
  ) {
    return createFinancialEnvelope({
      ok:
        false,

      operation:
        "financial.document.history",

      requestId:
        resolvedRequestId,

      errors: [
        normalizeServiceError(
          error
        )
      ]
    });
  }
}


/* =========================================================
   PASSPORT SNAPSHOT
   ========================================================= */

function getPassportSnapshot(
  input = {}
) {
  const query =
    normalizeFinancialPassportQuery(
      input
    );

  const context =
    getRequestContext(
      input
    );

  try {
    const snapshot =
      createPassportFinancialSnapshot({
        passportId:
          query.passportId,

        currency:
          query.currency,

        startAt:
          query.startAt,

        endAt:
          query.endAt,

        includeFacts:
          query.includeFacts,

        recentActivityLimit:
          query.recentActivityLimit
      });

    return createFinancialEnvelope({
      ok:
        true,

      operation:
        "financial.passport.snapshot",

      requestId:
        context.requestId,

      data:
        snapshot
    });

  } catch (
    error
  ) {
    return createFinancialEnvelope({
      ok:
        false,

      operation:
        "financial.passport.snapshot",

      requestId:
        context.requestId,

      errors: [
        normalizeServiceError(
          error
        )
      ]
    });
  }
}


/* =========================================================
   RECURSIVE SCOPE SNAPSHOT
   ========================================================= */

function getScopeSnapshot(
  input = {}
) {
  const query =
    normalizeFinancialScopeQuery(
      input
    );

  const context =
    getRequestContext(
      input
    );

  try {
    const snapshot =
      createScopeFinancialSnapshot({
        rootPassportId:
          query.rootPassportId,

        scopePassportIds:
          query.scopePassportIds,

        currency:
          query.currency,

        startAt:
          query.startAt,

        endAt:
          query.endAt,

        includeFacts:
          query.includeFacts,

        recentActivityLimit:
          query.recentActivityLimit
      });

    return createFinancialEnvelope({
      ok:
        true,

      operation:
        "financial.scope.snapshot",

      requestId:
        context.requestId,

      data:
        snapshot
    });

  } catch (
    error
  ) {
    return createFinancialEnvelope({
      ok:
        false,

      operation:
        "financial.scope.snapshot",

      requestId:
        context.requestId,

      errors: [
        normalizeServiceError(
          error
        )
      ]
    });
  }
}


/* =========================================================
   HEALTH
   ========================================================= */

function getHealth() {
  try {
    const persistence =
      getFinancialPersistenceHealth();

    const audit =
      getFinancialAuditHealth();

    return createFinancialEnvelope({
      ok:
        true,

      operation:
        "financial.health",

      data: {
        health:
          createFinancialHealthResponse({
            persistence:
              true,

            validation:
              true,

            snapshots:
              true,

            audit:
              true,

            idempotency:
              true
          }),

        persistence,

        audit
      }
    });

  } catch (
    error
  ) {
    return createFinancialEnvelope({
      ok:
        false,

      operation:
        "financial.health",

      errors: [
        normalizeServiceError(
          error
        )
      ]
    });
  }
}


/* =========================================================
   EXPORTS
   ========================================================= */

module.exports = {
  createDocument,
  replaceDocument,
  patchDocument,

  getDocument,
  listDocumentsByPassport,
  getDocumentHistory,

  getPassportSnapshot,
  getScopeSnapshot,

  getHealth
};
