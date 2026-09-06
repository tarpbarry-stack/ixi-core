"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { MosSqliteStore } = require("./sqliteStore");

test("legacy JSON migration creates a backup, durable data, and evidence", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-mos-migration-"));
  const legacyJsonRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-mos-legacy-"));
  const databasePath = path.join(dataRoot, "ixi-aos.sqlite");
  const objectsPath = path.join(dataRoot, "objects.json");
  const legacyObjectsPath = path.join(legacyJsonRoot, "objects.json");
  const objects = { "object-joe": { objectId: "object-joe", passportId: "IXI-JOE" } };
  fs.writeFileSync(legacyObjectsPath, JSON.stringify(objects, null, 2), "utf8");

  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "migrateLegacyJson.js"), "--apply"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        IXI_MOS_DATA_ROOT: dataRoot,
        IXI_MOS_LEGACY_JSON_ROOT: legacyJsonRoot,
        IXI_MOS_SQLITE_PATH: databasePath
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.sourceCount, 1);
  assert.equal(report.collections[0].action, "imported");
  assert.equal(fs.existsSync(path.join(report.backupPath, "objects.json")), true);

  const store = new MosSqliteStore({ dataRoot, databasePath });
  assert.deepEqual(store.read(objectsPath, {}), objects);
  assert.ok(store.readMigration(report.collections[0].migrationId));
  store.close();

  const verify = spawnSync(
    process.execPath,
    [path.join(__dirname, "migrateLegacyJson.js"), "--verify"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        IXI_MOS_DATA_ROOT: dataRoot,
        IXI_MOS_LEGACY_JSON_ROOT: legacyJsonRoot,
        IXI_MOS_SQLITE_PATH: databasePath
      }
    }
  );
  assert.equal(verify.status, 0, verify.stderr);
  assert.equal(JSON.parse(verify.stdout).collections[0].action, "verified");
});
