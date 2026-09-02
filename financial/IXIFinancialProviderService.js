"use strict";

/*
 * IXI FINANCIAL PROVIDER SERVICE
 *
 * PURPOSE
 * -------
 *
 * Async Financial Service facade that uses
 * IXIFinancialStorageProvider instead of
 * reaching directly into local-json storage.
 *
 *
 * THIS IS THE MIGRATION SEAM.
 *
 * SAME FINANCIAL DOMAIN.
 * SAME VALIDATION.
 * SAME LIFECYCLE.
 * SAME SNAPSHOT SHAPES.
 * DIFFERENT PHYSICAL STORAGE PROVIDER.
 *
 *
 * IMPORTANT
 * ---------
 *
 * Production IXIFinancialService is NOT
 * replaced yet.
 *
 * This service is proved independently first.
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
  createFinancialAuditEvent
} =
  require(
    "./IXIFinancialAuditEngine"
  );


const {
  createAof2FinancialPackage
} =
  require(
    "./IXIFinancialSnapshotEngine"
  );


const {
  getFinancialStorageProvider,
  getConfiguredFinancialStorageProviderId,
  describeFinancialStorageProvider
} =
  require(
    "./IXIFinancialStorageProvider"
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


function safeArray(
  value
) {
  return Array.isArray(
    value
  )
    ? value
    : [];
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


function getProvider() {
  return getFinancialStorageProvider();
}


/* =========================================================
   AUDIT ADAPTER
   ========================================================= */

async function appendAudit({
  provider,
  financialDocumentId,
  eventType,
  actorPassportId = "",
  entityPassportId = "",
  commandId = "",
  idempotencyKey = "",
  requestId = "",
  source = "",
  sourceIp = "",
  userAgent = "",
  revisionBefore = null,
  revisionAfter = null,
  before = null,
  after = null
} = {}) {
  if (
    typeof provider
      ?.appendFinancialAuditEvent !==
      "function"
  ) {
    return null;
  }


  const event =
    createFinancialAuditEvent({
      financialDocumentId,

      eventType,

      actorPassportId,

      entityPassportId,

      commandId,

      idempotencyKey,

      requestId,

      source,

      sourceIp,

      userAgent,

      revisionBefore,

      revisionAfter,

      before,

      after
    });


  return await provider
    .appendFinancialAuditEvent(
      event
    );
}


/* =========================================================
   CREATE
   ========================================================= */

async function createDocument(
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


  const provider =
    getProvider();


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
      await provider
        .createFinancialDocument({
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


    if (
      !result.idempotentReplay
    ) {
      await appendAudit({
        provider,

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
          result.record,

        storageProvider:
          getConfiguredFinancialStorageProviderId()
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
   REPLACE
   ========================================================= */

async function replaceDocument(
  input = {}
) {
  const auditEventType =
    clean(
      input.auditEventType
    ) === "post"
      ? "post"
      : "replace";

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


  const provider =
    getProvider();


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
      await provider
        .getFinancialDocumentRecord(
          financialDocumentId
        );


    const result =
      await provider
        .replaceFinancialDocument({
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
      await appendAudit({
        provider,

        financialDocumentId,

        eventType:
          auditEventType,

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
          result.record,

        storageProvider:
          getConfiguredFinancialStorageProviderId()
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
   PATCH
   ========================================================= */

async function patchDocument(
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


  const provider =
    getProvider();


  try {
    const existing =
      await provider
        .getFinancialDocumentRecord(
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

      financialDocumentId:
        existing
          .financialDocument
          .financialDocumentId
    };


    return await replaceDocument({
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

async function getDocument({
  financialDocumentId = "",
  requestId = ""
} = {}) {
  const resolvedRequestId =
    clean(
      requestId
    ) ||
    createRequestId();


  const provider =
    getProvider();


  try {
    const record =
      await provider
        .getFinancialDocumentRecord(
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
        record,

        storageProvider:
          getConfiguredFinancialStorageProviderId()
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
   LIST BY PASSPORT
   ========================================================= */

async function listDocumentsByPassport(
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


  const provider =
    getProvider();


  try {
    const documents =
      await provider
        .listFinancialDocumentsByPassport(
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
   HISTORY + AUDIT
   ========================================================= */

async function getDocumentHistory({
  financialDocumentId = "",
  requestId = ""
} = {}) {
  const resolvedRequestId =
    clean(
      requestId
    ) ||
    createRequestId();


  const provider =
    getProvider();


  try {
    const history =
      await provider
        .getFinancialDocumentHistory(
          financialDocumentId
        );


    const audit =
      typeof provider
        .getFinancialAuditEvents ===
        "function"
        ? await provider
            .getFinancialAuditEvents(
              financialDocumentId
            )
        : [];


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
   LOAD SCOPE DOCUMENTS
   ========================================================= */

async function loadScopeDocuments(
  passportIds = []
) {
  const provider =
    getProvider();


  const uniquePassportIds =
    Array.from(
      new Set(
        safeArray(
          passportIds
        )
          .map(
            clean
          )
          .filter(
            Boolean
          )
      )
    );


  const groups =
    await Promise.all(
      uniquePassportIds.map(
        passportId =>
          provider
            .listFinancialDocumentsByPassport(
              passportId
            )
      )
    );


  const byDocumentId =
    new Map();


  groups
    .flat()
    .forEach(
      record => {
        const financialDocument =
          record
            ?.financialDocument ||
          record;


        const id =
          clean(
            financialDocument
              ?.financialDocumentId
          );


        if (
          id &&
          !byDocumentId.has(
            id
          )
        ) {
          byDocumentId.set(
            id,
            financialDocument
          );
        }
      }
    );


  return Array.from(
    byDocumentId.values()
  );
}


/* =========================================================
   PASSPORT SNAPSHOT
   ========================================================= */

async function getPassportSnapshot(
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
      await loadScopeDocuments([
        query.passportId
      ]);


    const packageResult =
      createAof2FinancialPackage({
        documents,

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

      data: {
        passportId:
          query.passportId,

        scopePassportIds: [
          query.passportId
        ].filter(
          Boolean
        ),

        ...packageResult,

        storageProvider:
          getConfiguredFinancialStorageProviderId()
      }
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
   SCOPE SNAPSHOT
   ========================================================= */

async function getScopeSnapshot(
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
    const scopePassportIds =
      Array.from(
        new Set([
          query.rootPassportId,

          ...safeArray(
            query.scopePassportIds
          )
        ]
          .map(
            clean
          )
          .filter(
            Boolean
          )
        )
      );


    const documents =
      await loadScopeDocuments(
        scopePassportIds
      );


    const packageResult =
      createAof2FinancialPackage({
        documents,

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

      data: {
        rootPassportId:
          query.rootPassportId,

        scopePassportIds,

        ...packageResult,

        storageProvider:
          getConfiguredFinancialStorageProviderId()
      }
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

async function getHealth() {
  const provider =
    getProvider();


  try {
    const persistence =
      await provider
        .getFinancialPersistenceHealth();


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
              typeof provider
                .getFinancialAuditEvents ===
                  "function",

            idempotency:
              true
          }),

        storageProvider:
          describeFinancialStorageProvider(),

        persistence
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
