const REGION =
  process.env.IXI_MEDIA_AWS_REGION ||
  "us-east-2";

const BUCKET =
  process.env.IXI_MEDIA_BUCKET ||
  "ixi-machine-media-459212966383-us-east-2";

const DELIVERY_BASE_URL =
  process.env.IXI_MEDIA_DELIVERY_BASE_URL ||
  "https://dnkng2xgatk56.cloudfront.net";

const QUEUE_NAME =
  process.env.IXI_MEDIA_QUEUE_NAME ||
  "ixi-media-ingestion";

const MAX_SOURCE_IMAGE_BYTES =
  20 * 1024 * 1024;

const DOWNLOAD_TIMEOUT_MS =
  30000;

const HERO_MAX_WIDTH =
  2560;

const HERO_MAX_HEIGHT =
  2560;

const DISPLAY_MAX_WIDTH =
  2200;

const DISPLAY_MAX_HEIGHT =
  2200;

const THUMB_MAX_WIDTH =
  600;

const THUMB_MAX_HEIGHT =
  600;

const WEBP_QUALITY =
  84;

const WORKER_IMAGE_CONCURRENCY =
  2;

module.exports = {
  REGION,
  BUCKET,
  DELIVERY_BASE_URL,
  QUEUE_NAME,
  MAX_SOURCE_IMAGE_BYTES,
  DOWNLOAD_TIMEOUT_MS,
  HERO_MAX_WIDTH,
  HERO_MAX_HEIGHT,
  DISPLAY_MAX_WIDTH,
  DISPLAY_MAX_HEIGHT,
  THUMB_MAX_WIDTH,
  THUMB_MAX_HEIGHT,
  WEBP_QUALITY,
  WORKER_IMAGE_CONCURRENCY
};
