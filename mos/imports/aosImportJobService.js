"use strict";

const crypto =
  require("crypto");

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  readJsonFile,
  writeJsonFileAtomic
} = require("../storage/jsonStore");

const {
  cleanText,
  nowIso
} = require("../util/normalize");

const {
  MosError
} = require("../errors/MosError");


const JOB_VERSION =
  "ixi-aos-import-job-v1";

const JOB_STATUSES =
  new Set([
    "draft",
    "ready",
    "processing",
    "completed",
    "completed-with-errors",
    "failed",
    "cancelled"
  ]);

const ROW_STATUSES =
  new Set([
    "ready",
    "processing",
    "created",
    "invalid",
    "failed",
    "failed-retryable"
  ]);


function readStore() {
  const value =
    readJsonFile(
      MOS_PATHS.importJobs,
      {}
    );

  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new MosError(
      "AOS_IMPORT_STORE_INVALID",
      "AOS Import Job store must contain an object.",
      null,
      500
    );
  }

  return value;
}


function writeStore(store) {
  writeJsonFileAtomic(
    MOS_PATHS.importJobs,
    store
  );

  return store;
}


function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}


function safeObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? { ...value }
    : {};
}


function safeArray(value) {
  return Array.isArray(value)
    ? [...value]
    : [];
}


function requireText(
  value,
  code,
  message
) {
  const normalized =
    cleanText(value);

  if (!normalized) {
    throw new MosError(
      code,
      message,
      null,
      400
    );
  }

  return normalized;
}


function getJob(jobId) {
  const id =
    cleanText(jobId);

  if (!id) {
    return null;
  }

  return readStore()[id] || null;
}


function requireJob(jobId) {
  const job =
    getJob(jobId);

  if (!job) {
    throw new MosError(
      "AOS_IMPORT_JOB_NOT_FOUND",
      "AOS Import Job was not found.",
      {
        jobId:
          cleanText(jobId)
      },
      404
    );
  }

  return job;
}


function assertEntityOwnership(
  job,
  entityId
) {
  if (
    cleanText(job?.entityId) !==
    cleanText(entityId)
  ) {
    throw new MosError(
      "AOS_IMPORT_JOB_ENTITY_MISMATCH",
      "AOS Import Job does not belong to this Entity.",
      {
        jobId:
          job?.jobId || null
      },
      403
    );
  }
}


function normalizeMapping(mapping) {
  return safeObject(mapping);
}


function normalizeRow({
  jobId,
  row,
  index
}) {
  const rowNumber =
    Number(
      row?.rowNumber ??
      index + 2
    );

  const rowKey =
    cleanText(
      row?.rowKey
    ) ||
    `row:${rowNumber}`;

  return {
    rowId:
      cleanText(
        row?.rowId
      ) ||
      createId("importrow"),

    rowKey,

    rowNumber,

    status:
      ROW_STATUSES.has(
        cleanText(row?.status)
      )
        ? cleanText(row.status)
        : "ready",

    values:
      safeObject(
        row?.values
      ),

    normalizedInput:
      safeObject(
        row?.normalizedInput
      ),

    validation:
      safeObject(
        row?.validation
      ),

    provisioningKey:
      cleanText(
        row?.provisioningKey
      ) ||
      `${jobId}:${rowKey}`,

    attempts:
      Number(
        row?.attempts || 0
      ),

    objectId:
      cleanText(
        row?.objectId
      ) || null,

    passportId:
      cleanText(
        row?.passportId
      ) || null,

    error:
      row?.error || null,

    createdAt:
      row?.createdAt ||
      nowIso(),

    updatedAt:
      row?.updatedAt ||
      nowIso(),

    startedAt:
      row?.startedAt ||
      null,

    completedAt:
      row?.completedAt ||
      null
  };
}


function summarizeRows(rows = []) {
  const summary = {
    total: 0,
    ready: 0,
    processing: 0,
    created: 0,
    invalid: 0,
    failed: 0,
    failedRetryable: 0
  };

  safeArray(rows).forEach(row => {
    summary.total += 1;

    switch (row?.status) {
      case "ready":
        summary.ready += 1;
        break;

      case "processing":
        summary.processing += 1;
        break;

      case "created":
        summary.created += 1;
        break;

      case "invalid":
        summary.invalid += 1;
        break;

      case "failed":
        summary.failed += 1;
        break;

      case "failed-retryable":
        summary.failedRetryable += 1;
        break;

      default:
        break;
    }
  });

  return summary;
}


function resolveJobStatus(rows) {
  const summary =
    summarizeRows(rows);

  if (
    summary.total > 0 &&
    summary.created ===
      summary.total
  ) {
    return "completed";
  }

  if (
    summary.processing > 0
  ) {
    return "processing";
  }

  if (
    summary.ready > 0 ||
    summary.failedRetryable > 0
  ) {
    return "ready";
  }

  if (
    summary.created > 0 &&
    (
      summary.invalid > 0 ||
      summary.failed > 0
    )
  ) {
    return "completed-with-errors";
  }

  if (
    summary.invalid > 0 ||
    summary.failed > 0
  ) {
    return "failed";
  }

  return "draft";
}


