const {
  WORKER_IMAGE_CONCURRENCY
} = require("../config/mediaConfig");

const {
  loadMediaInput
} = require("../jobs/loadMediaInput");

const {
  optimizeImage
} = require("../jobs/optimizeImage");

const {
  uploadMediaToS3
} = require("../storage/uploadMediaToS3");

const {
  getMediaJob,
  saveMediaJob,
  updateMediaJob
} = require("../storage/mediaJobStore");

const {
  replaceMachineMediaManifest
} = require("../storage/machineMediaManifest");

const {
  cleanupIncomingObject
} = require("../storage/cleanupIncomingObject");

function normalizeJobInputs(job = {}) {
  if (
    Array.isArray(job.mediaInputs) &&
    job.mediaInputs.length > 0
  ) {
    return job.mediaInputs.map(
      (input, index) => ({
        ...input,
        position:
          Number.isFinite(
            Number(input.position)
          )
            ? Number(input.position)
            : index
      })
    );
  }

  /*
   * Backward compatibility for the remote URL jobs
   * already produced by createMediaJob.js.
   */
  if (
    Array.isArray(job.imageUrls) &&
    job.imageUrls.length > 0
  ) {
    return job.imageUrls.map(
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

async function mapWithConcurrency(
  items,
  concurrency,
  worker
) {
  const results =
    new Array(items.length);

  let nextIndex = 0;

  async function runLane() {
    while (true) {
      const index =
        nextIndex;

      nextIndex += 1;

      if (index >= items.length) {
        return;
      }

      try {
        results[index] = {
          ok: true,

          value:
            await worker(
              items[index],
              index
            )
        };
      } catch (error) {
        results[index] = {
          ok: false,

          error: {
            name:
              error?.name ||
              "Error",

            message:
              error?.message ||
              "Unknown media error"
          }
        };
      }
    }
  }

  const laneCount =
    Math.max(
      1,
      Math.min(
        Number(concurrency) || 1,
        items.length
      )
    );

  await Promise.all(
    Array.from(
      { length: laneCount },
      () => runLane()
    )
  );

  return results;
}

async function ensureJobRecord(job) {
  const existing =
    await getMediaJob(
      job.jobId
    );

  if (existing) {
    return existing;
  }

  const createdAt =
    job.createdAt ||
    new Date().toISOString();

  const saved =
    await saveMediaJob({
      ...job,

      status:
        "queued",

      createdAt
    });

  return saved.record;
}

function describeInput(input = {}) {
  if (
    input.inputType ===
    "remote-url"
  ) {
    return input.url || "";
  }

  if (
    input.inputType ===
    "s3-object"
  ) {
    return `s3://${input.bucket}/${input.key}`;
  }

  return "";
}

async function processOneInput({
  job,
  input,
  fallbackPosition
}) {
  const position =
    Number.isFinite(
      Number(input.position)
    )
      ? Number(input.position)
      : fallbackPosition;

  console.log(
    `[${job.jobId}] media ${
      position + 1
    } load`
  );

  const loaded =
    await loadMediaInput(
      input
    );

  console.log(
    `[${job.jobId}] media ${
      position + 1
    } optimize`
  );

  const optimized = await optimizeImage(loaded.buffer);
  if (input.sha256 && optimized.hash !== input.sha256) throw new Error("Source photo checksum mismatch.");
  if (input.rendition) {
    const presentation = await loadMediaInput(input.rendition);
    const edited = await optimizeImage(presentation.buffer);
    if (edited.hash !== input.rendition.sha256) throw new Error("Photo treatment checksum mismatch.");
    optimized.hero = edited.hero;
    optimized.display = edited.display;
    optimized.thumb = edited.thumb;
  }

  console.log(
    `[${job.jobId}] media ${
      position + 1
    } upload`
  );

  const inputReference =
    describeInput(input);

  const uploaded =
    await uploadMediaToS3({
      machineId:
        job.passportId ||
        job.machineId,

      hash:
        optimized.hash,

      position,

      originalBuffer:
        loaded.buffer,

      originalContentType:
        loaded.contentType,

      originalFormat:
        optimized.original.format,

      heroBuffer:
        optimized.hero.buffer,

      displayBuffer:
        optimized.display.buffer,

      thumbBuffer:
        optimized.thumb.buffer,

      sourceUrl:
        inputReference
    });

  let incomingCleanup = null;

  if (
    !job.retainIncoming &&
    loaded.inputType === "s3-object" &&
    loaded.bucket &&
    loaded.key
  ) {
    try {
      incomingCleanup =
        await cleanupIncomingObject({
          bucket:
            loaded.bucket,

          key:
            loaded.key
        });
    } catch (cleanupError) {
      console.error(
        `[${job.jobId}] incoming cleanup failed:`,
        cleanupError?.message ||
        cleanupError
      );

      incomingCleanup = {
        deleted: false,
        bucket:
          loaded.bucket,
        key:
          loaded.key,
        error:
          cleanupError?.message ||
          "Incoming cleanup failed"
      };
    }
  }

  return {
    position,

    inputType:
      loaded.inputType,

    sourceReference:
      inputReference,

    sourceUrl:
      loaded.sourceUrl || "",

    sourceBucket:
      loaded.bucket || "",

    sourceKey:
      loaded.key || "",

    incomingCleanup,

    hash:
      optimized.hash,

    original: {
      key:
        uploaded.originalKey,

      url:
        uploaded.originalUrl,

      bytes:
        optimized.original.bytes,

      width:
        optimized.original.width,

      height:
        optimized.original.height,

      format:
        optimized.original.format,

      contentType:
        loaded.contentType
    },

    hero: {
      key:
        uploaded.heroKey,

      url:
        uploaded.heroUrl,

      bytes:
        optimized.hero.bytes,

      width:
        optimized.hero.width,

      height:
        optimized.hero.height,

      contentType:
        optimized.hero.contentType
    },

    display: {
      key:
        uploaded.displayKey,

      url:
        uploaded.displayUrl,

      bytes:
        optimized.display.bytes,

      width:
        optimized.display.width,

      height:
        optimized.display.height,

      contentType:
        optimized.display.contentType
    },

    thumb: {
      key:
        uploaded.thumbKey,

      url:
        uploaded.thumbUrl,

      bytes:
        optimized.thumb.bytes,

      width:
        optimized.thumb.width,

      height:
        optimized.thumb.height,

      contentType:
        optimized.thumb.contentType
    }
  };
}

async function processMediaJobBody(job = {}, assertOwned = () => {}) {
  if (job.requireComplete && job.jobId) {
    const previous = await getMediaJob(job.jobId);
    if (previous?.status === "superseded" || (previous?.status === "complete" && previous.manifestKey)) return previous;
  }
  if (
    job.type !==
    "ixi-machine-media-ingestion"
  ) {
    throw new Error(
      `Unsupported media job type: ${
        job.type || "missing"
      }`
    );
  }

  if (!job.jobId) {
    throw new Error(
      "Media job is missing jobId"
    );
  }

  if (!job.machineId) {
    throw new Error(
      "Media job is missing machineId"
    );
  }

  const mediaInputs =
    normalizeJobInputs(job);

  if (
    mediaInputs.length === 0
  ) {
    throw new Error(
      "Media job has no media inputs"
    );
  }

  await ensureJobRecord(
    job
  );

  const startedAt =
    new Date().toISOString();

  await updateMediaJob(
    job.jobId,
    {
      status:
        "processing",

      startedAt,

      completedAt:
        null,

      error:
        null,

      mediaInputs
    }
  );

  console.log(
    `[${job.jobId}] processing ${
      mediaInputs.length
    } media input(s)`
  );

  const outcomes =
    await mapWithConcurrency(
      mediaInputs,

      WORKER_IMAGE_CONCURRENCY,

      async (
        input,
        index
      ) =>
        processOneInput({
          job,
          input,
          fallbackPosition:
            index
        })
    );

  const media = [];
  const failures = [];

  outcomes.forEach(
    (outcome, index) => {
      if (outcome?.ok) {
        media.push(
          outcome.value
        );
      } else {
        failures.push({
          position:
            mediaInputs[index]
              ?.position ?? index,

          input:
            mediaInputs[index],

          error:
            outcome?.error || {
              message:
                "Unknown media error"
            }
        });
      }
    }
  );

  media.sort(
    (a, b) =>
      a.position -
      b.position
  );

  const completedAt =
    new Date().toISOString();

  if (media.length === 0) {
    const message =
      failures
        .map(
          failure =>
            `#${Number(
              failure.position
            ) + 1}: ${
              failure.error
                ?.message ||
              "failed"
            }`
        )
        .join("; ");

    await updateMediaJob(
      job.jobId,
      {
        status:
          "failed",

        completedAt,

        processedPhotoCount:
          0,

        failedPhotoCount:
          failures.length,

        media:
          [],

        failures,

        error:
          message ||
          "All media items failed"
      }
    );

    throw new Error(
      message ||
      "All media items failed"
    );
  }

  if (job.requireComplete && failures.length) {
    const saved = await updateMediaJob(job.jobId, { status: "failed", completedAt,
      processedPhotoCount: media.length, failedPhotoCount: failures.length, media, failures,
      error: "Not all selected photos completed. The existing manifest was preserved; retry the same posting." });
    return saved.record;
  }

  const status =
    failures.length > 0
      ? "partial"
      : "complete";

  const saved =
    await updateMediaJob(
      job.jobId,
      {
        status: job.requireComplete ? "processing" : status,

        completedAt,

        processedPhotoCount:
          media.length,

        failedPhotoCount:
          failures.length,

        media,

        failures,

        error:
          null
      }
    );

  assertOwned();
  const manifest =
    await replaceMachineMediaManifest({
      job: saved.record,
      media
    });

  await updateMediaJob(
    job.jobId,
    {
      ...(job.requireComplete ? { status: "complete" } : {}),
      manifestKey:
        manifest.manifestKey,

      manifestVersion:
        manifest.mediaVersion,

      heroMediaId:
        manifest.heroMediaId,

      canonicalMachineKey:
        manifest.canonicalMachineKey
    }
  );

  saved.record.status = status;
  saved.record.manifestKey =
    manifest.manifestKey;

  saved.record.manifestVersion =
    manifest.mediaVersion;

  saved.record.heroMediaId =
    manifest.heroMediaId;

  saved.record.canonicalMachineKey =
    manifest.canonicalMachineKey;

  console.log(
    `[${job.jobId}] ${status}: ${
      media.length
    } succeeded, ${
      failures.length
    } failed`
  );

  return saved.record;
}

async function processMediaJob(job = {}) {
  if (!job.requireComplete) return processMediaJobBody(job);
  const { acquireMediaJobLease } = require("../storage/mediaJobLease");
  const lease = await acquireMediaJobLease(job.jobId);
  try {
    const result = await processMediaJobBody(job, () => lease.assertOwned());
    if (result.status === "complete" && result.manifestKey && job.retainIncoming) {
      lease.assertOwned();
      // Only the completed, leased job can remove staging bytes. A redelivery
      // reads its persisted result and retries cleanup without reprocessing.
      const cleaned = new Set();
      for (const input of [...(job.mediaInputs || []), ...(job.cleanupInputs || [])]) {
        for (const source of [input, input.rendition].filter(Boolean)) {
          if (source.inputType !== "s3-object" || cleaned.has(`${source.bucket}/${source.key}`)) continue;
          cleaned.add(`${source.bucket}/${source.key}`);
          await cleanupIncomingObject({ bucket: source.bucket, key: source.key });
        }
      }
    }
    return result;
  } finally { await lease.release(); }
}

module.exports = {
  normalizeJobInputs,
  mapWithConcurrency,
  processOneInput,
  processMediaJob
};
