const {
  downloadRemoteImage
} = require("./downloadRemoteImage");

const {
  readIncomingS3Object
} = require("./readIncomingS3Object");

async function loadMediaInput(input = {}) {
  const inputType =
    String(
      input.inputType || ""
    )
      .trim()
      .toLowerCase();

  if (inputType === "remote-url") {
    if (!input.url) {
      throw new Error(
        "Remote URL media input requires url"
      );
    }

    const downloaded =
      await downloadRemoteImage(
        input.url
      );

    return {
      inputType:
        "remote-url",

      sourceUrl:
        downloaded.sourceUrl,

      contentType:
        downloaded.contentType,

      bytes:
        downloaded.bytes,

      buffer:
        downloaded.buffer
    };
  }

  if (inputType === "s3-object") {
    const incoming =
      await readIncomingS3Object({
        bucket:
          input.bucket,

        key:
          input.key
      });

    return {
      inputType:
        "s3-object",

      bucket:
        incoming.bucket,

      key:
        incoming.key,

      contentType:
        incoming.contentType,

      bytes:
        incoming.bytes,

      metadata:
        incoming.metadata,

      buffer:
        incoming.buffer
    };
  }

  throw new Error(
    `Unsupported media input type: ${
      inputType || "missing"
    }`
  );
}

module.exports = {
  loadMediaInput
};