function createImportJob({
  entityId,
  actorId = null,

  sourceFile = {},
  definitionId = null,
  definitionKey = null,

  mapping = {},
  rows = [],

  metadata = {}
} = {}) {
  const normalizedEntityId =
    requireText(
      entityId,
      "AOS_IMPORT_ENTITY_REQUIRED",
      "entityId is required."
    );

  const fingerprint =
    requireText(
      sourceFile?.fingerprint,
      "AOS_IMPORT_FINGERPRINT_REQUIRED",
      "Source file fingerprint is required."
    );

  const store =
    readStore();

  const duplicate =
    Object.values(store)
      .find(job =>
        cleanText(job?.entityId) ===
          normalizedEntityId &&
        cleanText(
          job?.sourceFile?.fingerprint
        ) === fingerprint &&
        job?.status !== "cancelled"
      );

  if (duplicate) {
    return {
      job:
        duplicate,
      duplicate: true
    };
  }

  const jobId =
    createId("importjob");

  const normalizedRows =
    safeArray(rows)
      .map((row, index) =>
        normalizeRow({
          jobId,
          row,
          index
        })
      );

  const timestamp =
    nowIso();

  const job = {
    contractVersion:
      JOB_VERSION,

    jobId,

    entityId:
      normalizedEntityId,

    actorId:
      cleanText(actorId) ||
      null,

    status:
      normalizedRows.length
        ? resolveJobStatus(
            normalizedRows
          )
        : "draft",

    sourceFile: {
      name:
        cleanText(
          sourceFile?.name
        ),

      size:
        Number(
          sourceFile?.size || 0
        ),

      type:
        cleanText(
          sourceFile?.type
        ),

      fingerprint
    },

    definitionId:
      cleanText(
        definitionId
      ) || null,

    definitionKey:
      cleanText(
        definitionKey
      ) || null,

    mapping:
      normalizeMapping(
        mapping
      ),

    mappingLocked:
      normalizedRows.length > 0,

    rows:
      normalizedRows,

    summary:
      summarizeRows(
        normalizedRows
      ),

    metadata:
      safeObject(metadata),

    createdAt:
      timestamp,

    updatedAt:
      timestamp,

    startedAt:
      null,

    completedAt:
      null,

    cancelledAt:
      null
  };

  store[jobId] =
    job;

  writeStore(store);

  return {
    job,
    duplicate: false
  };
}


function listImportJobs({
  entityId,
  status = null
} = {}) {
  const normalizedEntityId =
    requireText(
      entityId,
      "AOS_IMPORT_ENTITY_REQUIRED",
      "entityId is required."
    );

  const normalizedStatus =
    cleanText(status);

  return Object.values(
    readStore()
  )
    .filter(job =>
      cleanText(job?.entityId) ===
      normalizedEntityId
    )
    .filter(job =>
      !normalizedStatus ||
      job.status ===
        normalizedStatus
    )
    .sort(
      (a, b) =>
        String(b.updatedAt)
          .localeCompare(
            String(a.updatedAt)
          )
    );
}


function getImportJob({
  jobId,
  entityId
}) {
  const job =
    requireJob(jobId);

  assertEntityOwnership(
    job,
    entityId
  );

  return job;
}


function updateImportJobMapping({
  jobId,
  entityId,
  definitionId = null,
  definitionKey = null,
  mapping = {}
}) {
  const store =
    readStore();

  const job =
    store[
      cleanText(jobId)
    ];

  if (!job) {
    throw new MosError(
      "AOS_IMPORT_JOB_NOT_FOUND",
      "AOS Import Job was not found.",
      { jobId },
      404
    );
  }

  assertEntityOwnership(
    job,
    entityId
  );

  if (job.mappingLocked) {
    throw new MosError(
      "AOS_IMPORT_MAPPING_LOCKED",
      "Import mapping is locked after rows have been staged.",
      {
        jobId:
          job.jobId
      },
      409
    );
  }

  job.definitionId =
    cleanText(definitionId) ||
    null;

  job.definitionKey =
    cleanText(definitionKey) ||
    null;

  job.mapping =
    normalizeMapping(mapping);

  job.updatedAt =
    nowIso();

  writeStore(store);

  return job;
}


function stageImportRows({
  jobId,
  entityId,
  rows = []
}) {
  const store =
    readStore();

  const job =
    store[
      cleanText(jobId)
    ];

  if (!job) {
    throw new MosError(
      "AOS_IMPORT_JOB_NOT_FOUND",
      "AOS Import Job was not found.",
      { jobId },
      404
    );
  }

  assertEntityOwnership(
    job,
    entityId
  );

  if (
    job.rows?.length
  ) {
    throw new MosError(
      "AOS_IMPORT_ROWS_ALREADY_STAGED",
      "Import rows have already been staged for this job.",
      {
        jobId:
          job.jobId
      },
      409
    );
  }

  job.rows =
    safeArray(rows)
      .map((row, index) =>
        normalizeRow({
          jobId:
            job.jobId,
          row,
          index
        })
      );

  job.mappingLocked = true;

  job.summary =
    summarizeRows(job.rows);

  job.status =
    resolveJobStatus(
      job.rows
    );

  job.updatedAt =
    nowIso();

  writeStore(store);

  return job;
}


