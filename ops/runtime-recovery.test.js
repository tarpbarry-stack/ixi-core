"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { MosSqliteStore } = require("../mos/storage/sqliteStore");
test("recovery set restores SQLite and matching Passports independently of the original runtime", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-recovery-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, "app"), dataRoot = path.join(root, "data");
  fs.mkdirSync(path.join(app, "passport"), { recursive: true });
  fs.writeFileSync(path.join(app, "passport/passports.json"), JSON.stringify([{ passportId: "IXI_RECOVER" }]));
  const files = { dataRoot, databasePath: path.join(dataRoot, "ixi-aos.sqlite") };
  const store = new MosSqliteStore(files);
  store.write(path.join(dataRoot, "objects.json"), {
    object_recover: { objectId: "object_recover", status: "active",
      identities: [{ identityType: "ixi-passport", passportId: "IXI_RECOVER" }] }
  });
  store.close();
  const output = path.join(root, "recovery");
  const script = path.join(__dirname, "runtime-recovery.py");
  const capture = spawnSync("python3", [script, "create", "--app-root", app,
    "--mos-db", files.databasePath, "--output-dir", output, "--writers-stopped"], { encoding: "utf8" });
  assert.equal(capture.status, 0, capture.stderr);
  const report = JSON.parse(capture.stdout);
  assert.equal(report.census.activeObjects, 1);
  assert.equal(report.census.passports, 1);
  fs.rmSync(app, { recursive: true });
  fs.rmSync(dataRoot, { recursive: true });
  const check = () => spawnSync("python3", [script, "verify", "--output-dir", output], { encoding: "utf8" });
  assert.equal(check().status, 0);
  fs.appendFileSync(path.join(output, "runtime.tar.gz"), "corruption");
  const corrupt = check();
  assert.notEqual(corrupt.status, 0);
  assert.match(corrupt.stderr, /Recovery checksum failed/);
});
