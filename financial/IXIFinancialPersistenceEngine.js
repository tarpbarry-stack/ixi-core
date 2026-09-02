"use strict";

/*
 * IXI FINANCIAL PERSISTENCE ENGINE
 *
 * PURPOSE
 * -------
 *
 * Durable server-side persistence for the
 * IXI Financial subsystem.
 *
 * RESPONSIBILITIES
 * ----------------
 *
 * - validate before persistence
 * - create canonical records
 * - revision control
 * - optimistic concurrency
 * - idempotency
 * - immutable revision history
 * - Passport indexing
 * - atomic writes
 *
 * IMPORTANT
 * ---------
 *
 * This engine does NOT calculate rollups.
 * It does NOT discover AOS hierarchy.
 * It does NOT own accounting adapters.
 *
 * STORAGE
 * -------
 *
 * Initial provider:
 * local durable JSON store
 *
 * The physical storage provider is kept
 * behind this engine so DynamoDB / S3 / RDS
 * can replace it later without changing the
 * Financial domain contract.
 */

const fs =
  require("fs");

const path =
  require("path");

const crypto =
  require("crypto");


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


/* =========================================================
   STORAGE LOCATION
   ========================================================= */

const DEFAULT_FINANCIAL_DATA_DIR =
  process.env.IXI_FINANCIAL_DATA_DIR ||
  path.join(
    process.cwd(),
    "data",
    "financial"
  );


const DOCUMENT_DIR =
  path.join(
    DEFAULT_FINANCIAL_DATA_DIR,
    "documents"
  );


const HISTORY_DIR =
  path.join(
    DEFAULT_FINANCIAL_DATA_DIR,
    "history"
  );


const IDEMPOTENCY_DIR =
  path.join(
    DEFAULT_FINANCIAL_DATA_DIR,
    "idempotency"
  );