function updateImportRow({
  jobId,
  entityId,
  rowId,
  patch = {}
}) {
  const store =
    readStore();

  const job =
    store[
      cleanText(jobId)
    ];

  if (!job) {
    throw new MosError(
      "AOS_IMPORT_JOB_NOT_FOUND",
      "AOS Import Job was not found.",
      { jobId },
      404
    );
  }

  assertEntityOwnership(
    job,
    entityId
  );

  const index =
    safeArray(job.rows)
      .findIndex(row =>
        cleanText(row?.rowId) ===
        cleanText(rowId)
      );

  if (index < 0) {
    throw new MosError(
      "AOS_IMPORT_ROW_NOT_FOUND",
      "AOS Import Job row was not found.",
      {
        jobId:
          job.jobId,
        rowId:
          cleanText(rowId)
      },
      404
    );
  }

  const current =
    job.rows[index];

  const requestedStatus =
    cleanText(
      patch?.status
    );

  if (
    requestedStatus &&
    !ROW_STATUSES.has(
      requestedStatus
    )
  ) {
    throw new MosError(
      "AOS_IMPORT_ROW_STATUS_INVALID",
      "Import row status is invalid.",
      {
        status:
          requestedStatus
      },
      400
    );
  }

  /*
   * CREATED is terminal for identity.
   * Never allow another result to replace
   * the permanent Object + Passport pair.
   */
  if (
    current.status ===
      "created" &&
    (
      (
        patch.objectId &&
        cleanText(
          patch.objectId
        ) !==
        cleanText(
          current.objectId
        )
      ) ||
      (
        patch.passportId &&
        cleanText(
          patch.passportId
        ) !==
        cleanText(
          current.passportId
        )
      )
    )
  ) {
    throw new MosError(
      "AOS_IMPORT_ROW_IDENTITY_CONFLICT",
      "Created import row identity cannot be replaced.",
      {
        rowId:
          current.rowId,
        objectId:
          current.objectId,
        passportId:
          current.passportId
      },
      409
    );
  }

  const next = {
    ...current,

    ...safeObject(patch),

    rowId:
      current.rowId,

    rowKey:
      current.rowKey,

    provisioningKey:
      current.provisioningKey,

    status:
      requestedStatus ||
      current.status,

    updatedAt:
      nowIso()
  };

  if (
    next.status ===
      "processing" &&
    !next.startedAt
  ) {
    next.startedAt =
      nowIso();

    next.attempts =
      Number(
        current.attempts || 0
      ) + 1;
  }

  if (
    next.status ===
      "created"
  ) {
    next.objectId =
      requireText(
        next.objectId,
        "AOS_IMPORT_ROW_OBJECT_REQUIRED",
        "Created import row requires objectId."
      );

    next.passportId =
      requireText(
        next.passportId,
        "AOS_IMPORT_ROW_PASSPORT_REQUIRED",
        "Created import row requires passportId."
      );

    next.completedAt =
      next.completedAt ||
      nowIso();

    next.error = null;
  }

  job.rows[index] =
    next;

  job.summary =
    summarizeRows(
      job.rows
    );

  job.status =
    resolveJobStatus(
      job.rows
    );

  if (
    job.status ===
      "processing" &&
    !job.startedAt
  ) {
    job.startedAt =
      nowIso();
  }

  if (
    job.status ===
      "completed" ||
    job.status ===
      "completed-with-errors"
  ) {
    job.completedAt =
      job.completedAt ||
      nowIso();
  }

  job.updatedAt =
    nowIso();

  writeStore(store);

  return {
    job,
    row:
      next
  };
}


function cancelImportJob({
  jobId,
  entityId
}) {
  const store =
    readStore();

  const job =
    store[
      cleanText(jobId)
    ];

  if (!job) {
    throw new MosError(
      "AOS_IMPORT_JOB_NOT_FOUND",
      "AOS Import Job was not found.",
      { jobId },
      404
    );
  }

  assertEntityOwnership(
    job,
    entityId
  );

  if (
    job.status ===
      "completed"
  ) {
    throw new MosError(
      "AOS_IMPORT_COMPLETED_JOB_IMMUTABLE",
      "Completed import job cannot be cancelled.",
      {
        jobId:
          job.jobId
      },
      409
    );
  }

  job.status =
    "cancelled";

  job.cancelledAt =
    nowIso();

  job.updatedAt =
    nowIso();

  writeStore(store);

  return job;
}


module.exports = {
  JOB_VERSION,
  JOB_STATUSES,
  ROW_STATUSES,

  summarizeRows,
  resolveJobStatus,

  createImportJob,
  listImportJobs,
  getImportJob,

  updateImportJobMapping,
  stageImportRows,
  updateImportRow,

  cancelImportJob
};
