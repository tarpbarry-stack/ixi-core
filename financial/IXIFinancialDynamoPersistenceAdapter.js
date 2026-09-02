"use strict";

/*
 * IXI FINANCIAL DYNAMODB PERSISTENCE ADAPTER
 *
 * PURPOSE
 * -------
 *
 * Make DynamoDB expose the same high-level
 * persistence behavior as the proven
 * local-json Financial Persistence Engine.
 *
 *
 * DOMAIN FLOW
 * -----------
 *
 * canonical financialDocument
 *        ↓
 * validation
 *        ↓
 * canonical server record
 *        ↓
 * DynamoDB physical store
 *
 *
 * IMPORTANT
 * ---------
 *
 * This adapter owns persistence semantics.
 *
 * IXIFinancialDynamoStore owns only DynamoDB
 * physical reads/writes.
 */


const {
  createFinancialDocumentRecord
} =
  require(
    "./IXIFinancialServerContract"
  );


const {
  assertValidFinancialDocument
} =
  require(
    "./IXIFinancialValidationBridge"
  );


const {
  collectDocumentPassportIds
} =
  require(
    "./IXIFinancialDocumentIdentity"
  );


const store =
  require(
    "./IXIFinancialDynamoStore"
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
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}


function nowIso() {
  return new Date()
    .toISOString();
}


function createPersistenceError(
  name,
  message,
  details = {}
) {
  const error =
    new Error(
      message
    );

  error.name =
    name;

  error.details = {
    ...safeObject(
      details
    )
  };

  return error;
}


/* =========================================================
   READ
   ========================================================= */

async function getFinancialDocumentRecord(
  financialDocumentId
) {
  return store
    .getCurrentDocumentRecord(
      financialDocumentId
    );
}


async function getFinancialDocument(
  financialDocumentId
) {
  const record =
    await getFinancialDocumentRecord(
      financialDocumentId
    );

  return record
    ?.financialDocument ||
    null;
}


async function getFinancialDocumentHistory(
  financialDocumentId
) {
  return store
    .getFinancialDocumentHistory(
      financialDocumentId
    );
}


async function getIdempotencyRecord(
  idempotencyKey
) {
  return store
    .getIdempotencyRecord(
      idempotencyKey
    );
}


async function getPassportDocumentIds(
  passportId
) {
  return store
    .getPassportDocumentIds(
      passportId
    );
}


/* =========================================================
   CREATE
   ========================================================= */

async function createFinancialDocument({
  financialDocument,
  actorPassportId = "",
  entityPassportId = "",
  commandId = "",
  idempotencyKey = "",
  metadata = {}
} = {}) {
  const key =
    clean(
      idempotencyKey
    );


  if (
    key
  ) {
    const previous =
      await store
        .getIdempotencyRecord(
          key
        );


    if (
      previous
    ) {
      const existingReplay =
        await store
          .getCurrentDocumentRecord(
            previous
              .financialDocumentId
          );


      if (
        existingReplay
      ) {
        return {
          created:
            false,

          idempotentReplay:
            true,

          indexedPassportIds:
            collectDocumentPassportIds(
              existingReplay
                .financialDocument
            ),

          record:
            existingReplay
        };
      }
    }
  }


  const validatedDocument =
    assertValidFinancialDocument(
      financialDocument
    );


  const financialDocumentId =
    clean(
      validatedDocument
        .financialDocumentId
    );


  const existing =
    await store
      .getCurrentDocumentRecord(
        financialDocumentId
      );


  if (
    existing
  ) {
    throw createPersistenceError(
      "IXIFinancialConflictError",
      `Financial document already exists: ${financialDocumentId}`,
      {
        financialDocumentId
      }
    );
  }


  const timestamp =
    nowIso();


  const record =
    createFinancialDocumentRecord({
      financialDocument:
        validatedDocument,

      revision:
        1,

      createdAt:
        timestamp,

      updatedAt:
        timestamp,

      createdByPassportId:
        actorPassportId,

      updatedByPassportId:
        actorPassportId,

      entityPassportId,

      idempotencyKey:
        key,

      storageMetadata: {
        provider:
          "dynamodb",

        region:
          store.REGION,

        tableName:
          store.TABLE_NAME,

        ...safeObject(
          metadata
        )
      }
    });


  const indexedPassportIds =
    collectDocumentPassportIds(
      validatedDocument
    );


  try {
    await store
      .createDocumentRecord({
        record,

        passportIds:
          indexedPassportIds,

        idempotencyKey:
          key,

        commandId,

        actorPassportId
      });
  } catch (
    error
  ) {
    /*
     * Convert Dynamo conditional conflicts into
     * the canonical Financial conflict type.
     */
    if (
      error?.name ===
        "TransactionCanceledException" ||
      error?.name ===
        "ConditionalCheckFailedException"
    ) {
      throw createPersistenceError(
        "IXIFinancialConflictError",
        `Financial document create conflict: ${financialDocumentId}`,
        {
          financialDocumentId
        }
      );
    }

    throw error;
  }


  return {
    created:
      true,

    idempotentReplay:
      false,

    indexedPassportIds,

    record
  };
}


/* =========================================================
   REPLACE
   ========================================================= */

