"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-passport-registry-"));
process.env.IXI_PASSPORT_DATA_FILE = path.join(testRoot, "passports.json");

const {
  readPassportRecords,
  writePassportRecords,
  deletePassportById,
  deletePassportBySource,
  unbindPassportSource
} = require("./passportRegistry");

test.after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test("a genuinely new registry can initialize empty", () => {
  fs.rmSync(process.env.IXI_PASSPORT_DATA_FILE, { force: true });
  assert.deepEqual(readPassportRecords(), []);
});

test("an unreadable registry fails closed instead of becoming empty", () => {
  fs.rmSync(process.env.IXI_PASSPORT_DATA_FILE, { recursive: true, force: true });
  fs.mkdirSync(process.env.IXI_PASSPORT_DATA_FILE);

  assert.throws(
    () => readPassportRecords(),
    error => error?.code === "PASSPORT_REGISTRY_READ_FAILED"
  );

  fs.rmSync(process.env.IXI_PASSPORT_DATA_FILE, { recursive: true, force: true });
});

test("invalid JSON and an invalid root shape fail closed", () => {
  fs.writeFileSync(process.env.IXI_PASSPORT_DATA_FILE, "{broken", "utf8");
  assert.throws(
    () => readPassportRecords(),
    error => error?.code === "PASSPORT_REGISTRY_INVALID_JSON"
  );

  fs.writeFileSync(process.env.IXI_PASSPORT_DATA_FILE, "{}", "utf8");
  assert.throws(
    () => readPassportRecords(),
    error => error?.code === "PASSPORT_REGISTRY_INVALID_SHAPE"
  );
});

test("atomic writes preserve the existing registry mode", () => {
  fs.writeFileSync(process.env.IXI_PASSPORT_DATA_FILE, "[]", { mode: 0o640 });
  fs.chmodSync(process.env.IXI_PASSPORT_DATA_FILE, 0o640);

  writePassportRecords([{ passportId: "IXITEST001" }]);

  assert.deepEqual(readPassportRecords(), [{ passportId: "IXITEST001" }]);
  assert.equal(fs.statSync(process.env.IXI_PASSPORT_DATA_FILE).mode & 0o777, 0o640);
  assert.equal(fs.existsSync(`${process.env.IXI_PASSPORT_DATA_FILE}.lock`), false);
});

test("an active registry lock fails fast without blocking the service", () => {
  const lockFile = `${process.env.IXI_PASSPORT_DATA_FILE}.lock`;
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid }), "utf8");
  const startedAt = Date.now();

  assert.throws(
    () => writePassportRecords([{ passportId: "IXILOCKED01" }]),
    error => error?.code === "PASSPORT_REGISTRY_BUSY" &&
      error?.status === 503 && error?.retryable === true
  );
  assert.ok(Date.now() - startedAt < 250);
  fs.unlinkSync(lockFile);
});

test("a stale registry lock is recovered without weakening atomic writes", () => {
  const lockFile = `${process.env.IXI_PASSPORT_DATA_FILE}.lock`;
  fs.writeFileSync(lockFile, JSON.stringify({ pid: 999999 }), "utf8");
  const staleAt = new Date(Date.now() - 60000);
  fs.utimesSync(lockFile, staleAt, staleAt);

  writePassportRecords([{ passportId: "IXISTALE01" }]);

  assert.deepEqual(readPassportRecords(), [{ passportId: "IXISTALE01" }]);
  assert.equal(fs.existsSync(lockFile), false);
});

test("permanent Passport deletion by ID or source is prohibited", () => {
  writePassportRecords([
    {
      passportId: "IXITEST002",
      sourceType: "mos-person",
      sourceId: "object_1",
      sources: [
        { sourceType: "mos-person", sourceId: "object_1" },
        { sourceType: "sharetribe-user", sourceId: "user_1" }
      ]
    }
  ]);

  assert.throws(
    () => deletePassportById("IXITEST002"),
    error => error?.code === "PASSPORT_PERMANENT_IDENTITY_DELETE_FORBIDDEN"
  );
  assert.throws(
    () => deletePassportBySource("sharetribe-user", "user_1"),
    error => error?.code === "PASSPORT_PERMANENT_IDENTITY_DELETE_FORBIDDEN"
  );
  assert.equal(readPassportRecords().length, 1);
});

test("source unbinding preserves the Passport and its other identities", () => {
  writePassportRecords([
    {
      passportId: "IXITEST003",
      sourceType: "sharetribe-listing",
      sourceId: "listing_1",
      sources: [
        { sourceType: "sharetribe-listing", sourceId: "listing_1" },
        { sourceType: "aos-object", sourceId: "object_old" },
        { sourceType: "aos-object", sourceId: "object_keep" }
      ]
    }
  ]);

  const result = unbindPassportSource("aos-object", "object_old");
  assert.equal(result.changed, true);
  assert.equal(result.passport.passportId, "IXITEST003");
  assert.deepEqual(result.passport.sources, [
    { sourceType: "sharetribe-listing", sourceId: "listing_1" },
    { sourceType: "aos-object", sourceId: "object_keep" }
  ]);
});

test("source unbinding refuses to orphan a Passport", () => {
  writePassportRecords([
    {
      passportId: "IXITEST004",
      sourceType: "aos-object",
      sourceId: "object_only",
      sources: [{ sourceType: "aos-object", sourceId: "object_only" }]
    }
  ]);

  assert.throws(
    () => unbindPassportSource("aos-object", "object_only"),
    error => error?.code === "PASSPORT_FINAL_SOURCE_UNBIND_FORBIDDEN"
  );
  assert.equal(readPassportRecords().length, 1);
});

test('repeating a verified source binding changes neither timestamps nor the registry file', () => {
  const { bindPassportSource } = require('./passportRegistry');
  const record = { passportId: 'IXITEST009', entityId: 'ENT-1', sourceType: 'sharetribe-listing', sourceId: 'listing-1',
    sources: [{ sourceType: 'aos-object', sourceId: 'object-1' }], updatedAt: '2026-09-01T00:00:00Z' };
  writePassportRecords([record]);
  const before = fs.readFileSync(process.env.IXI_PASSPORT_DATA_FILE, 'utf8');
  const inode = fs.statSync(process.env.IXI_PASSPORT_DATA_FILE).ino;
  assert.deepEqual(bindPassportSource({ passportId: record.passportId, sourceType: 'aos-object', sourceId: 'object-1', entityId: 'ENT-1' }), record);
  assert.equal(fs.readFileSync(process.env.IXI_PASSPORT_DATA_FILE, 'utf8'), before);
  assert.equal(fs.statSync(process.env.IXI_PASSPORT_DATA_FILE).ino, inode);
  assert.throws(() => bindPassportSource({ passportId: record.passportId, sourceType: 'aos-object', sourceId: 'object-1', entityId: 'ENT-2' }), error => error.code === 'PASSPORT_ENTITY_MISMATCH');
  writePassportRecords([{ ...record, entityId: null }]);
  assert.equal(bindPassportSource({ passportId: record.passportId, sourceType: 'aos-object', sourceId: 'object-1', entityId: 'ENT-1' }).entityId, 'ENT-1');
});
