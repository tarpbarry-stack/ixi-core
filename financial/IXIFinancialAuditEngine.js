"use strict";

/*
 * IXI FINANCIAL AUDIT ENGINE
 *
 * PURPOSE
 * -------
 *
 * Immutable audit trail for financial actions.
 *
 *
 * AUDIT IS NOT DOCUMENT HISTORY.
 *
 * Document history answers:
 *
 *   WHAT DID THE DOCUMENT LOOK LIKE
 *   AT REVISION 1, 2, 3...?
 *
 *
 * Audit answers:
 *
 *   WHO DID WHAT?
 *   WHEN?
 *   TO WHAT?
 *   FROM WHERE?
 *   WITH WHAT COMMAND?
 *   WHAT CHANGED?
 *
 *
 * CORE RULE
 * ---------
 *
 * Financial audit events are APPEND ONLY.
 *
 * They are never edited in place.
 *
 *
 * EVENTS INCLUDE
 * --------------
 *
 * create
 * replace
 * approve
 * reject
 * void
 * reverse
 * payment
 * assignment
 * reference-change
 * import
 * export
 * adapter-sync
 *
 *
 * IMPORTANT
 * ---------
 *
 * This engine does NOT:
 *
 * - calculate accounting
 * - calculate rollups
 * - discover hierarchy
 * - authorize actions
 * - mutate Financial Documents
 */


const fs =
  require("fs");

const path =
  require("path");

const crypto =
  require("crypto");


const {
  DEFAULT_FINANCIAL_DATA_DIR
} =
  require(
    "./IXIFinancialPersistenceEngine"
  );


/* =========================================================
   STORAGE
   ========================================================= */

const AUDIT_DIR =
  path.join(
    DEFAULT_FINANCIAL_DATA_DIR,
    "audit"
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


function ensureAuditDirectory() {
  fs.mkdirSync(
    AUDIT_DIR,
    {
      recursive: true
    }
  );
}


function auditPath(
  financialDocumentId
) {
  return path.join(
    AUDIT_DIR,
    `${encodeId(
      financialDocumentId
    )}.json`
  );
}


/* =========================================================
   IO
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

    return JSON.parse(
      fs.readFileSync(
        filePath,
        "utf8"
      )
    );
  } catch (
    error
  ) {
    error.message =
      `Financial audit read failed: ${filePath}: ${error.message}`;

    throw error;
  }
}


function atomicWriteJson(
  filePath,
  value
) {
  ensureAuditDirectory();

  const temporaryPath =
    `${filePath}.${process.pid}.${randomId()}.tmp`;

  try {
    fs.writeFileSync(
      temporaryPath,
      JSON.stringify(
        value,
        null,
        2
      ),
      {
        encoding:
          "utf8",

        mode:
          0o600
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
      // best effort only
    }

    error.message =
      `Financial audit write failed: ${filePath}: ${error.message}`;

    throw error;
  }
}


/* =========================================================
   VALUE NORMALIZATION
   ========================================================= */

function normalizeAuditValue(
  value
) {
  if (
    value === undefined
  ) {
    return null;
  }

  if (
    value === null
  ) {
    return null;
  }

  if (
    typeof value ===
      "string"
  ) {
    return value;
  }

  if (
    typeof value ===
      "number" ||
    typeof value ===
      "boolean"
  ) {
    return value;
  }

  if (
    Array.isArray(
      value
    )
  ) {
    return value.map(
      normalizeAuditValue
    );
  }

  if (
    typeof value ===
      "object"
  ) {
    return Object.keys(
      value
    ).reduce(
      (
        result,
        key
      ) => {
        result[
          key
        ] =
          normalizeAuditValue(
            value[
              key
            ]
          );

        return result;
      },
      {}
    );
  }

  return clean(
    value
  );
}


/* =========================================================
   DEEP CHANGE DETECTION
   ========================================================= */

function stableJson(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return JSON.stringify(
      value ?? null
    );
  }

  if (
    Array.isArray(
      value
    )
  ) {
    return JSON.stringify(
      value.map(
        item =>
          JSON.parse(
            stableJson(
              item
            )
          )
      )
    );
  }

  if (
    typeof value ===
      "object"
  ) {
    const sorted =
      Object.keys(
        value
      )
        .sort()
        .reduce(
          (
            result,
            key
          ) => {
            result[
              key
            ] =
              JSON.parse(
                stableJson(
                  value[
                    key
                  ]
                )
              );

            return result;
          },
          {}
        );

    return JSON.stringify(
      sorted
    );
  }

  return JSON.stringify(
    value
  );
}


