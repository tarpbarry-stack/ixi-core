const {
  S3Client,
  HeadObjectCommand
} = require("@aws-sdk/client-s3");

const {
  REGION,
  BUCKET,
  MAX_SOURCE_IMAGE_BYTES
} = require("../config/mediaConfig");

const {
  createMediaJob
} = require("../jobs/createMediaJob");

const s3 = new S3Client({
  region: REGION
});

function validateCompletionInput({
  machineId,
  bucket,
  key
} = {}) {
  if (!machineId) {
    throw new Error(
      "Upload completion requires machineId"
    );
  }

  if (!bucket) {
    throw new Error(
      "Upload completion requires bucket"
    );
  }

  if (!key) {
    throw new Error(
      "Upload completion requires key"
    );
  }

  if (bucket !== BUCKET) {
    throw new Error(
      `Upload bucket not allowed: ${bucket}`
    );
  }

  if (
    !String(key).startsWith("incoming/")
  ) {
    throw new Error(
      "Upload key must begin with incoming/"
    );
  }
}

async function verifyUploadedObject({
  bucket,
  key,
  expectedContentType = "",
  expectedSizeBytes = 0
} = {}) {
  const head =
    await s3.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key
      })
    );

  const contentType =
    String(
      head.ContentType || ""
    )
      .split(";")[0]
      .trim()
      .toLowerCase();

  const sizeBytes =
    Number(
      head.ContentLength || 0
    );

  if (
    !contentType.startsWith("image/")
  ) {
    throw new Error(
      `Uploaded object is not an image: ${
        contentType || "unknown"
      }`
    );
  }

  if (
    sizeBytes <= 0
  ) {
    throw new Error(
      "Uploaded object is empty"
    );
  }

  if (
    sizeBytes >
    MAX_SOURCE_IMAGE_BYTES
  ) {
    throw new Error(
      `Uploaded image exceeds ${
        MAX_SOURCE_IMAGE_BYTES
      } bytes`
    );
  }

  const normalizedExpectedType =
    String(
      expectedContentType || ""
    )
      .split(";")[0]
      .trim()
      .toLowerCase();

  if (
    normalizedExpectedType &&
    normalizedExpectedType !==
      contentType
  ) {
    throw new Error(
      `Uploaded content type mismatch: expected ${
        normalizedExpectedType
      }, received ${contentType}`
    );
  }

  const numericExpectedSize =
    Number(
      expectedSizeBytes || 0
    );

  if (
    numericExpectedSize > 0 &&
    numericExpectedSize !==
      sizeBytes
  ) {
    throw new Error(
      `Uploaded object size mismatch: expected ${
        numericExpectedSize
      }, received ${sizeBytes}`
    );
  }

  return {
    bucket,
    key,
    contentType,
    sizeBytes,
    metadata:
      head.Metadata || {}
  };
}

async function completeDirectUpload({
  machineId,
  passportId = "",
  sourceType = "direct-upload",
  sourceUrl = "",
  uploads = [],
  manifestMode = "replace",
  selectionMode = "manual"
} = {}) {
  if (
    !Array.isArray(uploads) ||
    uploads.length === 0
  ) {
    throw new Error(
      "Upload completion requires uploads"
    );
  }

  const verifiedUploads = [];

  for (
    let index = 0;
    index < uploads.length;
    index += 1
  ) {
    const upload =
      uploads[index] || {};

    validateCompletionInput({
      machineId,
      bucket:
        upload.bucket,
      key:
        upload.key
    });

    const verified =
      await verifyUploadedObject({
        bucket:
          upload.bucket,

        key:
          upload.key,

        expectedContentType:
          upload.contentType,

        expectedSizeBytes:
          upload.sizeBytes
      });

    verifiedUploads.push({
      ...verified,

      uploadId:
        String(
          upload.uploadId || ""
        ),

      position:
        Number.isFinite(
          Number(upload.position)
        )
          ? Number(upload.position)
          : index
    });
  }

  const mediaInputs =
    verifiedUploads.map(
      upload => ({
        inputType:
          "s3-object",

        bucket:
          upload.bucket,

        key:
          upload.key,

        position:
          upload.position,

        uploadId:
          upload.uploadId,

        contentType:
          upload.contentType,

        sizeBytes:
          upload.sizeBytes
      })
    );

  const job =
    await createMediaJob({
      machineId,

      passportId,

      sourceType:
        sourceType ||
        "direct-upload",

      sourceUrl,

      mediaInputs,

      manifestMode:
        manifestMode ||
        "replace",

      selectionMode:
        selectionMode ||
        "manual"
    });

  return {
    ok: true,

    verifiedUploadCount:
      verifiedUploads.length,

    uploads:
      verifiedUploads,

    job
  };
}

module.exports = {
  validateCompletionInput,
  verifyUploadedObject,
  completeDirectUpload
};
