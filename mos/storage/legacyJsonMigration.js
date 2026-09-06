"use strict";

const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { MOS_PATHS } = require("./mosPaths");
const { MosSqliteStore } = require("./sqliteStore");

function legacyCollectionPaths(sourceRoot = MOS_PATHS.root) {
  return Object.entries(MOS_PATHS)
    .filter(([key, filePath]) => key !== "root" && String(filePath).endsWith(".json"))
    .map(([name, filePath]) => ({
      name,
      filePath,
      sourcePath: path.join(sourceRoot, path.basename(filePath))
    }));
}

function hashBuffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function timestampId() {
  return new Date().toISOString().replaceAll(/[:.]/g, "-");
}

function readLegacyCollection(filePath) {
  const raw = fs.readFileSync(filePath);
  return {
    raw,
    checksum: hashBuffer(raw),
    value: JSON.parse(raw.toString("utf8"))
  };
}

function migrateLegacyJson({
  dataRoot = MOS_PATHS.root,
  legacyJsonRoot = process.env.IXI_MOS_LEGACY_JSON_ROOT || dataRoot,
  databasePath = process.env.IXI_MOS_SQLITE_PATH || path.join(dataRoot, "ixi-aos.sqlite"),
  mode = "dry-run",
  backupRoot = path.join(path.dirname(databasePath), "migration-backups")
} = {}) {
  const collections = legacyCollectionPaths(legacyJsonRoot)
    .filter(item => fs.existsSync(item.sourcePath));
  const report = {
    mode,
    databasePath: path.resolve(databasePath),
    sourceCount: collections.length,
    backupPath: null,
    collections: []
  };

  if (mode === "dry-run") {
    report.collections = collections.map(item => {
      const source = readLegacyCollection(item.sourcePath);
      return {
        name: item.name,
        sourcePath: item.sourcePath,
        sourceChecksum: source.checksum,
        recordCount: Array.isArray(source.value)
          ? source.value.length
          : Object.keys(source.value || {}).length,
        action: "would-import"
      };
    });
    return report;
  }

  if (!["apply", "verify"].includes(mode)) {
    throw new Error(`Unsupported migration mode: ${mode}`);
  }

  if (!collections.length) {
    const error = new Error(
      `No legacy MOS JSON collections were found in ${path.resolve(legacyJsonRoot)}.`
    );
    error.code = "MOS_MIGRATION_SOURCE_EMPTY";
    throw error;
  }

  const store = new MosSqliteStore({ dataRoot, databasePath });
  try {
    if (mode === "apply") {
      const backupPath = path.join(backupRoot, `legacy-json-${timestampId()}`);
      fs.mkdirSync(backupPath, { recursive: true, mode: 0o700 });
      report.backupPath = backupPath;

      for (const item of collections) {
        const source = readLegacyCollection(item.sourcePath);
        const backupFile = path.join(backupPath, path.basename(item.sourcePath));
        fs.copyFileSync(item.sourcePath, backupFile, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(backupFile, 0o600);

        const existing = store.inspect(item.filePath);
        if (existing) {
          const current = store.read(item.filePath, {});
          assert.deepStrictEqual(
            current,
            source.value,
            `Database collection already differs from legacy source: ${item.name}`
          );
        } else {
          store.write(item.filePath, source.value);
        }

        const stored = store.read(item.filePath, {});
        assert.deepStrictEqual(stored, source.value, `Migration readback failed: ${item.name}`);
        const storage = store.inspect(item.filePath);
        const migrationId = `legacy-json:${item.name}:${source.checksum}`;
        store.recordMigration({
          migrationId,
          sourcePath: item.sourcePath,
          filePath: item.filePath,
          sourceSha256: source.checksum,
          importedVersion: storage.version
        });

        report.collections.push({
          name: item.name,
          sourcePath: item.sourcePath,
          sourceChecksum: source.checksum,
          databaseChecksum: storage.checksum,
          databaseVersion: storage.version,
          migrationId,
          action: existing ? "verified-existing" : "imported"
        });
      }
    } else {
      for (const item of collections) {
        const source = readLegacyCollection(item.sourcePath);
        const existing = store.inspect(item.filePath);
        if (!existing) throw new Error(`Database collection is missing: ${item.name}`);
        assert.deepStrictEqual(
          store.read(item.filePath, {}),
          source.value,
          `Database collection differs from legacy source: ${item.name}`
        );
        const migrationId = `legacy-json:${item.name}:${source.checksum}`;
        if (!store.readMigration(migrationId)) {
          throw new Error(`Migration evidence is missing: ${item.name}`);
        }
        report.collections.push({
          name: item.name,
          sourcePath: item.sourcePath,
          sourceChecksum: source.checksum,
          databaseChecksum: existing.checksum,
          databaseVersion: existing.version,
          migrationId,
          action: "verified"
        });
      }
    }
  } finally {
    store.close();
  }

  return report;
}

module.exports = { legacyCollectionPaths, migrateLegacyJson, readLegacyCollection };