function valuesEqual(
  a,
  b
) {
  return stableJson(
    normalizeAuditValue(
      a
    )
  ) ===
    stableJson(
      normalizeAuditValue(
        b
      )
    );
}


/* =========================================================
   CHANGE COLLECTION
   ========================================================= */

function collectObjectChanges({
  before = {},
  after = {},
  prefix = ""
} = {}) {
  const left =
    safeObject(
      before
    );

  const right =
    safeObject(
      after
    );

  const keys =
    Array.from(
      new Set([
        ...Object.keys(
          left
        ),
        ...Object.keys(
          right
        )
      ])
    ).sort();


  const changes =
    [];


  keys.forEach(
    key => {
      const pathName =
        prefix
          ? `${prefix}.${key}`
          : key;

      const beforeValue =
        left[
          key
        ];

      const afterValue =
        right[
          key
        ];


      if (
        valuesEqual(
          beforeValue,
          afterValue
        )
      ) {
        return;
      }


      const bothObjects =
        beforeValue &&
        afterValue &&
        typeof beforeValue ===
          "object" &&
        typeof afterValue ===
          "object" &&
        !Array.isArray(
          beforeValue
        ) &&
        !Array.isArray(
          afterValue
        );


      if (
        bothObjects
      ) {
        changes.push(
          ...collectObjectChanges({
            before:
              beforeValue,

            after:
              afterValue,

            prefix:
              pathName
          })
        );

        return;
      }


      changes.push({
        path:
          pathName,

        before:
          normalizeAuditValue(
            beforeValue
          ),

        after:
          normalizeAuditValue(
            afterValue
          )
      });
    }
  );


  return changes;
}


/* =========================================================
   AUDIT EVENT
   ========================================================= */

function createFinancialAuditEvent({
  financialDocumentId = "",
  eventType = "",
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
  after = null,
  changes = null,
  metadata = {},
  occurredAt = ""
} = {}) {
  const resolvedDocumentId =
    clean(
      financialDocumentId
    );

  if (
    !resolvedDocumentId
  ) {
    throw new Error(
      "financialDocumentId is required for financial audit."
    );
  }

  const resolvedEventType =
    clean(
      eventType
    );

  if (
    !resolvedEventType
  ) {
    throw new Error(
      "eventType is required for financial audit."
    );
  }

  const resolvedChanges =
    Array.isArray(
      changes
    )
      ? changes
      : (
          before &&
          after
            ? collectObjectChanges({
                before,
                after
              })
            : []
        );


  return {
    financialAuditId:
      `ifa_${randomId()}`,

    financialDocumentId:
      resolvedDocumentId,

    eventType:
      resolvedEventType,

    actorPassportId:
      clean(
        actorPassportId
      ),

    entityPassportId:
      clean(
        entityPassportId
      ),

    commandId:
      clean(
        commandId
      ),

    idempotencyKey:
      clean(
        idempotencyKey
      ),

    requestId:
      clean(
        requestId
      ),

    source:
      clean(
        source
      ),

    sourceIp:
      clean(
        sourceIp
      ),

    userAgent:
      clean(
        userAgent
      ),

    revisionBefore:
      revisionBefore ===
        null ||
      revisionBefore ===
        undefined
        ? null
        : Number(
            revisionBefore
          ),

    revisionAfter:
      revisionAfter ===
        null ||
      revisionAfter ===
        undefined
        ? null
        : Number(
            revisionAfter
          ),

    changes:
      safeArray(
        resolvedChanges
      ),

    metadata: {
      ...safeObject(
        metadata
      )
    },

    occurredAt:
      clean(
        occurredAt
      ) ||
      nowIso()
  };
}


/* =========================================================
   APPEND
   ========================================================= */

function appendFinancialAuditEvent(
  event
) {
  const source =
    safeObject(
      event
    );

  const financialDocumentId =
    clean(
      source
        .financialDocumentId
    );

  if (
    !financialDocumentId
  ) {
    throw new Error(
      "financialDocumentId is required to append audit event."
    );
  }

  ensureAuditDirectory();

  const filePath =
    auditPath(
      financialDocumentId
    );

  const events =
    safeArray(
      readJson(
        filePath,
        []
      )
    );


  /*
   * Audit events are append-only.
   *
   * Duplicate audit IDs are rejected.
   */
  if (
    events.some(
      existing =>
        clean(
          existing
            ?.financialAuditId
        ) ===
          clean(
            source
              .financialAuditId
          )
    )
  ) {
    throw new Error(
      `Duplicate financialAuditId: ${source.financialAuditId}`
    );
  }


  events.push(
    source
  );


  atomicWriteJson(
    filePath,
    events
  );


  return source;
}


