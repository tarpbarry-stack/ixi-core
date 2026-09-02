const crypto = require("crypto");
const sharp = require("sharp");

const {
  HERO_MAX_WIDTH,
  HERO_MAX_HEIGHT,
  DISPLAY_MAX_WIDTH,
  DISPLAY_MAX_HEIGHT,
  THUMB_MAX_WIDTH,
  THUMB_MAX_HEIGHT,
  WEBP_QUALITY
} = require("../config/mediaConfig");

function createContentHash(buffer) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}

async function createWebpDerivative({
  buffer,
  width,
  height,
  quality
}) {
  const derivativeBuffer =
    await sharp(buffer)
      .rotate()
      .resize({
        width,
        height,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({
        quality,
        effort: 4
      })
      .toBuffer();

  const metadata =
    await sharp(
      derivativeBuffer
    ).metadata();

  return {
    buffer:
      derivativeBuffer,

    bytes:
      derivativeBuffer.length,

    width:
      metadata.width,

    height:
      metadata.height,

    format:
      "webp",

    contentType:
      "image/webp"
  };
}

async function optimizeImage(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error(
      "Image optimization requires a Buffer"
    );
  }

  const metadata =
    await sharp(buffer)
      .metadata();

  if (
    !metadata.width ||
    !metadata.height
  ) {
    throw new Error(
      "Image dimensions could not be determined"
    );
  }

  const hash =
    createContentHash(buffer);

  const [
    hero,
    display,
    thumb
  ] = await Promise.all([
    createWebpDerivative({
      buffer,
      width:
        HERO_MAX_WIDTH,
      height:
        HERO_MAX_HEIGHT,
      quality:
        Math.min(
          90,
          WEBP_QUALITY + 3
        )
    }),

    createWebpDerivative({
      buffer,
      width:
        DISPLAY_MAX_WIDTH,
      height:
        DISPLAY_MAX_HEIGHT,
      quality:
        WEBP_QUALITY
    }),

    createWebpDerivative({
      buffer,
      width:
        THUMB_MAX_WIDTH,
      height:
        THUMB_MAX_HEIGHT,
      quality:
        78
    })
  ]);

  return {
    hash,

    original: {
      buffer,
      bytes:
        buffer.length,
      width:
        metadata.width,
      height:
        metadata.height,
      format:
        metadata.format || ""
    },

    hero,
    display,
    thumb
  };
}

module.exports = {
  createContentHash,
  createWebpDerivative,
  optimizeImage
};
