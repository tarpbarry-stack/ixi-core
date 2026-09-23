"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("fs"), os = require("os"), path = require("path");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-post-free-"));
process.env.IXI_MOS_DATA_ROOT = path.join(root, "mos");
process.env.IXI_PASSPORT_DATA_FILE = path.join(root, "passports.json");
process.env.IXI_MOS_STORAGE_PROVIDER = "sqlite";
const { ensureCommercialOnboarding } = require("../onboarding/aosCommercialOnboardingService");
const { readPassportRecords } = require("../../passport/passportRegistry");
const owner = ensureCommercialOnboarding({ ownerUserId: "post-free-owner", entityDisplayName: "Posting test" });
const service = require("../onboarding/postFreePostingService");
const input = { entityId: owner.entity.entityId, principalId: "post-free-owner", operationId: "posting-regression-001",
  payload: { title: "2020 CAT 320", priceCents: 1234500, publicData: { category: "Excavators", year: "2020", make: "CAT", model: "320", hours: 100, machineAccess: "private", machineChannel: "private" } },
  files: [{ fileName: "original.jpg", contentType: "image/jpeg", sizeBytes: 100, sha256: "a".repeat(64) }] };
test("durable reservation grants creation once and rejects changed payload or cross-owner recovery", async () => {
  assert.equal(service.reserve(input).createGranted, true);
  delete require.cache[require.resolve("../onboarding/postFreePostingService")];
  const restarted = require("../onboarding/postFreePostingService");
  assert.equal(restarted.reserve(input).createGranted, false);
  assert.throws(() => restarted.reserve({ ...input, payload: { ...input.payload, priceCents: 7 } }), /Resume/);
  await assert.rejects(restarted.state({ ...input, principalId: "another-user" }), /not found/);
  await assert.rejects(restarted.state({ ...input, entityId: "another-entity" }), /not found/);
  assert.equal(restarted.list(input).rows.length, 1);
});
test("lost create responses are not retried; definite rejection can be retried with a new attempt", () => {
  const request = { ...input, operationId: "posting-regression-002" };
  const original = service.reserve(request);
  assert.throws(() => service["create-rejected"]({ ...request, attemptId: original.row.attemptId, statusCode: 500 }), /uncertain/);
  assert.equal(service.reserve(request).createGranted, false);
  service["create-rejected"]({ ...request, attemptId: original.row.attemptId, statusCode: 422 });
  const retry = service.reserve(request);
  assert.equal(retry.createGranted, true);
  assert.notEqual(retry.row.attemptId, original.row.attemptId);
});
test("listing admission reuses the same Object and Passport across repeated recovery", () => {
  const request = { ...input, operationId: "posting-regression-003" };
  service.reserve(request);
  const listing = { listingId: "post-free-listing", displayName: "2020 CAT 320", value: 12345, currency: "USD", state: "draft", channel: "private",
    ownership: { role: "owner", status: "owned" }, fields: { year: "2020", make: "CAT", model: "320", hours: 100 } };
  const first = service.bind({ ...request, listing }).row;
  const passports = readPassportRecords().length;
  const again = service.bind({ ...request, listing }).row;
  assert.equal(first.objectId, again.objectId);
  assert.equal(first.passportId, again.passportId);
  assert.equal(readPassportRecords().length, passports);
  assert.throws(() => service.bind({ ...request, listing: { ...listing, listingId: "different-listing" } }), /another listing/);
});
test("oversized and duplicate photos fail before reserving a machine", () => {
  assert.throws(() => service.reserve({ ...input, operationId: "posting-regression-004", files: [{ ...input.files[0], sizeBytes: 21 * 1024 * 1024 }] }), /20 MB/);
  assert.throws(() => service.reserve({ ...input, operationId: "posting-regression-004", files: [input.files[0], input.files[0]] }), /same original/);
});