/* =========================================================
   CREATE + APPEND
   ========================================================= */

function recordFinancialAuditEvent(
  input = {}
) {
  const event =
    createFinancialAuditEvent(
      input
    );

  return appendFinancialAuditEvent(
    event
  );
}


/* =========================================================
   READ DOCUMENT AUDIT
   ========================================================= */

function getFinancialAuditEvents(
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
      auditPath(
        id
      ),
      []
    )
  );
}


/* =========================================================
   FILTER AUDIT
   ========================================================= */

function queryFinancialAuditEvents({
  financialDocumentId = "",
  eventType = "",
  actorPassportId = "",
  commandId = "",
  startAt = "",
  endAt = ""
} = {}) {
  const events =
    getFinancialAuditEvents(
      financialDocumentId
    );

  const resolvedEventType =
    clean(
      eventType
    );

  const resolvedActor =
    clean(
      actorPassportId
    );

  const resolvedCommand =
    clean(
      commandId
    );

  const startTime =
    startAt
      ? new Date(
          startAt
        ).getTime()
      : null;

  const endTime =
    endAt
      ? new Date(
          endAt
        ).getTime()
      : null;


  return events.filter(
    event => {
      if (
        resolvedEventType &&
        clean(
          event
            ?.eventType
        ) !==
          resolvedEventType
      ) {
        return false;
      }

      if (
        resolvedActor &&
        clean(
          event
            ?.actorPassportId
        ) !==
          resolvedActor
      ) {
        return false;
      }

      if (
        resolvedCommand &&
        clean(
          event
            ?.commandId
        ) !==
          resolvedCommand
      ) {
        return false;
      }


      if (
        startTime !== null ||
        endTime !== null
      ) {
        const eventTime =
          new Date(
            event
              ?.occurredAt ||
            0
          ).getTime();

        if (
          Number.isNaN(
            eventTime
          )
        ) {
          return false;
        }

        if (
          startTime !== null &&
          eventTime <
            startTime
        ) {
          return false;
        }

        if (
          endTime !== null &&
          eventTime >
            endTime
        ) {
          return false;
        }
      }


      return true;
    }
  );
}


/* =========================================================
   AUDIT SUMMARY
   ========================================================= */

function createFinancialAuditSummary(
  financialDocumentId
) {
  const events =
    getFinancialAuditEvents(
      financialDocumentId
    );

  const byType = {};

  const actors =
    new Set();

  events.forEach(
    event => {
      const type =
        clean(
          event
            ?.eventType ||
          "unknown"
        );

      byType[
        type
      ] =
        (
          byType[
            type
          ] ||
          0
        ) + 1;


      const actor =
        clean(
          event
            ?.actorPassportId
        );

      if (
        actor
      ) {
        actors.add(
          actor
        );
      }
    }
  );


  return {
    financialDocumentId:
      clean(
        financialDocumentId
      ),

    eventCount:
      events.length,

    actorPassportIds:
      Array.from(
        actors
      ),

    byEventType:
      byType,

    firstEventAt:
      clean(
        events[
          0
        ]
          ?.occurredAt
      ),

    lastEventAt:
      clean(
        events[
          events.length - 1
        ]
          ?.occurredAt
      )
  };
}


/* =========================================================
   HEALTH
   ========================================================= */

function getFinancialAuditHealth() {
  ensureAuditDirectory();

  const fileCount =
    fs
      .readdirSync(
        AUDIT_DIR
      )
      .filter(
        fileName =>
          fileName.endsWith(
            ".json"
          )
      )
      .length;

  return {
    provider:
      "local-json",

    auditDirectory:
      AUDIT_DIR,

    exists:
      fs.existsSync(
        AUDIT_DIR
      ),

    auditedDocumentCount:
      fileCount
  };
}


/* =========================================================
   EXPORTS
   ========================================================= */

module.exports = {
  AUDIT_DIR,

  ensureAuditDirectory,

  normalizeAuditValue,

  valuesEqual,
  collectObjectChanges,

  createFinancialAuditEvent,
  appendFinancialAuditEvent,
  recordFinancialAuditEvent,

  getFinancialAuditEvents,
  queryFinancialAuditEvents,

  createFinancialAuditSummary,

  getFinancialAuditHealth
};
