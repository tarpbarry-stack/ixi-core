"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const stores = new Map();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256(payload) {
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function storageError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = code === "MOS_STORAGE_CONFLICT" ? 409 : 500;
  error.details = details;
  return error;
}

function normalizeCollectionKey(filePath, dataRoot) {
  const absoluteRoot = path.resolve(dataRoot);
  const absoluteFile = path.resolve(filePath);
  const relative = path.relative(absoluteRoot, absoluteFile);

  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw storageError(
      "MOS_STORAGE_COLLECTION_INVALID",
      "MOS collection path must be inside IXI_MOS_DATA_ROOT.",
      { filePath: absoluteFile, dataRoot: absoluteRoot }
    );
  }

  return relative.replaceAll(path.sep, "/");
}

class MosSqliteStore {
  constructor({ dataRoot, databasePath }) {
    this.dataRoot = path.resolve(dataRoot);
    this.databasePath = path.resolve(databasePath);
    this.observedVersions = new Map();

    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.database = new Database(this.databasePath);
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec("PRAGMA synchronous = FULL;");
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.database.exec("PRAGMA busy_timeout = 5000;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS mos_collections (
        collection_key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mos_collection_history (
        collection_key TEXT NOT NULL,
        version INTEGER NOT NULL,
        payload TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        archived_at TEXT NOT NULL,
        PRIMARY KEY (collection_key, version)
      );
      CREATE TABLE IF NOT EXISTS mos_migrations (
        migration_id TEXT PRIMARY KEY,
        source_path TEXT NOT NULL,
        collection_key TEXT NOT NULL,
        source_sha256 TEXT NOT NULL,
        imported_version INTEGER NOT NULL,
        imported_at TEXT NOT NULL
      );
    `);

    try {
      fs.chmodSync(this.databasePath, 0o600);
    } catch (error) {
      if (error?.code !== "EPERM") throw error;
    }
  }

  collectionKey(filePath) {
    return normalizeCollectionKey(filePath, this.dataRoot);
  }

  read(filePath, fallback) {
    const key = this.collectionKey(filePath);
    const row = this.database.prepare(
      "SELECT payload, payload_sha256, version FROM mos_collections WHERE collection_key = ?"
    ).get(key);

    if (!row) {
      this.observedVersions.set(key, 0);
      this.write(filePath, fallback);
      return clone(fallback);
    }

    if (sha256(row.payload) !== row.payload_sha256) {
      throw storageError(
        "MOS_STORAGE_CHECKSUM_FAILED",
        `MOS collection checksum failed: ${key}`,
        { collectionKey: key, version: row.version }
      );
    }

    this.observedVersions.set(key, Number(row.version));
    return JSON.parse(row.payload);
  }

  write(filePath, value) {
    const key = this.collectionKey(filePath);
    const payload = JSON.stringify(value);
    const checksum = sha256(payload);
    const timestamp = nowIso();
    const expectedVersion = this.observedVersions.get(key);

    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const current = this.database.prepare(
        "SELECT payload, payload_sha256, version, created_at FROM mos_collections WHERE collection_key = ?"
      ).get(key);
      const currentVersion = Number(current?.version || 0);

      if (current && expectedVersion === undefined) {
        throw storageError(
          "MOS_STORAGE_CONFLICT",
          `MOS collection must be read before it can be replaced: ${key}`,
          { collectionKey: key, currentVersion }
        );
      }

      if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
        throw storageError(
          "MOS_STORAGE_CONFLICT",
          `MOS collection changed before this write: ${key}`,
          { collectionKey: key, expectedVersion, currentVersion }
        );
      }

      if (current) {
        this.database.prepare(`
          INSERT OR IGNORE INTO mos_collection_history
            (collection_key, version, payload, payload_sha256, archived_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(key, currentVersion, current.payload, current.payload_sha256, timestamp);

        const result = this.database.prepare(`
          UPDATE mos_collections
          SET payload = ?, payload_sha256 = ?, version = ?, updated_at = ?
          WHERE collection_key = ? AND version = ?
        `).run(payload, checksum, currentVersion + 1, timestamp, key, currentVersion);

        if (Number(result.changes) !== 1) {
          throw storageError(
            "MOS_STORAGE_CONFLICT",
            `MOS collection write lost its revision lock: ${key}`,
            { collectionKey: key, expectedVersion: currentVersion }
          );
        }
      } else {
        this.database.prepare(`
          INSERT INTO mos_collections
            (collection_key, payload, payload_sha256, version, created_at, updated_at)
          VALUES (?, ?, ?, 1, ?, ?)
        `).run(key, payload, checksum, timestamp, timestamp);
      }

      this.database.exec("COMMIT;");
      this.observedVersions.set(key, currentVersion + 1);
      return value;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  update(filePath, fallback, updater) {
    const current = this.read(filePath, fallback);
    const next = updater(clone(current));
    return this.write(filePath, next);
  }

  inspect(filePath) {
    const key = this.collectionKey(filePath);
    return this.database.prepare(`
      SELECT collection_key AS collectionKey, payload_sha256 AS checksum,
             version, created_at AS createdAt, updated_at AS updatedAt
      FROM mos_collections WHERE collection_key = ?
    `).get(key) || null;
  }

  health() {
    const integrity = this.database.prepare("PRAGMA quick_check;").get();
    const collections = this.database.prepare(
      "SELECT COUNT(*) AS count FROM mos_collections"
    ).get();
    const history = this.database.prepare(
      "SELECT COUNT(*) AS count FROM mos_collection_history"
    ).get();
    const migrations = this.database.prepare(
      "SELECT COUNT(*) AS count FROM mos_migrations"
    ).get();

    return {
      ok: integrity?.quick_check === "ok",
      provider: "sqlite",
      databasePath: this.databasePath,
      journalMode: "wal",
      synchronous: "full",
      collections: Number(collections?.count || 0),
      historyVersions: Number(history?.count || 0),
      migrations: Number(migrations?.count || 0),
      integrity: integrity?.quick_check || "unknown"
    };
  }

  recordMigration({ migrationId, sourcePath, filePath, sourceSha256, importedVersion }) {
    this.database.prepare(`
      INSERT OR IGNORE INTO mos_migrations
        (migration_id, source_path, collection_key, source_sha256, imported_version, imported_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      migrationId,
      path.resolve(sourcePath),
      this.collectionKey(filePath),
      sourceSha256,
      importedVersion,
      nowIso()
    );
  }

  readMigration(migrationId) {
    return this.database.prepare(`
      SELECT migration_id AS migrationId, source_path AS sourcePath,
             collection_key AS collectionKey, source_sha256 AS sourceSha256,
             imported_version AS importedVersion, imported_at AS importedAt
      FROM mos_migrations WHERE migration_id = ?
    `).get(migrationId) || null;
  }

  close() {
    this.database.close();
  }
}

function getMosSqliteStore({
  dataRoot = process.env.IXI_MOS_DATA_ROOT || path.join(process.cwd(), "data", "mos"),
  databasePath = process.env.IXI_MOS_SQLITE_PATH || path.join(dataRoot, "ixi-aos.sqlite")
} = {}) {
  const key = path.resolve(databasePath);
  if (!stores.has(key)) stores.set(key, new MosSqliteStore({ dataRoot, databasePath }));
  return stores.get(key);
}

module.exports = {
  MosSqliteStore,
  getMosSqliteStore,
  normalizeCollectionKey,
  sha256,
  storageError
};
