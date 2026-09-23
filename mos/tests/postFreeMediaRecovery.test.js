"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), crypto = require("crypto");
const sharp = require("sharp");
const { S3Client } = require("@aws-sdk/client-s3");
const { BUCKET } = require("../../media/config/mediaConfig");
const { processMediaJob } = require("../../media/worker/processMediaJob");
function memoryStorage(t, failManifest = false) {
  const objects = new Map();
  let failOnce = failManifest, version = 0;
  t.mock.method(S3Client.prototype, "send", async command => {
    const input = command.input, name = command.constructor.name;
    if (name === "PutObjectCommand") {
      if (failOnce && input.Key.startsWith("machine-media/")) { failOnce = false; throw new Error("Interrupted manifest write"); }
      const previous = objects.get(input.Key);
      if ((input.IfNoneMatch === "*" && previous) || (input.IfMatch && input.IfMatch !== previous?.etag)) throw Object.assign(new Error("Lease conflict"), { $metadata: { httpStatusCode: 412 } });
      const etag = `"${++version}"`;
      objects.set(input.Key, { body: Buffer.from(input.Body), type: input.ContentType, etag }); return { ETag: etag };
    }
    if (name === "DeleteObjectCommand") { objects.delete(input.Key); return {}; }
    const object = objects.get(input.Key);
    if (!object) throw Object.assign(new Error("Missing object"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
    if (name === "HeadObjectCommand") return { ContentType: object.type, ContentLength: object.body.length };
    if (name === "GetObjectCommand") return { ETag: object.etag, Body: { transformToString: async () => object.body.toString(), transformToByteArray: async () => object.body } };
    throw new Error(`Unexpected storage operation ${name}`);
  });
  return objects;
}
function add(objects, key, buffer) { objects.set(key, { body: buffer, type: "image/jpeg" }); return { inputType: "s3-object", bucket: BUCKET, key, sha256: crypto.createHash("sha256").update(buffer).digest("hex") }; }
function job(inputs, id = "recover") { return { jobId: id, type: "ixi-machine-media-ingestion", machineId: "object-one", passportId: "IXIPOSTFREE1", requireComplete: true, retainIncoming: true, mediaInputs: inputs, manifestMode: "replace" }; }
test("interrupted manifest publication retains originals and recovers the same complete ordered manifest", async t => {
  const objects = memoryStorage(t, true);
  const first = await sharp({ create: { width: 64, height: 48, channels: 3, background: "red" } }).jpeg().toBuffer();
  const second = await sharp({ create: { width: 64, height: 48, channels: 3, background: "blue" } }).jpeg().toBuffer();
  const inputs = [add(objects, "incoming/IXIPOSTFREE1/a.jpg", first), add(objects, "incoming/IXIPOSTFREE1/b.jpg", second)].map((input, position) => ({ ...input, position }));
  const work = job(inputs);
  await assert.rejects(processMediaJob(work), /Interrupted manifest/);
  assert.ok(objects.has(inputs[0].key)); assert.ok(objects.has(inputs[1].key));
  assert.notEqual(JSON.parse(objects.get("media-jobs/recover.json").body).status, "complete");
  const completed = await processMediaJob(work);
  assert.equal(completed.status, "complete");
  const manifest = JSON.parse(objects.get("machine-media/IXIPOSTFREE1.json").body);
  assert.deepEqual(manifest.media.map(item => item.hash), inputs.map(input => input.sha256));
  assert.equal(manifest.heroMediaId, manifest.media[0].mediaId);
  assert.deepEqual(objects.get(manifest.media[0].original.key).body, first);
  assert.deepEqual(objects.get(manifest.media[1].original.key).body, second);
  assert.equal(objects.has(inputs[0].key), false, "staging is cleaned only after the verified manifest is durable");
  const version = manifest.mediaVersion;
  await processMediaJob(work);
  assert.equal(JSON.parse(objects.get("machine-media/IXIPOSTFREE1.json").body).mediaVersion, version);
});
test("a failed photo cannot publish a partial manifest", async t => {
  const objects = memoryStorage(t);
  const original = await sharp({ create: { width: 32, height: 32, channels: 3, background: "green" } }).jpeg().toBuffer();
  const inputs = [add(objects, "incoming/IXIPOSTFREE1/good.jpg", original), add(objects, "incoming/IXIPOSTFREE1/bad.jpg", Buffer.from("not an image"))];
  const result = await processMediaJob(job(inputs, "partial"));
  assert.equal(result.status, "failed");
  assert.equal(objects.has("machine-media/IXIPOSTFREE1.json"), false);
  assert.ok(objects.has(inputs[0].key));
});
test("large source bytes survive optimization; hero delivery is substantially smaller", async t => {
  const objects = memoryStorage(t);
  const buffer = await sharp(crypto.randomBytes(6000 * 4000 * 3), { raw: { width: 6000, height: 4000, channels: 3 } }).jpeg({ quality: 88 }).toBuffer();
  const input = add(objects, "incoming/IXIPOSTFREE1/large.jpg", buffer);
  const began = performance.now();
  await processMediaJob(job([input], "large"));
  const elapsedMs = Math.round(performance.now() - began);
  const manifest = JSON.parse(objects.get("machine-media/IXIPOSTFREE1.json").body);
  const media = manifest.media[0];
  assert.deepEqual(objects.get(media.original.key).body, buffer);
  assert.ok(media.hero.bytes < buffer.length / 3);
  assert.ok(media.hero.width <= 2560 && media.hero.height <= 2560);
  console.log(JSON.stringify({ sourceBytes: buffer.length, heroBytes: media.hero.bytes, localProcessingMs: elapsedMs, note: "Synthetic image; storage mocked, not a network-speed measurement" }));
});
