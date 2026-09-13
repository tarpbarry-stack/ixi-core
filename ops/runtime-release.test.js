"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { verifyManifest, safeRelative } = require("./runtime-release");
test("release verification detects missing files and storage drift while preserving data", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-release-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "mos/storage"), { recursive: true });
  fs.mkdirSync(path.join(root, "passport"), { recursive: true });
  fs.writeFileSync(path.join(root, "passport/passports.json"), "[{\"passportId\":\"IXI_RETAIN\"}]");
  fs.writeFileSync(path.join(root, "mos/storage/sqliteStore.js"), "verified source");
  const manifest = { schema: "ixi.runtime-release.v1", commit: "a".repeat(40), files: {
    "mos/storage/sqliteStore.js": { sha256: crypto.createHash("sha256").update("verified source").digest("hex") }
  }};
  assert.equal(verifyManifest(root, manifest).ok, true);
  fs.writeFileSync(path.join(root, "mos/storage/sqliteStore.js"), "old deployed source");
  assert.deepEqual(verifyManifest(root, manifest).failures, [{ path: "mos/storage/sqliteStore.js", reason: "checksum" }]);
  fs.rmSync(path.join(root, "mos/storage/sqliteStore.js"));
  assert.deepEqual(verifyManifest(root, manifest).failures, [{ path: "mos/storage/sqliteStore.js", reason: "missing" }]);
  assert.equal(fs.readFileSync(path.join(root, "passport/passports.json"), "utf8"), "[{\"passportId\":\"IXI_RETAIN\"}]");
});
test("release manifests cannot install paths outside the runtime or overwrite business data", () => {
  for (const value of ["../outside.js", "/tmp/outside.js", "data/mos/objects.json",
    ".env", "passport/passports.json", "ixi-machine-state.json"]) {
    assert.throws(() => safeRelative(value));
  }
  assert.equal(safeRelative("passport/passportRegistry.js"), "passport/passportRegistry.js");
});
