"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");

const { buildTenantCensus } = require("./audit-tenant-census");

const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-tenant-census-"));
  const dataRoot = path.join(root, "mos");
  const databasePath = path.join(dataRoot, "ixi-aos.sqlite");
  const passportPath = path.join(root, "passports.json");
  fs.mkdirSync(dataRoot, { recursive: true });

  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE mos_collections (
      collection_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE mos_collection_history (
      collection_key TEXT NOT NULL,
      version INTEGER NOT NULL,
      payload TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      archived_at TEXT NOT NULL,
      PRIMARY KEY (collection_key, version)
    );
    CREATE TABLE mos_migrations (
      migration_id TEXT PRIMARY KEY,
      source_path TEXT NOT NULL,
      collection_key TEXT NOT NULL,
      source_sha256 TEXT NOT NULL,
      imported_version INTEGER NOT NULL,
      imported_at TEXT NOT NULL
    );
  `);

  const now = "2026-09-07T00:00:00.000Z";
  const insert = database.prepare(`
    INSERT INTO mos_collections
      (collection_key, payload, payload_sha256, version, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `);
  const put = (key, value) => {
    const payload = JSON.stringify(value);
    insert.run(key, payload, sha256(payload), now, now);
  };

  put("entities.json", {
    entity_keep: { entityId: "entity_keep", displayName: "Keep Equipment", status: "active" }
  });
  put("objects.json", {
    object_1: {
      objectId: "object_1",
      entityId: "entity_keep",
      status: "active",
      passportIdentity: { passportId: "IXIKEEP001" },
      metadata: { provisioning: { contractVersion: "ixi-aos-object-provision-v1" } }
    },
    object_2: {
      objectId: "object_2",
      entityId: "entity_keep",
      status: "active",
      passportIdentity: { passportId: "IXIMISSING" },
      metadata: { provisioning: { contractVersion: "ixi-aos-object-provision-v1" } }
    }
  });
  put("relationships.json", {});
  put("accounts.json", {});
  put("memberships.json", {});
  database.close();

  fs.writeFileSync(passportPath, JSON.stringify([
    {
      passportId: "IXIKEEP001",
      entityId: "entity_keep",
      sourceType: "aos-object",
      sourceId: "object_1"
    }
  ], null, 2));
  fs.writeFileSync(path.join(dataRoot, "objects.json"), "{}\n");

  return { root, dataRoot, databasePath, passportPath };
}

test("tenant census is read-only and reports identity gaps", () => {
  const fixture = createFixture();
  const databaseBefore = fs.readFileSync(fixture.databasePath);
  const passportsBefore = fs.readFileSync(fixture.passportPath);

  try {
    const report = buildTenantCensus({
      databasePath: fixture.databasePath,
      passportPath: fixture.passportPath,
      protectedEntityId: "entity_keep",
      dataRoot: fixture.dataRoot
    });

    assert.equal(report.readOnly, true);
    assert.equal(report.storage.sqliteIntegrity[0], "ok");
    assert.equal(report.totals.entities, 1);
    assert.equal(report.totals.objects, 2);
    assert.equal(report.entities[0].classification, "KEEP_PROTECTED");
    assert.ok(report.findings.some(finding =>
      finding.code === "OBJECT_PASSPORT_NOT_FOUND" &&
      finding.objectId === "object_2" &&
      finding.severity === "critical"
    ));
    assert.equal(report.legacyJsonFiles[0].classification,
      "LEGACY_INACTIVE_WHILE_SQLITE_PROVIDER_IS_ACTIVE");
    assert.deepEqual(fs.readFileSync(fixture.databasePath), databaseBefore);
    assert.deepEqual(fs.readFileSync(fixture.passportPath), passportsBefore);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
