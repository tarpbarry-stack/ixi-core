const {
  S3Client,
  DeleteObjectCommand
} = require("@aws-sdk/client-s3");

const {
  REGION,
  BUCKET
} = require("../config/mediaConfig");

const s3 = new S3Client({
  region: REGION
});

function validateIncomingCleanup({
  bucket,
  key
} = {}) {
  if (!bucket || bucket !== BUCKET) {
    throw new Error(
      `Incoming cleanup bucket not allowed: ${
        bucket || "missing"
      }`
    );
  }

  if (
    !key ||
    !String(key).startsWith("incoming/")
  ) {
    throw new Error(
      "Incoming cleanup key must begin with incoming/"
    );
  }

  return {
    bucket,
    key: String(key)
  };
}

async function cleanupIncomingObject({
  bucket,
  key
} = {}) {
  const validated =
    validateIncomingCleanup({
      bucket,
      key
    });

  await s3.send(
    new DeleteObjectCommand({
      Bucket:
        validated.bucket,

      Key:
        validated.key
    })
  );

  return {
    deleted: true,
    bucket:
      validated.bucket,
    key:
      validated.key
  };
}

module.exports = {
  validateIncomingCleanup,
  cleanupIncomingObject
};
