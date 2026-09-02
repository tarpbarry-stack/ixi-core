const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command
} = require("@aws-sdk/client-s3");

const {
  REGION,
  BUCKET
} = require("../config/mediaConfig");

const s3 = new S3Client({
  region: REGION
});

function sanitizeSegment(value = "") {
  const clean =
    String(value || "")
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 180);

  if (!clean) {
    throw new Error(
      "Retired media requires a valid identifier"
    );
  }

  return clean;
}

function buildRetiredMediaKey({
  machineKey,
  mediaId
} = {}) {
  return [
    "retired-media",
    sanitizeSegment(machineKey),
    `${sanitizeSegment(mediaId)}.json`
  ].join("/");
}

async function saveRetiredMediaRecord({
  machineKey,
  machineId,
  passportId,
  media,
  removedFromManifestVersion,
  reason = "user-remove",
  removedBy = "system"
} = {}) {
  if (!media?.mediaId) {
    throw new Error(
      "Retired media record requires media"
    );
  }

  const key =
    buildRetiredMediaKey({
      machineKey,
      mediaId:
        media.mediaId
    });

  const now =
    new Date().toISOString();

  const record = {
    schemaVersion:
      1,

    status:
      "retired",

    retiredMediaKey:
      key,

    machineKey:
      String(machineKey),

    machineId:
      String(machineId || ""),

    passportId:
      String(passportId || ""),

    mediaId:
      String(media.mediaId),

    media,

    removedFromManifestVersion:
      Number(
        removedFromManifestVersion || 0
      ),

    reason:
      String(reason || "user-remove"),

    removedBy:
      String(removedBy || "system"),

    removedAt:
      now,

    restoreStatus:
      "available",

    restoredAt:
      null,

    permanentlyDeletedAt:
      null
  };

  await s3.send(
    new PutObjectCommand({
      Bucket:
        BUCKET,

      Key:
        key,

      Body:
        JSON.stringify(
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

  return record;
}

async function getRetiredMediaRecord({
  machineKey,
  mediaId
} = {}) {
  const key =
    buildRetiredMediaKey({
      machineKey,
      mediaId
    });

  try {
    const response =
      await s3.send(
        new GetObjectCommand({
          Bucket:
            BUCKET,

          Key:
            key
        })
      );

    const body =
      await response.Body
        .transformToString();

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

async function listRetiredMediaRecords({
  machineKey
} = {}) {
  const prefix =
    `retired-media/${sanitizeSegment(machineKey)}/`;

  const listed =
    await s3.send(
      new ListObjectsV2Command({
        Bucket:
          BUCKET,

        Prefix:
          prefix
      })
    );

  const objects =
    listed.Contents || [];

  const records = [];

  for (const object of objects) {
    const response =
      await s3.send(
        new GetObjectCommand({
          Bucket:
            BUCKET,

          Key:
            object.Key
        })
      );

    const body =
      await response.Body
        .transformToString();

    records.push(
      JSON.parse(body)
    );
  }

  records.sort(
    (a, b) =>
      new Date(b.removedAt) -
      new Date(a.removedAt)
  );

  return records;
}

module.exports = {
  sanitizeSegment,
  buildRetiredMediaKey,
  saveRetiredMediaRecord,
  getRetiredMediaRecord,
  listRetiredMediaRecords
};
