const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand
} = require("@aws-sdk/client-s3");

const {
  REGION,
  BUCKET
} = require("../config/mediaConfig");

const s3 = new S3Client({
  region: REGION
});

function sanitizeJobId(jobId = "") {
  const clean = String(jobId || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!clean) {
    throw new Error(
      "Media job store requires jobId"
    );
  }

  return clean;
}

function buildJobKey(jobId) {
  return `media-jobs/${sanitizeJobId(jobId)}.json`;
}

async function saveMediaJob(job = {}) {
  if (!job?.jobId) {
    throw new Error(
      "Cannot save media job without jobId"
    );
  }

  const now =
    new Date().toISOString();

  const record = {
    ...job,
    updatedAt: now
  };

  const key =
    buildJobKey(record.jobId);

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(
        record,
        null,
        2
      ),
      ContentType:
        "application/json",
      CacheControl:
        "no-store"
    })
  );

  return {
    key,
    record
  };
}

async function getMediaJob(jobId) {
  const key =
    buildJobKey(jobId);

  try {
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: key
      })
    );

    const body =
      await response.Body.transformToString();

    return JSON.parse(body);
  } catch (error) {
    if (
      error?.name === "NoSuchKey" ||
      error?.$metadata?.httpStatusCode === 404
    ) {
      return null;
    }

    throw error;
  }
}

async function updateMediaJob(
  jobId,
  updates = {}
) {
  const existing =
    await getMediaJob(jobId);

  if (!existing) {
    throw new Error(
      `Media job not found: ${jobId}`
    );
  }

  const next = {
    ...existing,
    ...updates,
    jobId: existing.jobId
  };

  return saveMediaJob(next);
}

module.exports = {
  buildJobKey,
  saveMediaJob,
  getMediaJob,
  updateMediaJob
};
