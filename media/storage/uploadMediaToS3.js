const {
  S3Client,
  PutObjectCommand
} = require("@aws-sdk/client-s3");

const {
  REGION,
  BUCKET,
  DELIVERY_BASE_URL
} = require("../config/mediaConfig");

const s3 = new S3Client({
  region: REGION
});

function sanitizeSegment(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function getOriginalExtension({
  contentType = "",
  format = ""
} = {}) {
  const normalizedType =
    String(contentType || "")
      .split(";")[0]
      .trim()
      .toLowerCase();

  const normalizedFormat =
    String(format || "")
      .trim()
      .toLowerCase();

  const byContentType = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/tiff": "tiff"
  };

  if (byContentType[normalizedType]) {
    return byContentType[normalizedType];
  }

  const allowedFormats =
    new Set([
      "jpeg",
      "jpg",
      "png",
      "webp",
      "avif",
      "heic",
      "heif",
      "tiff"
    ]);

  if (allowedFormats.has(normalizedFormat)) {
    return normalizedFormat === "jpeg"
      ? "jpg"
      : normalizedFormat;
  }

  return "jpg";
}

function buildMediaKeys({
  machineId,
  hash,
  position = 0,
  originalExtension = "jpg"
}) {
  const safeMachineId =
    sanitizeSegment(machineId);

  const safeHash =
    sanitizeSegment(hash);

  const safeExtension =
    sanitizeSegment(
      originalExtension
    ) || "jpg";

  const paddedPosition =
    String(position + 1)
      .padStart(2, "0");

  const base =
    `machines/${safeMachineId}/${paddedPosition}-${safeHash}`;

  return {
    originalKey:
      `${base}-original.${safeExtension}`,

    heroKey:
      `${base}-hero.webp`,

    displayKey:
      `${base}-display.webp`,

    thumbKey:
      `${base}-thumb.webp`
  };
}

function buildDeliveryUrl(key) {
  const base =
    String(
      DELIVERY_BASE_URL || ""
    ).replace(/\/+$/, "");

  const cleanKey =
    String(key || "")
      .replace(/^\/+/, "");

  return `${base}/${cleanKey}`;
}

async function putObject({
  key,
  buffer,
  contentType,
  metadata,
  cacheControl
}) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error(
      `S3 upload requires a buffer for ${key}`
    );
  }

  await s3.send(
    new PutObjectCommand({
      Bucket:
        BUCKET,

      Key:
        key,

      Body:
        buffer,

      ContentType:
        contentType ||
        "application/octet-stream",

      CacheControl:
        cacheControl,

      Metadata:
        metadata
    })
  );
}

async function uploadMediaToS3({
  machineId,
  hash,
  position,
  originalBuffer,
  originalContentType,
  originalFormat,
  heroBuffer,
  displayBuffer,
  thumbBuffer,
  sourceUrl = ""
}) {
  if (!machineId) {
    throw new Error(
      "S3 upload requires machineId"
    );
  }

  if (!hash) {
    throw new Error(
      "S3 upload requires image hash"
    );
  }

  const originalExtension =
    getOriginalExtension({
      contentType:
        originalContentType,

      format:
        originalFormat
    });

  const {
    originalKey,
    heroKey,
    displayKey,
    thumbKey
  } = buildMediaKeys({
    machineId,
    hash,
    position,
    originalExtension
  });

  const metadata = {
    machineid:
      sanitizeSegment(machineId),

    sourceurl:
      String(sourceUrl || "")
        .slice(0, 1800),

    hash:
      sanitizeSegment(hash),

    position:
      String(
        Number(position) || 0
      )
  };

  await Promise.all([
    putObject({
      key:
        originalKey,

      buffer:
        originalBuffer,

      contentType:
        originalContentType ||
        "application/octet-stream",

      cacheControl:
        "private, max-age=0, no-store",

      metadata
    }),

    putObject({
      key:
        heroKey,

      buffer:
        heroBuffer,

      contentType:
        "image/webp",

      cacheControl:
        "public, max-age=31536000, immutable",

      metadata
    }),

    putObject({
      key:
        displayKey,

      buffer:
        displayBuffer,

      contentType:
        "image/webp",

      cacheControl:
        "public, max-age=31536000, immutable",

      metadata
    }),

    putObject({
      key:
        thumbKey,

      buffer:
        thumbBuffer,

      contentType:
        "image/webp",

      cacheControl:
        "public, max-age=31536000, immutable",

      metadata
    })
  ]);

  return {
    bucket:
      BUCKET,

    originalKey,
    heroKey,
    displayKey,
    thumbKey,

    originalUrl:
      "",

    heroUrl:
      buildDeliveryUrl(
        heroKey
      ),

    displayUrl:
      buildDeliveryUrl(
        displayKey
      ),

    thumbUrl:
      buildDeliveryUrl(
        thumbKey
      )
  };
}

module.exports = {
  sanitizeSegment,
  getOriginalExtension,
  buildMediaKeys,
  buildDeliveryUrl,
  uploadMediaToS3
};
