"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), crypto = require("crypto"), fs = require("fs"), os = require("os"), path = require("path");
process.env.IXI_MOS_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-media-access-"));
process.env.IXI_MOS_INTERNAL_SECRET = "test-only-signing-secret";
const { updatePosting } = require("../storage/postFreePostingStore");
const { validReadTicket, protectPostingMedia } = require("../onboarding/postFreeMediaAccess");
updatePosting("test", () => ({ entityId: "entity", principalId: "owner", operationId: "op", status: "complete", createdAt: new Date().toISOString(), payload: { title: "test" }, objectId: "object-one", passportId: "PASS-ONE", listingId: "listing-one" }));
const ticket = (key, expires) => `${expires}.${crypto.createHmac("sha256", process.env.IXI_MOS_INTERNAL_SECRET).update(`ixi-media-read-v1\n${key}\n${expires}`).digest("hex")}`;
test("read tickets are short-lived and bound to the exact media key", () => {
  const now = Date.now(), signed = ticket("PASS-ONE", now + 30000);
  assert.equal(validReadTicket(signed, "PASS-ONE", now), true);
  assert.equal(validReadTicket(signed, "PASS-TWO", now), false);
  assert.equal(validReadTicket(signed, "PASS-ONE", now + 31000), false);
  assert.equal(validReadTicket(ticket("PASS-ONE", now + 120000), "PASS-ONE", now), false);
});
async function check(method, requestPath, headers = {}, body = {}) {
  let status = 200, next = false, response;
  await protectPostingMedia({ method, path: requestPath, headers, body, query: {} }, {
    status(value) { status = value; return this; }, json(value) { response = value; return this; }
  }, () => { next = true; });
  return { status, next, response };
}
test("unsigned manifest reads and legacy writes cannot bypass posting authority", async () => {
  assert.equal((await check("GET", "/machines/PASS-ONE")).status, 403);
  const signed = { "x-ixi-media-read-ticket": ticket("PASS-ONE", Date.now() + 30000) };
  assert.equal((await check("GET", "/machines/PASS-ONE", signed)).next, true);
  assert.equal((await check("DELETE", "/machines/PASS-ONE/media/image-one", signed)).status, 403);
  assert.equal((await check("POST", "/uploads/init", {}, { machineId: "object-one" })).status, 403);
  assert.equal((await check("POST", "/jobs", {}, { passportId: "PASS-ONE" })).status, 403);
  assert.equal((await check("GET", "/machines/legacy-machine")).next, true);
});
