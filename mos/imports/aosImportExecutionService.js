"use strict";

const {
  getImportJob,
  updateImportRow
} = require(
  "./aosImportJobService"
);

const {
  provisionAosObject
} = require(
  "../provisioning/aosObjectProvisioningService"
);

const {
  cleanText
} = require(
  "../util/normalize"
);

const {
  MosError
} = require(
  "../errors/MosError"
);


/* =========================================================
   HELPERS
   ========================================================= */

function safeObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? { ...value }
    : {};
}


function getImportRow({
  job,
  rowId
}) {
  return (
    Array.isArray(job?.rows)
      ? job.rows
      : []
  ).find(
    row =>
      cleanText(
        row?.rowId
      ) ===
      cleanText(rowId)
  ) || null;
}


function classifyExecutionError(
  error
) {
  const status =
    Number(
      error?.status ||
      error?.statusCode ||
      error?.httpStatus ||
      0
    );

  const code =
    cleanText(
      error?.code
    );

  /*
   * Validation / conflict failures are
   * deterministic and should not be
   * endlessly retried.
   */
  if (
    status === 400 ||
    status === 403 ||
    status === 404 ||
    status === 409
  ) {
    return {
      retryable: false,
      status:
        "failed"
    };
  }

  /*
   * Server/infrastructure failures can
   * safely be retried because the row's
   * provisioningKey is stable and the
   * Object provisioning engine itself is
   * idempotent.
   */
  if (
    status >= 500 ||
    !status
  ) {
    return {
      retryable: true,
      status:
        "failed-retryable"
    };
  }

  if (
    code ===
      "AOS_PROVISION_ALREADY_PROCESSING"
  ) {
    return {
      retryable: true,
      status:
        "failed-retryable"
    };
  }

  return {
    retryable: false,
    status:
      "failed"
  };
}


function createStoredError(
  error,
  classification
) {
  return {
    code:
      cleanText(
        error?.code
      ) ||
      "AOS_IMPORT_ROW_EXECUTION_FAILED",

    message:
      cleanText(
        error?.message
      ) ||
      "Import row execution failed.",

    status:
      Number(
        error?.status ||
        error?.statusCode ||
        0
      ) || null,

    retryable:
      classification.retryable ===
      true,

    details:
      error?.details ||
      null
  };
}


/* =========================================================
   EXECUTE ONE ROW
   ========================================================= */

