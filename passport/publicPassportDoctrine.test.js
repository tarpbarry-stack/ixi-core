"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-passport-doctrine-"));
process.env.IXI_PASSPORT_DATA_FILE = path.join(testRoot, "passports.json");
process.env.IXI_MOS_DATA_ROOT = path.join(testRoot, "mos");
process.env.IXI_MOS_STORAGE_PROVIDER = "sqlite";
process.env.IXI_MOS_SQLITE_PATH = path.join(testRoot, "mos", "ixi-aos.sqlite");

const { writePassportRecords, readPassportRecords } = require("./passportRegistry");
const { app } = require("../index");

test.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

test("generic Passport birth and permanent deletion endpoints return doctrine errors", async () => {
  writePassportRecords([{
    passportId: "IXIPERMANENT1",
    sourceType: "aos-object",
    sourceId: "object_permanent",
    sources: [{ sourceType: "aos-object", sourceId: "object_permanent" }]
  }]);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const ensure = await fetch(`${baseUrl}/passport/ensure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceType: "listing", sourceId: "forged" })
    });
    assert.equal(ensure.status, 410);
    assert.equal((await ensure.json()).error.code, "GENERIC_PASSPORT_ENSURE_RETIRED");

    const byId = await fetch(`${baseUrl}/passport/IXIPERMANENT1`, { method: "DELETE" });
    assert.equal(byId.status, 410);
    assert.equal((await byId.json()).error.code, "PASSPORT_DELETE_RETIRED");

    const bySource = await fetch(
      `${baseUrl}/passport/by-source/aos-object/object_permanent`,
      { method: "DELETE" }
    );
    assert.equal(bySource.status, 410);
    assert.equal((await bySource.json()).error.code, "PASSPORT_SOURCE_DELETE_RETIRED");
    assert.equal(readPassportRecords().length, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("liveness is storage-free and readiness avoids synchronous integrity scans", async () => {
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const live = await fetch(`${baseUrl}/live`);
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), {
      ok: true,
      service: "ix-core",
      state: "live"
    });

    const ready = await fetch(`${baseUrl}/ready`);
    assert.equal(ready.status, 200);
    const readiness = await ready.json();
    assert.equal(readiness.ok, true);
    assert.equal(readiness.state, "ready");
    assert.equal(readiness.mosStorage.integrity, "not-checked");
    assert.equal(readiness.mosStorage.integrityChecked, false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
