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
  deletePassportBySource
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

test("source deletion recognizes aliases in sources[]", () => {
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

  const result = deletePassportBySource("sharetribe-user", "user_1");
  assert.equal(result.deleted, true);
  assert.deepEqual(readPassportRecords(), []);
});
