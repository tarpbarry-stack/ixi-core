"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const clean = value => String(value ?? "").trim();
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");

function parseArguments(argv) {
  const options = { apply: false, confirm: "" };
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--database") options.databasePath = argv[++index];
    else if (argument === "--passports") options.passportPath = argv[++index];
    else if (argument === "--manifest") options.manifestPath = argv[++index];
    else if (argument === "--apply") options.apply = true;
    else if (argument === "--confirm") options.confirm = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  for (const key of ["databasePath", "passportPath", "manifestPath"]) {
    if (!options[key]) throw new Error(`--${key.replace("Path", "")} is required`);
  }
  return options;
}

function contains(value, targets) {
  if (typeof value === "string") return targets.has(value);
  if (Array.isArray(value)) return value.some(item => contains(item, targets));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, item]) =>
      targets.has(key) || contains(item, targets)
    );
  }
  return false;
}

function transformRecords(payload, predicate) {
  if (Array.isArray(payload)) {
    const removed = payload.filter(predicate);
    return { next: payload.filter(record => !predicate(record)), removed };
  }
  if (payload && typeof payload === "object") {
    const next = {};
    const removed = [];
    for (const [key, record] of Object.entries(payload)) {
      if (predicate(record, key)) removed.push(record);
      else next[key] = record;
    }
    return { next, removed };
  }
  return { next: payload, removed: [] };
}

