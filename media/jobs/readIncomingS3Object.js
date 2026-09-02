const {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand
} = require("@aws-sdk/client-s3");

const {
  REGION,
  BUCKET,
  MAX_SOURCE_IMAGE_BYTES
} = require("../config/mediaConfig");

const s3 = new S3Client({
  region: REGION
});

function validateIncomingObject({
  bucket,
  key
} = {}) {
  if (!bucket) {
    throw new Error(
      "S3 media input requires bucket"
    );
  }

  if (!key) {
    throw new Error(
      "S3 media input requires key"
    );
  }

  if (bucket !== BUCKET) {
    throw new Error(
      `S3 media input bucket not allowed: ${bucket}`
    );
  }

  if (
    !String(key).startsWith("incoming/")
  ) {
    throw new Error(
      "S3 media input key must begin with incoming/"
    );
  }

  return {
    bucket,
    key: String(key)
  };
}

async function readIncomingS3Object({
  bucket,
  key
} = {}) {
  const validated =
    validateIncomingObject({
      bucket,
      key
    });

  const head = await s3.send(
    new HeadObjectCommand({
      Bucket:
        validated.bucket,

      Key:
        validated.key
    })
  );

  const contentType =
    String(
      head.ContentType || ""
    )
      .split(";")[0]
      .trim()
      .toLowerCase();

  if (
    !contentType.startsWith("image/")
  ) {
    throw new Error(
      `S3 object is not an image: ${
        contentType || "unknown"
      }`
    );
  }

  const declaredBytes =
    Number(
      head.ContentLength || 0
    );

  if (
    declaredBytes >
    MAX_SOURCE_IMAGE_BYTES
  ) {
    throw new Error(
      `S3 image exceeds ${
        MAX_SOURCE_IMAGE_BYTES
      } bytes`
    );
  }

  const response = await s3.send(
    new GetObjectCommand({
      Bucket:
        validated.bucket,

      Key:
        validated.key
    })
  );

  const byteArray =
    await response.Body
      .transformToByteArray();

  const buffer =
    Buffer.from(byteArray);

  if (
    buffer.length >
    MAX_SOURCE_IMAGE_BYTES
  ) {
    throw new Error(
      `Downloaded S3 image exceeds ${
        MAX_SOURCE_IMAGE_BYTES
      } bytes`
    );
  }

  return {
    inputType:
      "s3-object",

    bucket:
      validated.bucket,

    key:
      validated.key,

    contentType,

    bytes:
      buffer.length,

    metadata:
      head.Metadata || {},

    buffer
  };
}

module.exports = {
  validateIncomingObject,
  readIncomingS3Object
};