function executeImportRow({
  jobId,
  entityId,
  rowId,
  actorId = null
}) {
  const job =
    getImportJob({
      jobId,
      entityId
    });

  if (
    job.status ===
      "cancelled"
  ) {
    throw new MosError(
      "AOS_IMPORT_JOB_CANCELLED",
      "Cancelled import job cannot execute rows.",
      {
        jobId:
          job.jobId
      },
      409
    );
  }

  const row =
    getImportRow({
      job,
      rowId
    });

  if (!row) {
    throw new MosError(
      "AOS_IMPORT_ROW_NOT_FOUND",
      "Import row was not found.",
      {
        jobId:
          job.jobId,
        rowId:
          cleanText(rowId)
      },
      404
    );
  }

  /*
   * CREATED is terminal.
   *
   * A replay returns the existing permanent
   * identity. We never call provisioning
   * again for a row already proven created.
   */
  if (
    row.status ===
      "created"
  ) {
    return {
      ok: true,
      replayed: true,

      jobId:
        job.jobId,

      row,

      identity: {
        objectId:
          row.objectId,

        passportId:
          row.passportId
      }
    };
  }

  if (
    row.status ===
      "invalid"
  ) {
    throw new MosError(
      "AOS_IMPORT_ROW_INVALID",
      "Invalid import row cannot be provisioned.",
      {
        jobId:
          job.jobId,
        rowId:
          row.rowId,
        validation:
          row.validation ||
          null
      },
      409
    );
  }

  if (
    row.status ===
      "processing"
  ) {
    throw new MosError(
      "AOS_IMPORT_ROW_ALREADY_PROCESSING",
      "Import row is already processing.",
      {
        jobId:
          job.jobId,
        rowId:
          row.rowId
      },
      409
    );
  }

  if (
    ![
      "ready",
      "failed-retryable"
    ].includes(
      row.status
    )
  ) {
    throw new MosError(
      "AOS_IMPORT_ROW_NOT_EXECUTABLE",
      "Import row is not in an executable state.",
      {
        jobId:
          job.jobId,
        rowId:
          row.rowId,
        status:
          row.status
      },
      409
    );
  }

  const normalizedInput =
    safeObject(
      row.normalizedInput
    );

  const displayName =
    cleanText(
      normalizedInput.displayName
    );

  if (!displayName) {
    const result =
      updateImportRow({
        jobId:
          job.jobId,

        entityId,

        rowId:
          row.rowId,

        patch: {
          status:
            "invalid",

          validation: {
            valid: false,

            errors: [
              {
                code:
                  "AOS_IMPORT_DISPLAY_NAME_REQUIRED",

                message:
                  "A durable AOS Object requires a customer-provided display name."
              }
            ]
          }
        }
      });

    return {
      ok: false,
      invalid: true,
      job:
        result.job,
      row:
        result.row
    };
  }

  /*
   * Claim PROCESSING before provisioning.
   *
   * The permanent provisioning command is
   * still protected independently by the
   * stable provisioningKey.
   */
  updateImportRow({
    jobId:
      job.jobId,

    entityId,

    rowId:
      row.rowId,

    patch: {
      status:
        "processing",

      error:
        null
    }
  });

  try {
    const provisioning =
      provisionAosObject({
        ...normalizedInput,

        entityId,

        definitionId:
          cleanText(
            normalizedInput
              .definitionId
          ) ||
          cleanText(
            job.definitionId
          ) ||
          null,

        definitionKey:
          cleanText(
            normalizedInput
              .definitionKey
          ) ||
          cleanText(
            job.definitionKey
          ) ||
          null,

        commandId:
          row.provisioningKey,

        actorId:
          cleanText(actorId) ||
          cleanText(job.actorId) ||
          null,

        source:
          cleanText(
            normalizedInput.source
          ) ||
          "aos-bulk-import",

        metadata: {
          ...safeObject(
            normalizedInput.metadata
          ),

          importJob: {
            jobId:
              job.jobId,

            rowId:
              row.rowId,

            rowKey:
              row.rowKey,

            rowNumber:
              row.rowNumber,

            sourceFingerprint:
              cleanText(
                job.sourceFile
                  ?.fingerprint
              )
          }
        }
      });

    const objectId =
      cleanText(
        provisioning
          ?.object
          ?.objectId ||
        provisioning
          ?.identity
          ?.objectId
      );

    const passportId =
      cleanText(
        provisioning
          ?.passport
          ?.passportId ||
        provisioning
          ?.identity
          ?.passportId
      );

    if (
      !objectId ||
      !passportId
    ) {
      throw new MosError(
        "AOS_IMPORT_PROVISION_IDENTITY_MISSING",
        "Provisioning completed without a verified Object and Passport identity.",
        {
          jobId:
            job.jobId,
          rowId:
            row.rowId
        },
        500
      );
    }

    const completed =
      updateImportRow({
        jobId:
          job.jobId,

        entityId,

        rowId:
          row.rowId,

        patch: {
          status:
            "created",

          objectId,
          passportId,

          error:
            null
        }
      });

    return {
      ok: true,
      replayed:
        provisioning.replayed ===
        true,

      job:
        completed.job,

      row:
        completed.row,

      provisioning,

      identity: {
        objectId,
        passportId
      }
    };

  } catch (error) {
    const classification =
      classifyExecutionError(
        error
      );

    const failed =
      updateImportRow({
        jobId:
          job.jobId,

        entityId,

        rowId:
          row.rowId,

        patch: {
          status:
            classification.status,

          error:
            createStoredError(
              error,
              classification
            )
        }
      });

    error.importJob = {
      jobId:
        job.jobId,

      rowId:
        row.rowId,

      rowStatus:
        failed.row.status,

      retryable:
        classification.retryable
    };

    throw error;
  }
}


/* =========================================================
   EXECUTE READY BATCH

   Bounded sequential server execution for
   now. This gives us deterministic durable
   state before introducing queue workers.
   ========================================================= */

function executeImportBatch({
  jobId,
  entityId,
  actorId = null,
  limit = 25
}) {
  const normalizedLimit =
    Math.min(
      Math.max(
        Number(limit || 25),
        1
      ),
      100
    );

  let job =
    getImportJob({
      jobId,
      entityId
    });

  if (
    job.status ===
      "cancelled"
  ) {
    throw new MosError(
      "AOS_IMPORT_JOB_CANCELLED",
      "Cancelled import job cannot execute.",
      {
        jobId:
          job.jobId
      },
      409
    );
  }

  const candidates =
    (
      Array.isArray(job.rows)
        ? job.rows
        : []
    )
      .filter(row =>
        [
          "ready",
          "failed-retryable"
        ].includes(
          row.status
        )
      )
      .slice(
        0,
        normalizedLimit
      );

  const results = [];

  for (
    const candidate
    of candidates
  ) {
    try {
      const result =
        executeImportRow({
          jobId:
            job.jobId,

          entityId,

          rowId:
            candidate.rowId,

          actorId
        });

      results.push({
        rowId:
          candidate.rowId,

        ok:
          result?.ok === true,

        objectId:
          result?.identity
            ?.objectId ||
          null,

        passportId:
          result?.identity
            ?.passportId ||
          null,

        replayed:
          result?.replayed ===
          true
      });

    } catch (error) {
      results.push({
        rowId:
          candidate.rowId,

        ok: false,

        error: {
          code:
            cleanText(
              error?.code
            ) ||
            "AOS_IMPORT_ROW_EXECUTION_FAILED",

          message:
            cleanText(
              error?.message
            ) ||
            "Import row execution failed.",

          retryable:
            error?.importJob
              ?.retryable ===
            true
        }
      });
    }
  }

  job =
    getImportJob({
      jobId:
        job.jobId,

      entityId
    });

  return {
    ok: true,

    job,

    executedCount:
      results.length,

    results
  };
}


module.exports = {
  classifyExecutionError,
  executeImportRow,
  executeImportBatch
};