const PASSPORT_INDEX_DIR =
  path.join(
    DEFAULT_FINANCIAL_DATA_DIR,
    "passport-index"
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


function nowIso() {
  return new Date()
    .toISOString();
}


function randomId() {
  return crypto
    .randomBytes(12)
    .toString("hex");
}


function hashKey(
  value
) {
  return crypto
    .createHash("sha256")
    .update(
      clean(value)
    )
    .digest("hex");
}


function encodeId(
  value
) {
  return Buffer
    .from(
      clean(value),
      "utf8"
    )
    .toString(
      "base64url"
    );
}


function ensureDirectories() {
  [
    DEFAULT_FINANCIAL_DATA_DIR,
    DOCUMENT_DIR,
    HISTORY_DIR,
    IDEMPOTENCY_DIR,
    PASSPORT_INDEX_DIR
  ]
    .forEach(
      directory => {
        fs.mkdirSync(
          directory,
          {
            recursive: true
          }
        );
      }
    );
}


function documentPath(
  financialDocumentId
) {
  return path.join(
    DOCUMENT_DIR,
    `${encodeId(
      financialDocumentId
    )}.json`
  );
}


function historyPath(
  financialDocumentId
) {
  return path.join(
    HISTORY_DIR,
    `${encodeId(
      financialDocumentId
    )}.json`
  );
}


function idempotencyPath(
  idempotencyKey
) {
  return path.join(
    IDEMPOTENCY_DIR,
    `${hashKey(
      idempotencyKey
    )}.json`
  );
}


function passportIndexPath(
  passportId
) {
  return path.join(
    PASSPORT_INDEX_DIR,
    `${encodeId(
      passportId
    )}.json`
  );
}


/* =========================================================
   JSON IO
   ========================================================= */

function readJson(
  filePath,
  fallback = null
) {
  try {
    if (
      !fs.existsSync(
        filePath
      )
    ) {
      return fallback;
    }

    const raw =
      fs.readFileSync(
        filePath,
        "utf8"
      );

    return JSON.parse(
      raw
    );
  } catch (
    error
  ) {
    error.message =
      `Financial storage read failed: ${filePath}: ${error.message}`;

    throw error;
  }
}


function atomicWriteJson(
  filePath,
  value
) {
  ensureDirectories();

  const temporaryPath =
    `${filePath}.${process.pid}.${randomId()}.tmp`;

  const body =
    JSON.stringify(
      value,
      null,
      2
    );

  try {
    fs.writeFileSync(
      temporaryPath,
      body,
      {
        encoding: "utf8",
        mode: 0o600
      }
    );

    fs.renameSync(
      temporaryPath,
      filePath
    );
  } catch (
    error
  ) {
    try {
      if (
        fs.existsSync(
          temporaryPath
        )
      ) {
        fs.unlinkSync(
          temporaryPath
        );
      }
    } catch {
      // best-effort cleanup
    }

    error.message =
      `Financial storage write failed: ${filePath}: ${error.message}`;

    throw error;
  }
}


/* =========================================================
   ERRORS
   ========================================================= */

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
   PASSPORT REFERENCE COLLECTION
   ========================================================= */

function collectDocumentPassportIds(
  financialDocument = {}
) {
  const document =
    safeObject(
      financialDocument
    );

  const passportIds =
    new Set();


  function collect(
    references
  ) {
    safeArray(
      references
    ).forEach(
      reference => {
        const passportId =
          clean(
            reference
              ?.passportId
          );

        if (
          passportId
        ) {
          passportIds.add(
            passportId
          );
        }
      }
    );
  }


  collect(
    document.references
  );


  safeArray(
    document.lines
  ).forEach(
    line => {
      collect(
        line?.references
      );
    }
  );


  return Array.from(
    passportIds
  );
}


/* =========================================================
   READ CURRENT RECORD
   ========================================================= */

function getFinancialDocumentRecord(
  financialDocumentId
) {
  const id =
    clean(
      financialDocumentId
    );

  if (
    !id
  ) {
    return null;
  }

  return readJson(
    documentPath(
      id
    ),
    null
  );
}


function getFinancialDocument(
  financialDocumentId
) {
  const record =
    getFinancialDocumentRecord(
      financialDocumentId
    );

  return record
    ?.financialDocument ||
    null;
}


/* =========================================================
   HISTORY
   ========================================================= */

function getFinancialDocumentHistory(
  financialDocumentId
) {
  const id =
    clean(
      financialDocumentId
    );

  if (
    !id
  ) {
    return [];
  }

  return safeArray(
    readJson(
      historyPath(
        id
      ),
      []
    )
  );
}


function appendFinancialDocumentHistory({
  financialDocumentId,
  record,
  operation = "",
  actorPassportId = "",
  commandId = ""
} = {}) {
  const id =
    clean(
      financialDocumentId
    );

  if (
    !id
  ) {
    throw createPersistenceError(
      "IXIFinancialPersistenceError",
      "financialDocumentId is required for history."
    );
  }

  const history =
    getFinancialDocumentHistory(
      id
    );

  const historyRecord = {
    historyId:
      `ifh_${randomId()}`,

    financialDocumentId:
      id,

    revision:
      Number(
        record
          ?.server
          ?.revision ||
        0
      ),

    operation:
      clean(
        operation
      ),

    actorPassportId:
      clean(
        actorPassportId
      ),

    commandId:
      clean(
        commandId
      ),

    recordedAt:
      nowIso(),

    record
  };

  history.push(
    historyRecord
  );

  atomicWriteJson(
    historyPath(
      id
    ),
    history
  );

  return historyRecord;
}


/* =========================================================
   IDEMPOTENCY
   ========================================================= */

function getIdempotencyRecord(
  idempotencyKey
) {
  const key =
    clean(
      idempotencyKey
    );

  if (
    !key
  ) {
    return null;
  }

  return readJson(
    idempotencyPath(
      key
    ),
    null
  );
}


function saveIdempotencyRecord({
  idempotencyKey,
  operation = "",
  financialDocumentId = "",
  revision = 0
} = {}) {
  const key =
    clean(
      idempotencyKey
    );

  if (
    !key
  ) {
    return null;
  }

  const record = {
    idempotencyKey:
      key,

    operation:
      clean(
        operation
      ),

    financialDocumentId:
      clean(
        financialDocumentId
      ),

    revision:
      Number(
        revision ||
        0
      ),

    completedAt:
      nowIso()
  };

  atomicWriteJson(
    idempotencyPath(
      key
    ),
    record
  );

  return record;
}


/* =========================================================
   PASSPORT INDEX
   ========================================================= */

function getPassportDocumentIds(
  passportId
) {
  const id =
    clean(
      passportId
    );

  if (
    !id
  ) {
    return [];
  }

  return safeArray(
    readJson(
      passportIndexPath(
        id
      ),
      []
    )
  );
}


function writePassportDocumentIds(
  passportId,
  documentIds
) {
  const id =
    clean(
      passportId
    );

  if (
    !id
  ) {
    return;
  }

  const unique =
    Array.from(
      new Set(
        safeArray(
          documentIds
        )
          .map(
            clean
          )
          .filter(
            Boolean
          )
      )
    );

  atomicWriteJson(
    passportIndexPath(
      id
    ),
    unique
  );
}


function indexFinancialDocument(
  financialDocument
) {
  const document =
    safeObject(
      financialDocument
    );

  const financialDocumentId =
    clean(
      document
        .financialDocumentId
    );

  if (
    !financialDocumentId
  ) {
    return [];
  }

  const passportIds =
    collectDocumentPassportIds(
      document
    );

  passportIds.forEach(
    passportId => {
      const current =
        getPassportDocumentIds(
          passportId
        );

      if (
        !current.includes(
          financialDocumentId
        )
      ) {
        current.push(
          financialDocumentId
        );

        writePassportDocumentIds(
          passportId,
          current
        );
      }
    }
  );

  return passportIds;
}


function removeFinancialDocumentFromPassportIndexes(
  financialDocument
) {
  const document =
    safeObject(
      financialDocument
    );

  const financialDocumentId =
    clean(
      document
        .financialDocumentId
    );

  if (
    !financialDocumentId
  ) {
    return [];
  }

  const passportIds =
    collectDocumentPassportIds(
      document
    );

  passportIds.forEach(
    passportId => {
      const next =
        getPassportDocumentIds(
          passportId
        ).filter(
          id =>
            id !==
            financialDocumentId
        );

      writePassportDocumentIds(
        passportId,
        next
      );
    }
  );

  return passportIds;
}


/* =========================================================
   CREATE
   ========================================================= */

function createFinancialDocument({
  financialDocument,
  actorPassportId = "",
  entityPassportId = "",
  commandId = "",
  idempotencyKey = "",
  metadata = {}
} = {}) {
  ensureDirectories();

  const key =
    clean(
      idempotencyKey
    );

  if (
    key
  ) {
    const previous =
      getIdempotencyRecord(
        key
      );

    if (
      previous
    ) {
      const existingReplay =
        getFinancialDocumentRecord(
          previous
            .financialDocumentId
        );

      if (
        existingReplay
      ) {
        return {
          created: false,
          idempotentReplay: true,
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
    getFinancialDocumentRecord(
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

      revision: 1,

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
          "local-json",

        ...safeObject(
          metadata
        )
      }
    });

  atomicWriteJson(
    documentPath(
      financialDocumentId
    ),
    record
  );

  appendFinancialDocumentHistory({
    financialDocumentId,

    record,

    operation:
      "create",

    actorPassportId,

    commandId
  });

  const indexedPassportIds =
    indexFinancialDocument(
      validatedDocument
    );

  saveIdempotencyRecord({
    idempotencyKey:
      key,

    operation:
      "create",

    financialDocumentId,

    revision:
      1
  });

  return {
    created: true,

    idempotentReplay: false,

    indexedPassportIds,

    record
  };
}


/* =========================================================
   REPLACE / NEW REVISION
   ========================================================= */

function replaceFinancialDocument({
  financialDocument,
  actorPassportId = "",
  commandId = "",
  idempotencyKey = "",
  expectedRevision = null,
  metadata = {}
} = {}) {
  ensureDirectories();

  const key =
    clean(
      idempotencyKey
    );

  if (
    key
  ) {
    const previous =
      getIdempotencyRecord(
        key
      );

    if (
      previous
    ) {
      const replay =
        getFinancialDocumentRecord(
          previous
            .financialDocumentId
        );

      if (
        replay
      ) {
        return {
          updated: false,
          idempotentReplay: true,
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
    getFinancialDocumentRecord(
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
    expectedRevision !== null &&
    expectedRevision !== undefined &&
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

  /*
   * Remove old Passport index entries first.
   * The new revision may have changed
   * references.
   */
  removeFinancialDocumentFromPassportIndexes(
    existing
      .financialDocument
  );

  const nextRevision =
    currentRevision + 1;

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
          "local-json"
      }
    });

  atomicWriteJson(
    documentPath(
      financialDocumentId
    ),
    record
  );

  appendFinancialDocumentHistory({
    financialDocumentId,

    record,

    operation:
      "replace",

    actorPassportId,

    commandId
  });

  const indexedPassportIds =
    indexFinancialDocument(
      validatedDocument
    );

  saveIdempotencyRecord({
    idempotencyKey:
      key,

    operation:
      "replace",

    financialDocumentId,

    revision:
      nextRevision
  });

  return {
    updated: true,

    idempotentReplay: false,

    indexedPassportIds,

    record
  };
}


/* =========================================================
   LIST BY PASSPORT
   ========================================================= */

function listFinancialDocumentsByPassport(
  passportId
) {
  const id =
    clean(
      passportId
    );

  if (
    !id
  ) {
    return [];
  }

  return getPassportDocumentIds(
    id
  )
    .map(
      financialDocumentId =>
        getFinancialDocumentRecord(
          financialDocumentId
        )
    )
    .filter(
      Boolean
    );
}


/* =========================================================
   LIST ALL CURRENT RECORDS
   ========================================================= */

function listAllFinancialDocumentRecords() {
  ensureDirectories();

  return fs
    .readdirSync(
      DOCUMENT_DIR
    )
    .filter(
      fileName =>
        fileName.endsWith(
          ".json"
        )
    )
    .map(
      fileName =>
        readJson(
          path.join(
            DOCUMENT_DIR,
            fileName
          ),
          null
        )
    )
    .filter(
      Boolean
    );
}


/* =========================================================
   STORAGE HEALTH
   ========================================================= */

function getFinancialPersistenceHealth() {
  ensureDirectories();

  return {
    provider:
      "local-json",

    root:
      DEFAULT_FINANCIAL_DATA_DIR,

    directories: {
      documents:
        fs.existsSync(
          DOCUMENT_DIR
        ),

      history:
        fs.existsSync(
          HISTORY_DIR
        ),

      idempotency:
        fs.existsSync(
          IDEMPOTENCY_DIR
        ),

      passportIndex:
        fs.existsSync(
          PASSPORT_INDEX_DIR
        )
    },

    documentCount:
      listAllFinancialDocumentRecords()
        .length
  };
}


/* =========================================================
   EXPORTS
   ========================================================= */

module.exports = {
  DEFAULT_FINANCIAL_DATA_DIR,

  ensureDirectories,

  collectDocumentPassportIds,

  getFinancialDocumentRecord,
  getFinancialDocument,

  getFinancialDocumentHistory,

  getIdempotencyRecord,

  getPassportDocumentIds,

  createFinancialDocument,
  replaceFinancialDocument,

  listFinancialDocumentsByPassport,
  listAllFinancialDocumentRecords,

  getFinancialPersistenceHealth
};
