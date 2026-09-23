const crypto = require("crypto");
const path = require("path");

const {
  S3Client,
  PutObjectCommand
} = require("@aws-sdk/client-s3");

const {
  getSignedUrl
} = require("@aws-sdk/s3-request-presigner");

const {
  REGION,
  BUCKET,
  MAX_SOURCE_IMAGE_BYTES
} = require("../config/mediaConfig");

const s3 = new S3Client({
  region: REGION
});

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif"
]);

const PRESIGNED_UPLOAD_SECONDS = 15 * 60;

function sanitizeSegment(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function normalizeContentType(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getExtension({
  fileName = "",
  contentType = ""
} = {}) {
  const suppliedExtension =
    path.extname(fileName)
      .replace(".", "")
      .toLowerCase();

  const allowedExtensions =
    new Set([
      "jpg",
      "jpeg",
      "png",
      "webp",
      "avif",
      "heic",
      "heif"
    ]);

  if (
    suppliedExtension &&
    allowedExtensions.has(
      suppliedExtension
    )
  ) {
    return suppliedExtension === "jpeg"
      ? "jpg"
      : suppliedExtension;
  }

  const byContentType = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/heic": "heic",
    "image/heif": "heif"
  };

  return (
    byContentType[contentType] ||
    "jpg"
  );
}

function createUploadId() {
  return `ixi-upload-${Date.now()}-${crypto
    .randomBytes(8)
    .toString("hex")}`;
}

function buildIncomingKey({
  machineId,
  uploadId,
  fileName,
  contentType
}) {
  const safeMachineId =
    sanitizeSegment(machineId);

  const extension =
    getExtension({
      fileName,
      contentType
    });

  return [
    "incoming",
    safeMachineId,
    `${uploadId}.${extension}`
  ].join("/");
}

async function createDirectUpload({
  machineId,
  passportId = "",
  fileName,
  contentType,
  sizeBytes,
  position = 0,
  sha256 = ""
} = {}) {
  if (!machineId) {
    throw new Error(
      "Direct upload requires machineId"
    );
  }

  if (!fileName) {
    throw new Error(
      "Direct upload requires fileName"
    );
  }

  const normalizedContentType =
    normalizeContentType(contentType);

  if (
    !ALLOWED_IMAGE_TYPES.has(
      normalizedContentType
    )
  ) {
    throw new Error(
      `Unsupported image type: ${
        normalizedContentType ||
        "missing"
      }`
    );
  }

  const numericSize =
    Number(sizeBytes);

  if (
    !Number.isFinite(numericSize) ||
    numericSize <= 0
  ) {
    throw new Error(
      "Direct upload requires a valid sizeBytes"
    );
  }

  if (
    numericSize >
    MAX_SOURCE_IMAGE_BYTES
  ) {
    throw new Error(
      `Image exceeds maximum size of ${
        MAX_SOURCE_IMAGE_BYTES
      } bytes`
    );
  }

  const uploadId =
    createUploadId();

  const key =
    buildIncomingKey({
      machineId:
        passportId || machineId,

      uploadId,
      fileName,
      contentType:
        normalizedContentType
    });

  const command =
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,

      ContentType:
        normalizedContentType,
      ...(sha256 ? { ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64") } : {}),

      Metadata: {
        uploadid:
          uploadId,

        machineid:
          sanitizeSegment(machineId),

        passportid:
          sanitizeSegment(
            passportId
          ),

        position:
          String(
            Number(position) || 0
          ),

        originalfilename:
          sanitizeSegment(fileName)
      }
    });

  const uploadUrl =
    await getSignedUrl(
      s3,
      command,
      {
        expiresIn:
          PRESIGNED_UPLOAD_SECONDS
      }
    );

  return {
    uploadId,
    sha256,

    inputType:
      "s3-object",

    bucket:
      BUCKET,

    key,

    machineId:
      String(machineId),

    passportId:
      String(passportId || ""),

    fileName:
      String(fileName),

    contentType:
      normalizedContentType,

    sizeBytes:
      numericSize,

    position:
      Number(position) || 0,

    uploadUrl,

    expiresInSeconds:
      PRESIGNED_UPLOAD_SECONDS,

    createdAt:
      new Date().toISOString()
  };
}

async function renewDirectUpload(upload) {
  if (upload.bucket !== BUCKET || !String(upload.key).startsWith(`incoming/${sanitizeSegment(upload.passportId || upload.machineId)}/`)) throw new Error("Upload is not bound to this machine.");
  const command = new PutObjectCommand({ Bucket: BUCKET, Key: upload.key,
    ContentType: upload.contentType,
    ...(upload.sha256 ? { ChecksumSHA256: Buffer.from(upload.sha256, "hex").toString("base64") } : {}),
    Metadata: { uploadid: upload.uploadId, machineid: sanitizeSegment(upload.machineId),
      passportid: sanitizeSegment(upload.passportId), position: String(upload.position),
      originalfilename: sanitizeSegment(upload.fileName) } });
  return { ...upload, uploadUrl: await getSignedUrl(s3, command, { expiresIn: PRESIGNED_UPLOAD_SECONDS }) };
}

module.exports = {
  renewDirectUpload,
  ALLOWED_IMAGE_TYPES,
  PRESIGNED_UPLOAD_SECONDS,
  sanitizeSegment,
  normalizeContentType,
  getExtension,
  createUploadId,
  buildIncomingKey,
  createDirectUpload
};
