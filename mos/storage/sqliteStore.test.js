"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { MosSqliteStore } = require("./sqliteStore");

function fixture() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-mos-sqlite-"));
  const databasePath = path.join(dataRoot, "ixi-aos.sqlite");
  const collectionPath = path.join(dataRoot, "objects.json");
  return { dataRoot, databasePath, collectionPath };
}

test("SQLite storage preserves canonical data with version and history", () => {
  const files = fixture();
  const store = new MosSqliteStore(files);

  store.write(files.collectionPath, { joe: { passportId: "IXI-JOE" } });
  assert.deepEqual(store.read(files.collectionPath, {}), {
    joe: { passportId: "IXI-JOE" }
  });
  store.write(files.collectionPath, {
    joe: { passportId: "IXI-JOE", status: "active" }
  });

  const metadata = store.inspect(files.collectionPath);
  assert.equal(metadata.version, 2);
  assert.equal(
    store.database.prepare(
      "SELECT COUNT(*) AS count FROM mos_collection_history WHERE collection_key = ?"
    ).get("objects.json").count,
    1
  );
  store.close();
});

test("SQLite storage rejects a stale concurrent writer", () => {
  const files = fixture();
  const first = new MosSqliteStore(files);
  const second = new MosSqliteStore(files);

  first.write(files.collectionPath, { revision: 1 });
  first.read(files.collectionPath, {});
  second.read(files.collectionPath, {});
  first.write(files.collectionPath, { revision: 2 });

  assert.throws(
    () => second.write(files.collectionPath, { revision: 3 }),
    error => error?.code === "MOS_STORAGE_CONFLICT" && error?.statusCode === 409
  );
  first.close();
  second.close();
});

test("SQLite storage detects payload tampering", () => {
  const files = fixture();
  const store = new MosSqliteStore(files);
  store.write(files.collectionPath, { valid: true });
  store.database.prepare(
    "UPDATE mos_collections SET payload = ? WHERE collection_key = ?"
  ).run(JSON.stringify({ valid: false }), "objects.json");

  assert.throws(
    () => store.read(files.collectionPath, {}),
    error => error?.code === "MOS_STORAGE_CHECKSUM_FAILED"
  );
  store.close();
});

test("SQLite backup is integrity-checked and recoverable", () => {
  const files = fixture();
  const backupRoot = path.join(files.dataRoot, "backups");
  const store = new MosSqliteStore(files);
  store.write(files.collectionPath, { recoverable: true });
  store.close();

  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "backupSqlite.js")],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        IXI_MOS_SQLITE_PATH: files.databasePath,
        IXI_MOS_BACKUP_ROOT: backupRoot,
        IXI_MOS_BACKUP_S3_BUCKET: ""
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.integrity, "ok");
  assert.equal(fs.existsSync(report.destinationPath), true);

  const recovered = new MosSqliteStore({
    dataRoot: files.dataRoot,
    databasePath: report.destinationPath
  });
  assert.deepEqual(recovered.read(files.collectionPath, {}), { recoverable: true });
  recovered.close();
});
