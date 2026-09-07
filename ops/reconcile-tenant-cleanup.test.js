"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");

const { buildCleanup } = require("./reconcile-tenant-cleanup");

const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-cleanup-"));
  const databasePath = path.join(root, "mos.sqlite");
  const passportPath = path.join(root, "passports.json");
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
  `);
  const collections = {
    "entities.json": {
      live: { entityId: "entity_live", displayName: "Live" },
      test: { entityId: "entity_test", displayName: "Test" }
    },
    "objects.json": {
      canonical: {
        objectId: "object_canonical",
        entityId: "entity_live",
        revision: 2,
        metadata: { identityEntityId: "entity_test", keep: true }
      },
      duplicate: { objectId: "object_duplicate", entityId: "entity_live" },
      test: { objectId: "object_test", entityId: "entity_test" }
    },
    "projections.json": {
      canonical: { containerId: "object_canonical" },
      duplicate: { containerId: "object_duplicate" }
    },
    "events.json": [
      { entityId: "entity_test", objectId: "object_test" },
      { entityId: "entity_live", objectId: "object_duplicate" }
    ],
    "idempotency.json": {
      protected_update: {
        commandId: "protected_update",
        entityId: "entity_live",
        status: "completed",
        result: {
          object: {
            objectId: "object_canonical",
            entityId: "entity_live",
            metadata: { identityEntityId: "entity_test" }
          }
        }
      },
      test_update: {
        commandId: "test_update",
        entityId: "entity_test",
        status: "completed"
      }
    }
  };
  const statement = database.prepare(`
    INSERT INTO mos_collections
      (collection_key, payload, payload_sha256, version, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `);
  for (const [key, value] of Object.entries(collections)) {
    const payload = JSON.stringify(value);
    statement.run(key, payload, sha256(payload), "2026-01-01", "2026-01-01");
  }
  database.close();

  fs.writeFileSync(passportPath, JSON.stringify([
    { passportId: "IXITEST001", entityId: "entity_test" },
    {
      passportId: "IXILIVE001",
      entityId: "entity_live",
      sourceType: "sharetribe-listing",
      sourceId: "listing_1",
      sources: [
        { sourceType: "sharetribe-listing", sourceId: "listing_1" },
        { sourceType: "aos-object", sourceId: "object_duplicate" },
        { sourceType: "aos-object", sourceId: "object_canonical" }
      ]
    }
  ], null, 2));

  return { root, databasePath, passportPath };
}

const manifest = {
  cleanupId: "TEST-CLEANUP",
  protectedEntityId: "entity_live",
  purgeScopeIds: ["entity_test"],
  deletePassportIds: ["IXITEST001"],
  objectMetadataRepairs: [{
    objectId: "object_canonical",
    requireEntityId: "entity_live",
    expectedValues: { identityEntityId: "entity_test" },
    removeKeys: ["identityEntityId"]
  }],
  passportReconciliation: {
    passportId: "IXILIVE001",
    canonicalObjectId: "object_canonical",
    removeAosObjectSourceIds: ["object_duplicate"]
  }
};

test("cleanup dry-run is immutable and apply preserves protected canonical data", () => {
  const item = fixture();
  try {
    const databaseBefore = fs.readFileSync(item.databasePath);
    const passportsBefore = fs.readFileSync(item.passportPath);
    const dryRun = buildCleanup({ ...item, manifest, apply: false });
    assert.equal(dryRun.mode, "dry-run");
    assert.deepEqual(fs.readFileSync(item.databasePath), databaseBefore);
    assert.deepEqual(fs.readFileSync(item.passportPath), passportsBefore);

    const applied = buildCleanup({ ...item, manifest, apply: true });
    assert.equal(applied.mode, "apply");
    assert.deepEqual(applied.integrityAfter, ["ok"]);
    assert.deepEqual(applied.passports.removed, ["IXITEST001"]);

    const database = new Database(item.databasePath, { readonly: true });
    const objects = JSON.parse(database.prepare(
      "SELECT payload FROM mos_collections WHERE collection_key = 'objects.json'"
    ).get().payload);
    const events = JSON.parse(database.prepare(
      "SELECT payload FROM mos_collections WHERE collection_key = 'events.json'"
    ).get().payload);
    const idempotency = JSON.parse(database.prepare(
      "SELECT payload FROM mos_collections WHERE collection_key = 'idempotency.json'"
    ).get().payload);
    database.close();
    assert.ok(objects.canonical);
    assert.equal(objects.canonical.entityId, "entity_live");
    assert.equal(objects.canonical.revision, 3);
    assert.equal(objects.canonical.metadata.identityEntityId, undefined);
    assert.equal(objects.canonical.metadata.keep, true);
    assert.equal(objects.duplicate, undefined);
    assert.equal(objects.test, undefined);
    assert.equal(events.length, 1);
    assert.equal(events[0].objectId, "object_duplicate");
    assert.ok(idempotency.protected_update);
    assert.equal(idempotency.test_update, undefined);

    const passports = JSON.parse(fs.readFileSync(item.passportPath, "utf8"));
    assert.equal(passports.length, 1);
    assert.deepEqual(passports[0].sources, [
      { sourceType: "sharetribe-listing", sourceId: "listing_1" },
      { sourceType: "aos-object", sourceId: "object_canonical" }
    ]);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("cleanup fails closed on a protected cross-boundary record", () => {
  const item = fixture();
  try {
    const database = new Database(item.databasePath);
    const row = database.prepare(
      "SELECT payload, version FROM mos_collections WHERE collection_key = 'events.json'"
    ).get();
    const events = JSON.parse(row.payload);
    events.push({ entityId: "entity_test", ownerEntityId: "entity_live" });
    const payload = JSON.stringify(events);
    database.prepare(`
      UPDATE mos_collections SET payload = ?, payload_sha256 = ?
      WHERE collection_key = 'events.json'
    `).run(payload, sha256(payload));
    database.close();

    assert.throws(
      () => buildCleanup({ ...item, manifest, apply: false }),
      /Cross-boundary record blocks cleanup/
    );
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});