function sourceList(passport) {
  const candidates = [
    { sourceType: clean(passport?.sourceType), sourceId: clean(passport?.sourceId) },
    ...(Array.isArray(passport?.sources) ? passport.sources : [])
  ];
  const seen = new Set();
  return candidates
    .map(source => ({ sourceType: clean(source?.sourceType), sourceId: clean(source?.sourceId) }))
    .filter(source => source.sourceType && source.sourceId)
    .filter(source => {
      const key = `${source.sourceType}|${source.sourceId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function reconcilePassport(passport, reconciliation) {
  if (passport.passportId !== reconciliation.passportId) return passport;
  const removeIds = new Set(reconciliation.removeAosObjectSourceIds || []);
  const sources = sourceList(passport).filter(source => !(
    source.sourceType === "aos-object" && removeIds.has(source.sourceId)
  ));
  const canonicalFound = sources.some(source =>
    source.sourceType === "aos-object" &&
    source.sourceId === reconciliation.canonicalObjectId
  );
  if (!canonicalFound) {
    throw new Error(`Canonical Passport source is missing: ${reconciliation.canonicalObjectId}`);
  }
  if (!sources.length) throw new Error(`Reconciliation would orphan Passport ${passport.passportId}`);
  const primaryExists = sources.some(source =>
    source.sourceType === passport.sourceType && source.sourceId === passport.sourceId
  );
  const primary = primaryExists
    ? { sourceType: passport.sourceType, sourceId: passport.sourceId }
    : sources[0];
  return {
    ...passport,
    sourceType: primary.sourceType,
    sourceId: primary.sourceId,
    sources,
    updatedAt: new Date().toISOString()
  };
}

function atomicWrite(filePath, payload) {
  const stat = fs.statSync(filePath);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const descriptor = fs.openSync(temporaryPath, "wx", stat.mode & 0o777);
  try {
    fs.writeFileSync(descriptor, payload, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    fs.chownSync(temporaryPath, stat.uid, stat.gid);
    fs.chmodSync(temporaryPath, stat.mode & 0o777);
    fs.renameSync(temporaryPath, filePath);
    const directory = fs.openSync(path.dirname(filePath), "r");
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function buildCleanup({ databasePath, passportPath, manifest, apply = false }) {
  const purgeScopes = new Set(manifest.purgeScopeIds || []);
  const protectedEntityId = clean(manifest.protectedEntityId);
  const reconciliation = manifest.passportReconciliation || null;
  if (!manifest.cleanupId || !protectedEntityId || !purgeScopes.size) {
    throw new Error("Manifest requires cleanupId, protectedEntityId, and purgeScopeIds");
  }
  if (purgeScopes.has(protectedEntityId)) {
    throw new Error("Protected Entity cannot be a purge scope");
  }

  const database = new Database(databasePath, {
    readonly: !apply,
    fileMustExist: true
  });
  const report = {
    cleanupId: manifest.cleanupId,
    mode: apply ? "apply" : "dry-run",
    protectedEntityId,
    integrityBefore: database.pragma("quick_check").map(row => Object.values(row)[0]),
    changedCollections: [],
    removedByCollection: {},
    passports: null
  };

  try {
    if (report.integrityBefore.length !== 1 || report.integrityBefore[0] !== "ok") {
      throw new Error("SQLite quick_check failed before cleanup");
    }
    const rows = database.prepare(`
      SELECT collection_key, payload, payload_sha256, version, created_at
      FROM mos_collections ORDER BY collection_key
    `).all();
    const changes = [];
    const duplicateObjectIds = new Set(
      reconciliation?.removeAosObjectSourceIds || []
    );

    for (const row of rows) {
      if (sha256(row.payload) !== row.payload_sha256) {
        throw new Error(`Collection checksum mismatch: ${row.collection_key}`);
      }
      const payload = JSON.parse(row.payload);
      const transformed = transformRecords(payload, (record, key) => {
        const purgeMatch = contains(record, purgeScopes) || purgeScopes.has(key);
        if (purgeMatch && contains(record, new Set([protectedEntityId]))) {
          throw new Error(`Cross-boundary record blocks cleanup: ${row.collection_key}`);
        }
        if (purgeMatch) return true;
        if (row.collection_key === "objects.json") {
          return duplicateObjectIds.has(clean(record?.objectId || key));
        }
        if (row.collection_key === "projections.json") {
          return contains(record, duplicateObjectIds) || duplicateObjectIds.has(key);
        }
        return false;
      });
      if (!transformed.removed.length) continue;
      const nextPayload = JSON.stringify(transformed.next);
      changes.push({ row, nextPayload, checksum: sha256(nextPayload) });
      report.changedCollections.push(row.collection_key);
      report.removedByCollection[row.collection_key] = transformed.removed.length;
    }

    const passportRaw = fs.readFileSync(passportPath, "utf8");
    const passports = JSON.parse(passportRaw);
    if (!Array.isArray(passports)) throw new Error("Passport registry must be an array");
    const explicitPassportIds = new Set(manifest.deletePassportIds || []);
    const removedPassports = passports.filter(passport =>
      purgeScopes.has(clean(passport?.entityId)) ||
      explicitPassportIds.has(clean(passport?.passportId))
    );
    let nextPassports = passports.filter(passport => !removedPassports.includes(passport));
    if (reconciliation) {
      const matches = nextPassports.filter(passport =>
        passport.passportId === reconciliation.passportId
      );
      if (matches.length !== 1) {
        throw new Error(`Expected exactly one Passport ${reconciliation.passportId}`);
      }
      nextPassports = nextPassports.map(passport =>
        reconcilePassport(passport, reconciliation)
      );
    }
    const protectedPassportCountBefore = passports.filter(passport =>
      passport.entityId === protectedEntityId
    ).length;
    const protectedPassportCountAfter = nextPassports.filter(passport =>
      passport.entityId === protectedEntityId
    ).length;
    if (protectedPassportCountBefore !== protectedPassportCountAfter) {
      throw new Error("Protected Entity Passport count changed");
    }
    report.passports = {
      before: passports.length,
      after: nextPassports.length,
      removed: removedPassports.map(passport => passport.passportId).sort(),
      protectedBefore: protectedPassportCountBefore,
      protectedAfter: protectedPassportCountAfter
    };

    if (apply) {
      const timestamp = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE;");
      try {
        for (const change of changes) {
          database.prepare(`
            INSERT OR IGNORE INTO mos_collection_history
              (collection_key, version, payload, payload_sha256, archived_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(
            change.row.collection_key,
            change.row.version,
            change.row.payload,
            change.row.payload_sha256,
            timestamp
          );
          const result = database.prepare(`
            UPDATE mos_collections
            SET payload = ?, payload_sha256 = ?, version = version + 1, updated_at = ?
            WHERE collection_key = ? AND version = ?
          `).run(
            change.nextPayload,
            change.checksum,
            timestamp,
            change.row.collection_key,
            change.row.version
          );
          if (result.changes !== 1) {
            throw new Error(`Revision conflict: ${change.row.collection_key}`);
          }
        }
        database.exec("COMMIT;");
      } catch (error) {
        database.exec("ROLLBACK;");
        throw error;
      }
      atomicWrite(passportPath, `${JSON.stringify(nextPassports, null, 2)}\n`);
      report.integrityAfter = database.pragma("quick_check").map(row => Object.values(row)[0]);
      if (report.integrityAfter.length !== 1 || report.integrityAfter[0] !== "ok") {
        throw new Error("SQLite quick_check failed after cleanup");
      }
    }
    return report;
  } finally {
    database.close();
  }
}

if (require.main === module) {
  try {
    const options = parseArguments(process.argv);
    const manifest = JSON.parse(fs.readFileSync(options.manifestPath, "utf8"));
    if (options.apply && options.confirm !== manifest.cleanupId) {
      throw new Error(`--apply requires --confirm ${manifest.cleanupId}`);
    }
    const report = buildCleanup({
      databasePath: options.databasePath,
      passportPath: options.passportPath,
      manifest,
      apply: options.apply
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  }
}

module.exports = { buildCleanup, parseArguments };
