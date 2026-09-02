const {
  MAX_SOURCE_IMAGE_BYTES,
  DOWNLOAD_TIMEOUT_MS
} = require("../config/mediaConfig");

const ALLOWED_HOSTS = new Set([
  "www-ironplanet.s3-us-west-2.amazonaws.com",
  "cdn.ironpla.net",
  "media.sandhills.com",
  "www.wavebid.com",
  "d323w7klwy72q3.cloudfront.net",
"used.equipmentshare.com",
"imageserver.rouseservices.com",
"www.4saleheavyequipment.com",
"images.proxibid.com",

  // Facebook CDN
  "scontent-ord5-2.xx.fbcdn.net",
  "scontent-ord5-3.xx.fbcdn.net"
]);

function validateRemoteImageUrl(rawUrl = "") {
  let parsedUrl;

  try {
    parsedUrl = new URL(
      String(rawUrl || "").trim()
    );
  } catch {
    throw new Error(
      "Invalid remote image URL"
    );
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error(
      "Remote image must use HTTPS"
    );
  }

  const hostname =
    parsedUrl.hostname.toLowerCase();

  if (!ALLOWED_HOSTS.has(hostname)) {
    throw new Error(
      `Remote image host not allowed: ${hostname}`
    );
  }

  return parsedUrl;
}

async function downloadRemoteImage(url) {
  const parsedUrl =
    validateRemoteImageUrl(url);

  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    DOWNLOAD_TIMEOUT_MS
  );

  try {
    const response = await fetch(
      parsedUrl.toString(),
      {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; IronXchange-Media-Importer/1.0)",
          Accept:
            "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        `Remote image returned ${response.status}`
      );
    }

    const contentType =
      String(
        response.headers.get(
          "content-type"
        ) || ""
      )
        .split(";")[0]
        .trim()
        .toLowerCase();

    if (!contentType.startsWith("image/")) {
      throw new Error(
        `Remote URL returned ${contentType || "unknown content type"}`
      );
    }

    const declaredLength = Number(
      response.headers.get(
        "content-length"
      ) || 0
    );

    if (
      declaredLength > MAX_SOURCE_IMAGE_BYTES
    ) {
      throw new Error(
        `Remote image exceeds ${
          MAX_SOURCE_IMAGE_BYTES
        } bytes`
      );
    }

    const arrayBuffer =
      await response.arrayBuffer();

    if (
      arrayBuffer.byteLength >
      MAX_SOURCE_IMAGE_BYTES
    ) {
      throw new Error(
        `Downloaded image exceeds ${
          MAX_SOURCE_IMAGE_BYTES
        } bytes`
      );
    }

    return {
      sourceUrl:
        parsedUrl.toString(),

      hostname:
        parsedUrl.hostname,

      contentType,

      bytes:
        arrayBuffer.byteLength,

      buffer:
        Buffer.from(arrayBuffer)
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        "Remote image download timed out"
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  ALLOWED_HOSTS,
  validateRemoteImageUrl,
  downloadRemoteImage
};