async function replaceFinancialDocument({
  financialDocument,
  actorPassportId = "",
  commandId = "",
  idempotencyKey = "",
  expectedRevision = null,
  metadata = {}
} = {}) {
  const key =
    clean(
      idempotencyKey
    );


  if (
    key
  ) {
    const previous =
      await store
        .getIdempotencyRecord(
          key
        );


    if (
      previous
    ) {
      const replay =
        await store
          .getCurrentDocumentRecord(
            previous
              .financialDocumentId
          );


      if (
        replay
      ) {
        return {
          updated:
            false,

          idempotentReplay:
            true,

          indexedPassportIds:
            collectDocumentPassportIds(
              replay
                .financialDocument
            ),

          record:
            replay
        };
      }
    }
  }


  const validatedDocument =
    assertValidFinancialDocument(
      financialDocument
    );


  const financialDocumentId =
    clean(
      validatedDocument
        .financialDocumentId
    );


  const existing =
    await store
      .getCurrentDocumentRecord(
        financialDocumentId
      );


  if (
    !existing
  ) {
    throw createPersistenceError(
      "IXIFinancialNotFoundError",
      `Financial document not found: ${financialDocumentId}`,
      {
        financialDocumentId
      }
    );
  }


  const currentRevision =
    Number(
      existing
        ?.server
        ?.revision ||
      0
    );


  if (
    expectedRevision !==
      null &&
    expectedRevision !==
      undefined &&
    Number(
      expectedRevision
    ) !==
      currentRevision
  ) {
    throw createPersistenceError(
      "IXIFinancialRevisionConflictError",
      `Expected revision ${expectedRevision}; current revision is ${currentRevision}.`,
      {
        financialDocumentId,

        expectedRevision:
          Number(
            expectedRevision
          ),

        currentRevision
      }
    );
  }


  const previousPassportIds =
    await store
      .getDocumentPassportIds(
        financialDocumentId
      );


  const indexedPassportIds =
    collectDocumentPassportIds(
      validatedDocument
    );


  const nextRevision =
    currentRevision +
    1;


  const timestamp =
    nowIso();


  const record =
    createFinancialDocumentRecord({
      financialDocument:
        validatedDocument,

      revision:
        nextRevision,

      createdAt:
        existing
          ?.server
          ?.createdAt ||
        timestamp,

      updatedAt:
        timestamp,

      createdByPassportId:
        existing
          ?.server
          ?.createdByPassportId ||
        "",

      updatedByPassportId:
        actorPassportId,

      entityPassportId:
        existing
          ?.server
          ?.entityPassportId ||
        "",

      idempotencyKey:
        key,

      storageMetadata: {
        ...safeObject(
          existing
            ?.server
            ?.storageMetadata
        ),

        ...safeObject(
          metadata
        ),

        provider:
          "dynamodb",

        region:
          store.REGION,

        tableName:
          store.TABLE_NAME
      }
    });


  try {
    await store
      .replaceDocumentRecord({
        record,

        previousRecord:
          existing,

        passportIds:
          indexedPassportIds,

        previousPassportIds,

        idempotencyKey:
          key,

        commandId,

        actorPassportId
      });
  } catch (
    error
  ) {
    if (
      error?.name ===
        "TransactionCanceledException" ||
      error?.name ===
        "ConditionalCheckFailedException"
    ) {
      throw createPersistenceError(
        "IXIFinancialRevisionConflictError",
        `Financial document revision conflict: ${financialDocumentId}`,
        {
          financialDocumentId,

          expectedRevision:
            currentRevision
        }
      );
    }

    throw error;
  }


  return {
    updated:
      true,

    idempotentReplay:
      false,

    indexedPassportIds,

    record
  };
}


/* =========================================================
   LIST BY ENTITY
   ========================================================= */

async function listFinancialDocumentsByEntity(
  entityPassportId
) {
  const ids =
    await store
      .getEntityDocumentIds(
        entityPassportId
      );


  const records =
    await Promise.all(
      ids.map(
        financialDocumentId =>
          store
            .getCurrentDocumentRecord(
              financialDocumentId
            )
      )
    );


  return records.filter(
    Boolean
  );
}


/* =========================================================
   LIST BY PASSPORT
   ========================================================= */

async function listFinancialDocumentsByPassport(
  passportId
) {
  const ids =
    await store
      .getPassportDocumentIds(
        passportId
      );


  const records =
    await Promise.all(
      ids.map(
        financialDocumentId =>
          store
            .getCurrentDocumentRecord(
              financialDocumentId
            )
      )
    );


  return records.filter(
    Boolean
  );
}


/* =========================================================
   AUDIT
   ========================================================= */

async function appendFinancialAuditEvent(
  event
) {
  return store
    .appendAuditEvent(
      event
    );
}


async function getFinancialAuditEvents(
  financialDocumentId
) {
  return store
    .getAuditEvents(
      financialDocumentId
    );
}


/* =========================================================
   HEALTH
   ========================================================= */

async function getFinancialPersistenceHealth() {
  const health =
    await store
      .getDynamoFinancialHealth();


  return {
    ...health,

    adapter:
      "IXIFinancialDynamoPersistenceAdapter"
  };
}


/* =========================================================
   EXPORTS
   ========================================================= */

module.exports = {
  providerId:
    "dynamodb",

  getFinancialDocumentRecord,
  getFinancialDocument,

  getFinancialDocumentHistory,

  getIdempotencyRecord,

  getPassportDocumentIds,

  createFinancialDocument,
  replaceFinancialDocument,

  listFinancialDocumentsByEntity,
  listFinancialDocumentsByPassport,

  appendFinancialAuditEvent,
  getFinancialAuditEvents,

  getFinancialPersistenceHealth
};
