"use strict";
const crypto = require("crypto");
const { readPosting, updatePosting, pendingPostings } = require("../storage/postFreePostingStore");
const { MosError } = require("../errors/MosError");
const { provisionSharetribeMachine } = require("./sharetribeMachineProvisioningService");
const clean = value => String(value ?? "").trim();
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (message, status = 409) => { throw new MosError("POST_FREE_CONFLICT", message, null, status); };
const key = input => hash([input.entityId, input.principalId, input.operationId]);
function scope(input) {
  if (!clean(input.entityId) || !clean(input.principalId) || !/^[a-zA-Z0-9_-]{16,100}$/.test(clean(input.operationId))) fail("An authenticated posting reference is required.", 400);
}
function get(input) {
  scope(input);
  const row = readPosting(key(input));
  if (!row) fail("Posting not found for this account.", 404);
  return row;
}
function change(input, mutate) {
  let result;
  updatePosting(key(input), row => {
    if (!row) fail("Posting not found for this account.", 404);
    mutate(row);
    row.updatedAt = new Date().toISOString();
    result = structuredClone(row);
    return row;
  });
  return result;
}
function validateFiles(files) {
  const { MAX_SOURCE_IMAGE_BYTES } = require("../../media/config/mediaConfig");
  const { ALLOWED_IMAGE_TYPES } = require("../../media/uploads/createDirectUpload");
  if (!Array.isArray(files) || !files.length || files.length > 24) fail("Select between 1 and 24 photos.", 400);
  const ids = new Set();
  return files.map((file, position) => {
    const normalize = value => {
      if (!/^[a-f0-9]{64}$/.test(value?.sha256 || "") || !ALLOWED_IMAGE_TYPES.has(value?.contentType) || !Number.isSafeInteger(value?.sizeBytes) || value.sizeBytes <= 0 || value.sizeBytes > MAX_SOURCE_IMAGE_BYTES) fail("Each photo must be a supported image no larger than 20 MB, with its content checksum.", 400);
      return { sha256: value.sha256, contentType: value.contentType, sizeBytes: value.sizeBytes, fileName: clean(value.fileName).slice(0, 240) || "machine.jpg" };
    };
    const original = normalize(file);
    if (ids.has(original.sha256)) fail("The same original photo was selected twice.", 400);
    ids.add(original.sha256);
    return { ...original, position, rendition: file.rendition ? normalize(file.rendition) : null };
  });
}
function reserve(input) {
  scope(input);
  const payload = input.payload;
  if (!payload || !clean(payload.title) || !Number.isSafeInteger(payload.priceCents) || payload.priceCents < 0) fail("Valid machine details and price are required.", 400);
  for (const field of ["category", "year", "make", "model"]) if (!clean(payload.publicData?.[field])) fail(`Machine ${field} is required.`, 400);
  if (!Number.isFinite(payload.publicData?.hours) || payload.publicData.hours < 0) fail("Machine hours must be zero or greater.", 400);
  if (!["public", "private"].includes(payload.publicData.machineAccess) || !["marketplace", "private", "auction"].includes(payload.publicData.machineChannel)) fail("Select a valid machine placement.", 400);
  const files = validateFiles(input.files);
  const fingerprint = hash({ payload, files });
  let result;
  updatePosting(key(input), previous => {
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail("Resume the saved posting before changing its machine or photo selection.");
      const createGranted = previous.status === "create-rejected";
      if (createGranted) { previous.status = "creating"; previous.attemptId = crypto.randomUUID(); }
      result = { row: previous, createGranted };
    } else {
      const row = { operationId: input.operationId, entityId: input.entityId, principalId: input.principalId,
        payload, files, fingerprint, status: "creating", attemptId: crypto.randomUUID(), uploads: {},
        jobId: `ixi-post-free-${key(input)}`, createdAt: new Date().toISOString() };
      result = { row, createGranted: true };
    }
    return result.row;
  });
  return result;
}
function rejectCreate(input) {
  const row = get(input);
  if (row.status !== "creating" || row.attemptId !== input.attemptId || ![400,401,403,422,429].includes(input.statusCode)) fail("This uncertain create cannot be retried as a new machine.");
  return { row: change(input, row => { row.status = "create-rejected"; }) };
}
function bind(input) {
  let row = get(input);
  if (!input.listing?.listingId) fail("A verified listing is required.");
  if (row.listingId && row.listingId !== input.listing.listingId) fail("Posting is already bound to another listing.");
  row = change(input, next => { next.listingId = input.listing.listingId; next.listing ||= input.listing; });
  const identity = provisionSharetribeMachine({ entityId: row.entityId, principalId: row.principalId,
    commandId: `sharetribe-listing:${row.listingId}`, creationBoundary: "post-free", listing: row.listing });
  return { row: change(input, next => { next.objectId = identity.object.objectId; next.passportId = identity.passport.passportId; if (next.status === "creating") next.status = "uploading"; }) };
}
async function prepare(input) {
  let row = get(input);
  if (!row.passportId || row.status === "complete") fail("This posting is not accepting uploads.");
  const file = row.files.find(file => file.sha256 === input.photoId);
  const descriptor = input.rendition ? file?.rendition : file;
  if (!descriptor) fail("Photo is not part of this posting.", 400);
  const slot = `${file.sha256}:${input.rendition ? "rendition" : "original"}`;
  const { createDirectUpload, renewDirectUpload } = require("../../media/uploads/createDirectUpload");
  let upload = row.uploads[slot];
  if (!upload) {
    upload = await createDirectUpload({ machineId: row.objectId, passportId: row.passportId, ...descriptor, position: file.position });
    delete upload.uploadUrl;
    row = change(input, next => { next.uploads[slot] ||= upload; });
    upload = row.uploads[slot];
  }
  if (upload.verified) return { uploaded: true };
  const { verifyUploadedObject } = require("../../media/uploads/completeDirectUpload");
  try {
    await verifyUploadedObject({ ...upload, expectedContentType: descriptor.contentType, expectedSizeBytes: descriptor.sizeBytes });
    change(input, next => { next.uploads[slot].verified = true; });
    return { uploaded: true };
  } catch (error) {
    if (!(error?.name === "NotFound" || error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404)) throw error;
  }
  return { uploaded: false, upload: await renewDirectUpload(upload) };
}
async function processPhotos(input) {
  const row = get(input);
  if (!row.passportId) fail("Save the machine identity before processing photos.");
  const { getMediaJob } = require("../../media/storage/mediaJobStore");
  const existing = await getMediaJob(row.jobId);
  if (existing && ["processing", "complete"].includes(existing.status)) return { row, job: existing };
  const { verifyUploadedObject } = require("../../media/uploads/completeDirectUpload");
  const inputs = [];
  for (const file of row.files) {
    const readSlot = async (suffix, descriptor) => {
      const upload = row.uploads[`${file.sha256}:${suffix}`];
      if (!upload) fail(`Photo ${file.position + 1} still needs uploading.`);
      await verifyUploadedObject({ ...upload, expectedContentType: descriptor.contentType, expectedSizeBytes: descriptor.sizeBytes });
      change(input, next => { next.uploads[`${file.sha256}:${suffix}`].verified = true; });
      return { inputType: "s3-object", bucket: upload.bucket, key: upload.key, sha256: descriptor.sha256, position: file.position };
    };
    const source = await readSlot("original", file);
    if (file.rendition) source.rendition = await readSlot("rendition", file.rendition);
    inputs.push(source);
  }
  const { createMediaJob } = require("../../media/jobs/createMediaJob");
  const job = await createMediaJob({ machineId: row.objectId, passportId: row.passportId, mediaInputs: inputs,
    sourceType: "post-free", manifestMode: "replace", selectionMode: "manual", reservedJobId: row.jobId,
    requireComplete: true, retainIncoming: true,
    cleanupInputs: Object.values(row.uploads).map(upload => ({ inputType: "s3-object", bucket: upload.bucket, key: upload.key })) });
  return { row: change(input, next => { next.status = "processing"; }), job };
}
async function state(input) {
  const row = get(input);
  const { getMediaJob } = require("../../media/storage/mediaJobStore");
  const { getMachineMediaManifest } = require("../../media/storage/machineMediaManifest");
  const job = row.passportId ? await getMediaJob(row.jobId) : null;
  const manifest = job?.status === "complete" ? await getMachineMediaManifest({ machineId: row.objectId, passportId: row.passportId }) : null;
  const ready = !!manifest && manifest.latestJobId === row.jobId && manifest.media?.length === row.files.length &&
    row.files.every((file, index) => manifest.media[index]?.hash === file.sha256);
  return { row, job, manifest: ready ? manifest : null, ready };
}
async function revise(input) {
  const row = get(input);
  if (row.status === "complete") fail("Use the saved machine's media editor after posting.");
  const files = validateFiles(input.files);
  const fingerprint = hash({ payload: row.payload, files });
  if (fingerprint === row.fingerprint) return { row };
  const { getMediaJob, updateMediaJob } = require("../../media/storage/mediaJobStore");
  const { acquireMediaJobLease } = require("../../media/storage/mediaJobLease");
  const lease = await acquireMediaJobLease(row.jobId);
  try {
    const job = await getMediaJob(row.jobId);
    if (job && !["failed", "superseded"].includes(job.status)) fail("Let current photo processing finish before replacing its selection.");
    if (job) await updateMediaJob(row.jobId, { status: "superseded" });
    return { row: change(input, next => {
      next.files = files;
      next.fingerprint = fingerprint;
      next.revision = (next.revision || 0) + 1;
      next.jobId = `ixi-post-free-${key(input)}-${next.revision}`;
      next.status = next.objectId ? "uploading" : next.status;
    }) };
  } finally { await lease.release(); }
}

async function finish(input) {
  const current = await state(input);
  if (!current.ready || current.row.listingId !== input.listingId || !input.heroImageId) fail("Every photo and the listing must be verified before completion.");
  return { row: change(input, row => { row.status = "complete"; row.heroImageId = input.heroImageId; row.completedAt ||= new Date().toISOString(); }) };
}
function list(input) {
  if (!input.entityId || !input.principalId) fail("Authentication required.", 403);
  return { storageScope: `${input.entityId}:${input.principalId}`, rows: pendingPostings(input.entityId, input.principalId) };
}
module.exports = { reserve, "create-rejected": rejectCreate, bind, prepare, process: processPhotos, state, finish, list, revise };
