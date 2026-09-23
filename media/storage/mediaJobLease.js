"use strict";
const crypto = require("crypto");
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { REGION, BUCKET } = require("../config/mediaConfig");
const s3 = new S3Client({ region: REGION });
async function acquireMediaJobLease(jobId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) throw new Error("Invalid media job lease key.");
  const key = `media-job-leases/${jobId}.json`;
  let etag = null;
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const previous = JSON.parse(await response.Body.transformToString());
    if (previous.expiresAt > Date.now()) throw new Error("Media job is already processing; keep its queue message for retry.");
    etag = response.ETag;
    if (!etag) throw new Error("Media lease has no conditional-write version.");
  } catch (error) {
    if (!(error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404)) throw error;
  }
  const owner = crypto.randomUUID();
  let leaseExpiresAt = 0;
  const write = async expiresAt => {
    const result = await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key,
      ...(etag ? { IfMatch: etag } : { IfNoneMatch: "*" }),
      ContentType: "application/json", Body: JSON.stringify({ owner, expiresAt }) }));
    if (!result.ETag) throw new Error("Storage did not confirm the media lease.");
    etag = result.ETag;
    leaseExpiresAt = expiresAt;
  };
  await write(Date.now() + 180000);
  let failure = null, pending = null;
  const timer = setInterval(() => {
    if (pending || failure) return;
    pending = write(Date.now() + 180000).catch(error => { failure = error; }).finally(() => { pending = null; });
  }, 60000);
  timer.unref();
  return {
    assertOwned() { if (failure || Date.now() >= leaseExpiresAt) throw new Error(`Media processing lease was lost: ${failure?.message || "lease expired"}`); },
    async release() {
      clearInterval(timer);
      if (pending) await pending;
      if (!failure) await write(0);
    }
  };
}
module.exports = { acquireMediaJobLease };
