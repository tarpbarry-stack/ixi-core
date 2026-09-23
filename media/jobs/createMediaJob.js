const crypto = require("crypto");

const {
  SQSClient,
  GetQueueUrlCommand,
  SendMessageCommand
} = require("@aws-sdk/client-sqs");

const {
  REGION,
  QUEUE_NAME
} = require("../config/mediaConfig");

const {
  applyMediaPolicy
} = require("../config/mediaPolicy");

const {
  getMediaJob,
  saveMediaJob,
  updateMediaJob
} = require("../storage/mediaJobStore");

const sqs = new SQSClient({
  region: REGION
});

let cachedQueueUrl = "";

async function getQueueUrl() {
  if (cachedQueueUrl) {
    return cachedQueueUrl;
  }

  const response = await sqs.send(
    new GetQueueUrlCommand({
      QueueName: QUEUE_NAME
    })
  );

  if (!response.QueueUrl) {
    throw new Error(
      "IXI media queue URL was not returned"
    );
  }

  cachedQueueUrl = response.QueueUrl;

  return cachedQueueUrl;
}

function createJobId() {
  return `ixi-media-${Date.now()}-${crypto
    .randomBytes(8)
    .toString("hex")}`;
}

function normalizeMediaInputs({
  sourceType,
  imageUrls = [],
  mediaInputs = [],
  selectionMode = ""
} = {}) {
  if (
    Array.isArray(mediaInputs) &&
    mediaInputs.length > 0
  ) {
    return mediaInputs.map(
      (input, index) => ({
        ...input,

        inputType:
          String(
            input?.inputType || ""
          )
            .trim()
            .toLowerCase(),

        position:
          Number.isFinite(
            Number(input?.position)
          )
            ? Number(input.position)
            : index
      })
    );
  }

  if (
    Array.isArray(imageUrls) &&
    imageUrls.length > 0
  ) {
    const policyResult =
      applyMediaPolicy({
        sourceType,
        imageUrls,
        selectionMode
      });

    return policyResult.selectedUrls.map(
      (url, index) => ({
        inputType:
          "remote-url",

        url,

        position:
          index
      })
    );
  }

  return [];
}

function validateMediaInputs(
  mediaInputs = []
) {
  mediaInputs.forEach(
    (input, index) => {
      if (
        input.inputType ===
        "remote-url"
      ) {
        if (!input.url) {
          throw new Error(
            `Media input ${
              index + 1
            } is missing url`
          );
        }

        return;
      }

      if (
        input.inputType ===
        "s3-object"
      ) {
        if (
          !input.bucket ||
          !input.key
        ) {
          throw new Error(
            `Media input ${
              index + 1
            } is missing bucket or key`
          );
        }

        return;
      }

      throw new Error(
        `Unsupported media input type at position ${
          index + 1
        }: ${
          input.inputType ||
          "missing"
        }`
      );
    }
  );
}

async function createMediaJob({
  machineId,
  passportId = "",
  sourceType = "direct-upload",
  sourceUrl = "",
  imageUrls = [],
  mediaInputs = [],
  manifestMode = "replace",
  selectionMode = "",
  reservedJobId = "",
  requireComplete = false,
  retainIncoming = false,
  cleanupInputs = []
} = {}) {
  if (!machineId) {
    throw new Error(
      "Media job requires machineId"
    );
  }

  const normalizedInputs =
    normalizeMediaInputs({
      sourceType,
      imageUrls,
      mediaInputs,
      selectionMode
    });

  if (
    normalizedInputs.length === 0
  ) {
    throw new Error(
      "Media job requires imageUrls or mediaInputs"
    );
  }

  validateMediaInputs(
    normalizedInputs
  );

  if (reservedJobId && !/^ixi-post-free-[a-f0-9]{64}(?:-[0-9]+)?$/.test(reservedJobId)) throw new Error("Invalid reserved media job reference.");
  const jobId = reservedJobId || createJobId();
  let existingReserved = null;
  if (reservedJobId) {
    const existing = await getMediaJob(jobId);
    existingReserved = existing;
    if (existing) {
      if (existing.status === "superseded") throw new Error("This photo selection was replaced by a newer revision.");
      if (existing.machineId !== machineId || existing.passportId !== passportId || JSON.stringify(existing.mediaInputs) !== JSON.stringify(normalizedInputs)) throw new Error("Media job cannot be rebound to different inputs.");
      if (["processing", "complete"].includes(existing.status)) return existing;
    }
  }

  const now =
    new Date().toISOString();

  const remoteInputCount =
    normalizedInputs.filter(
      input =>
        input.inputType ===
        "remote-url"
    ).length;

  const s3InputCount =
    normalizedInputs.filter(
      input =>
        input.inputType ===
        "s3-object"
    ).length;

  const job = {
    version: 2,
    requireComplete,
    retainIncoming,
    cleanupInputs,

    jobId,

    type:
      "ixi-machine-media-ingestion",

    status:
      "creating",

    machineId:
      String(machineId),

    passportId:
      String(passportId || ""),

    sourceType:
      String(
        sourceType ||
        "direct-upload"
      ),

    sourceUrl:
      String(sourceUrl || ""),

    manifestMode:
      String(manifestMode || "")
        .trim()
        .toLowerCase() === "append"
          ? "append"
          : "replace",

    selectionMode:
      String(selectionMode || "")
        .trim()
        .toLowerCase() ||
      (
        Array.isArray(imageUrls) &&
        imageUrls.length > 0
          ? "all"
          : "manual"
      ),

    sourcePhotoCount:
      Array.isArray(imageUrls)
        ? imageUrls.length
        : normalizedInputs.length,

    importedPhotoCount:
      normalizedInputs.length,

    remoteInputCount,

    s3InputCount,

    mediaInputs:
      normalizedInputs,

    createdAt:
      now,

    updatedAt:
      now
  };

  // Persist the outbox before delivery. An ambiguous delivery can be replayed
  // with the same job ID; never reset a worker's state after sending to SQS.
  if (reservedJobId) {
    if (!existingReserved || !["queued", "processing", "complete"].includes(existingReserved.status))
      await saveMediaJob({ ...job, status: "queued" });
  } else await saveMediaJob(job);

  try {
    const queueUrl =
      await getQueueUrl();

    const queuedJob = {
      ...job,
      status:
        "queued"
    };

    const response =
      await sqs.send(
        new SendMessageCommand({
          QueueUrl:
            queueUrl,

          MessageBody:
            JSON.stringify(
              queuedJob
            ),

          MessageAttributes: {
            jobType: {
              DataType:
                "String",

              StringValue:
                "ixi-machine-media-ingestion"
            },

            sourceType: {
              DataType:
                "String",

              StringValue:
                String(
                  sourceType ||
                  "direct-upload"
                )
            }
          }
        })
      );

    if (!response.MessageId) {
      throw new Error(
        "SQS returned no message ID"
      );
    }

    if (reservedJobId) return (await getMediaJob(jobId)) || queuedJob;

    const saved =
      await updateMediaJob(
        jobId,
        {
          status:
            "queued",

          messageId:
            response.MessageId,

          queuedAt:
            new Date().toISOString(),

          error:
            null
        }
      );

    return saved.record;
  } catch (error) {
    if (reservedJobId) throw error;
    await updateMediaJob(
      jobId,
      {
        status:
          "failed",

        failedAt:
          new Date().toISOString(),

        error:
          error?.message ||
          "Unable to queue media job"
      }
    ).catch(() => {});

    throw error;
  }
}

module.exports = {
  getQueueUrl,
  createJobId,
  normalizeMediaInputs,
  validateMediaInputs,
  createMediaJob
};
