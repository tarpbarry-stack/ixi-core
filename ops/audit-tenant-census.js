"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const clean = value => String(value ?? "").trim();
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");

function recordsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") return Object.values(payload);
  return [];
}

function countBy(records, selector) {
  const counts = {};
  for (const record of records) {
    const key = clean(selector(record)) || "(unscoped)";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function passportSources(passport) {
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

function passportIdFromObject(object) {
  const direct = clean(
    object?.passportId ||
    object?.ixiPassportId ||
    object?.passportIdentity?.passportId ||
    object?.passport?.passportId
  );
  if (direct) return direct;
  const identity = (Array.isArray(object?.identities) ? object.identities : [])
    .find(item => ["ixi-passport", "passport"].includes(clean(
      item?.identityType || item?.type || item?.kind
    ).toLowerCase()));
  return clean(identity?.passportId || identity?.value || identity?.id);
}

function addFinding(findings, severity, code, details = {}) {
  findings.push({ severity, code, ...details });
}

function readCollections(databasePath, findings) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const integrityRows = database.pragma("quick_check");
    const integrity = integrityRows.map(row => Object.values(row)[0]);
    if (integrity.length !== 1 || integrity[0] !== "ok") {
      addFinding(findings, "critical", "SQLITE_INTEGRITY_FAILED", { results: integrity });
    }

    const rows = database.prepare(`
      SELECT collection_key, payload, payload_sha256, version, created_at, updated_at
      FROM mos_collections
      ORDER BY collection_key
    `).all();

    const collections = {};
    const inventory = [];
    for (const row of rows) {
      const actualChecksum = sha256(row.payload);
      const checksumValid = actualChecksum === row.payload_sha256;
      if (!checksumValid) {
        addFinding(findings, "critical", "COLLECTION_CHECKSUM_MISMATCH", {
          collectionKey: row.collection_key,
          expectedChecksum: row.payload_sha256,
          actualChecksum
        });
      }

      let payload = null;
      try {
        payload = JSON.parse(row.payload);
      } catch (error) {
        addFinding(findings, "critical", "COLLECTION_JSON_INVALID", {
          collectionKey: row.collection_key,
          message: error.message
        });
      }

      collections[row.collection_key] = payload;
      inventory.push({
        collectionKey: row.collection_key,
        version: Number(row.version),
        recordCount: recordsFromPayload(payload).length,
        checksum: row.payload_sha256,
        checksumValid,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      });
    }

    const historyVersions = Number(database.prepare(
      "SELECT COUNT(*) AS count FROM mos_collection_history"
    ).get()?.count || 0);
    const migrations = Number(database.prepare(
      "SELECT COUNT(*) AS count FROM mos_migrations"
    ).get()?.count || 0);

    return { collections, inventory, integrity, historyVersions, migrations };
  } finally {
    database.close();
  }
}

function readPassports(passportPath) {
  const raw = fs.readFileSync(passportPath, "utf8");
  const passports = JSON.parse(raw);
  if (!Array.isArray(passports)) {
    const error = new Error("Passport registry must contain a JSON array.");
    error.code = "PASSPORT_REGISTRY_INVALID_SHAPE";
    throw error;
  }
  return { passports, checksum: sha256(raw), bytes: Buffer.byteLength(raw) };
}

function buildTenantCensus({ databasePath, passportPath, protectedEntityId = "", dataRoot = "" }) {
  const generatedAt = new Date().toISOString();
  const findings = [];
  const database = readCollections(databasePath, findings);
  const passportStore = readPassports(passportPath);
  const entities = recordsFromPayload(database.collections["entities.json"]);
  const objects = recordsFromPayload(database.collections["objects.json"]);
  const relationships = recordsFromPayload(database.collections["relationships.json"]);
  const accounts = recordsFromPayload(database.collections["accounts.json"]);
  const memberships = recordsFromPayload(database.collections["memberships.json"]);

  const entityById = new Map(entities.map(entity => [clean(entity?.entityId), entity]));
  const objectById = new Map(objects.map(object => [clean(object?.objectId), object]));
  const passportById = new Map();
  const passportOwners = new Map();
  const sourceOwners = new Map();

  for (const passport of passportStore.passports) {
    const passportId = clean(passport?.passportId);
    if (!passportId) {
      addFinding(findings, "critical", "PASSPORT_ID_MISSING");
      continue;
    }
    if (passportById.has(passportId)) {
      addFinding(findings, "critical", "DUPLICATE_PASSPORT_ID", { passportId });
    }
    passportById.set(passportId, passport);

    for (const source of passportSources(passport)) {
      const key = `${source.sourceType}|${source.sourceId}`;
      const owners = sourceOwners.get(key) || [];
      owners.push(passportId);
      sourceOwners.set(key, owners);
    }
  }

  for (const [source, owners] of sourceOwners) {
    if (new Set(owners).size > 1) {
      addFinding(findings, "critical", "PASSPORT_SOURCE_CONFLICT", {
        source,
        passportIds: [...new Set(owners)].sort()
      });
    }
  }

  for (const object of objects) {
    const objectId = clean(object?.objectId);
    const entityId = clean(object?.entityId);
    const passportId = passportIdFromObject(object);
    const isActive = clean(object?.status) === "active";
    const isNewContract = clean(object?.metadata?.provisioning?.contractVersion) ===
      "ixi-aos-object-provision-v1";

    if (!entityId) {
      addFinding(findings, isActive ? "critical" : "warning", "OBJECT_ENTITY_ID_MISSING", { objectId });
    } else if (!entityById.has(entityId)) {
      addFinding(findings, "critical", "OBJECT_ENTITY_NOT_FOUND", { objectId, entityId });
    }

    if (!passportId) {
      addFinding(findings, isActive && isNewContract ? "critical" : "warning", "OBJECT_PASSPORT_MISSING", {
        objectId,
        entityId: entityId || null,
        status: clean(object?.status) || null,
        contractVersion: clean(object?.metadata?.provisioning?.contractVersion) || null
      });
    } else {
      const owners = passportOwners.get(passportId) || [];
      owners.push(objectId);
      passportOwners.set(passportId, owners);
      const passport = passportById.get(passportId);
      if (!passport) {
        addFinding(findings, isActive ? "critical" : "warning", "OBJECT_PASSPORT_NOT_FOUND", {
          objectId, entityId: entityId || null, passportId
        });
      } else if (clean(passport.entityId) && entityId && clean(passport.entityId) !== entityId) {
        addFinding(findings, "critical", "OBJECT_PASSPORT_ENTITY_MISMATCH", {
          objectId, passportId, objectEntityId: entityId, passportEntityId: clean(passport.entityId)
        });
      }
    }

    const directContainerId = clean(object?.directContainerId);
    if (directContainerId) {
      const container = objectById.get(directContainerId);
      if (!container) {
        addFinding(findings, "critical", "DIRECT_CONTAINER_NOT_FOUND", { objectId, directContainerId });
      } else if (clean(container.entityId) !== entityId) {
        addFinding(findings, "critical", "CROSS_ENTITY_DIRECT_CONTAINMENT", {
          objectId, directContainerId, objectEntityId: entityId, containerEntityId: clean(container.entityId)
        });
      }
    }
  }

  for (const [passportId, owners] of passportOwners) {
    if (new Set(owners).size > 1) {
      addFinding(findings, "critical", "PASSPORT_LINKED_TO_MULTIPLE_OBJECTS", {
        passportId, objectIds: [...new Set(owners)].sort()
      });
    }
  }

  for (const passport of passportStore.passports) {
    const passportId = clean(passport?.passportId);
    for (const source of passportSources(passport).filter(item =>
      ["aos-object", "mos-person", "mos-machine", "mos-entity"].includes(item.sourceType)
    )) {
      const sourceIsEntity = source.sourceType === "mos-entity";
      const targetExists = sourceIsEntity ? entityById.has(source.sourceId) : objectById.has(source.sourceId);
      if (!targetExists) {
        addFinding(findings, "warning", "PASSPORT_SOURCE_TARGET_NOT_FOUND", {
          passportId, sourceType: source.sourceType, sourceId: source.sourceId
        });
      }
    }
  }

  for (const relationship of relationships) {
    const relationshipId = clean(relationship?.relationshipId);
    const source = objectById.get(clean(relationship?.sourceObjectId));
    const target = objectById.get(clean(relationship?.targetObjectId));
    if (!source || !target) {
      addFinding(findings, "critical", "RELATIONSHIP_OBJECT_NOT_FOUND", {
        relationshipId,
        missingSource: !source,
        missingTarget: !target
      });
      continue;
    }
    const relationshipEntityId = clean(relationship?.entityId);
    if (clean(source.entityId) !== clean(target.entityId) || relationshipEntityId !== clean(source.entityId)) {
      addFinding(findings, "critical", "CROSS_ENTITY_RELATIONSHIP", {
        relationshipId,
        relationshipEntityId,
        sourceEntityId: clean(source.entityId),
        targetEntityId: clean(target.entityId)
      });
    }
  }

  for (const collection of database.inventory) {
    const records = recordsFromPayload(database.collections[collection.collectionKey]);
    collection.byEntity = countBy(records, record => record?.entityId || record?.metadata?.entityId);
  }

  const entityCensus = entities.map(entity => {
    const entityId = clean(entity?.entityId);
    const scopedObjects = objects.filter(object => clean(object?.entityId) === entityId);
    const scopedPassports = passportStore.passports.filter(passport => clean(passport?.entityId) === entityId);
    return {
      entityId,
      displayName: clean(entity?.displayName) || null,
      status: clean(entity?.status) || null,
      objectCount: scopedObjects.length,
      activeObjectCount: scopedObjects.filter(object => clean(object?.status) === "active").length,
      passportCount: scopedPassports.length,
      accountCount: accounts.filter(account => clean(account?.primaryEntityId) === entityId).length,
      membershipCount: memberships.filter(membership => clean(membership?.entityId) === entityId).length,
      classification: entityId === clean(protectedEntityId) ? "KEEP_PROTECTED" : "REVIEW"
    };
  }).sort((a, b) => a.entityId.localeCompare(b.entityId));

  if (clean(protectedEntityId) && !entityById.has(clean(protectedEntityId))) {
    addFinding(findings, "critical", "PROTECTED_ENTITY_NOT_FOUND", {
      protectedEntityId: clean(protectedEntityId)
    });
  }

  const legacyJsonFiles = [];
  if (dataRoot && fs.existsSync(dataRoot)) {
    for (const entry of fs.readdirSync(dataRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const filePath = path.join(dataRoot, entry.name);
      const raw = fs.readFileSync(filePath);
      legacyJsonFiles.push({
        filename: entry.name,
        bytes: raw.length,
        checksum: sha256(raw),
        classification: "LEGACY_INACTIVE_WHILE_SQLITE_PROVIDER_IS_ACTIVE"
      });
    }
  }

  const severityOrder = { critical: 0, warning: 1, info: 2 };
  findings.sort((a, b) =>
    (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) ||
    a.code.localeCompare(b.code)
  );

  return {
    auditVersion: "ixi-tenant-census-v1",
    generatedAt,
    readOnly: true,
    protectedEntityId: clean(protectedEntityId) || null,
    storage: {
      databasePath: path.resolve(databasePath),
      passportPath: path.resolve(passportPath),
      sqliteIntegrity: database.integrity,
      collectionCount: database.inventory.length,
      historyVersions: database.historyVersions,
      migrations: database.migrations,
      passportBytes: passportStore.bytes,
      passportChecksum: passportStore.checksum
    },
    totals: {
      entities: entities.length,
      objects: objects.length,
      activeObjects: objects.filter(object => clean(object?.status) === "active").length,
      relationships: relationships.length,
      accounts: accounts.length,
      memberships: memberships.length,
      passports: passportStore.passports.length,
      passportsWithoutEntityId: passportStore.passports.filter(passport => !clean(passport?.entityId)).length,
      legacyJsonFiles: legacyJsonFiles.length,
      criticalFindings: findings.filter(finding => finding.severity === "critical").length,
      warningFindings: findings.filter(finding => finding.severity === "warning").length
    },
    entities: entityCensus,
    passports: {
      byEntity: countBy(passportStore.passports, passport => passport?.entityId),
      bySourceType: countBy(passportStore.passports, passport => passport?.sourceType)
    },
    collections: database.inventory,
    legacyJsonFiles,
    findings
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--database") options.databasePath = argv[++index];
    else if (argument === "--passports") options.passportPath = argv[++index];
    else if (argument === "--protected-entity") options.protectedEntityId = argv[++index];
    else if (argument === "--data-root") options.dataRoot = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.databasePath) throw new Error("--database is required");
  if (!options.passportPath) throw new Error("--passports is required");
  return options;
}

if (require.main === module) {
  try {
    const report = buildTenantCensus(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.totals.criticalFindings ? 2 : 0;
  } catch (error) {
    process.stderr.write(`${error.code || "TENANT_CENSUS_FAILED"}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildTenantCensus, parseArguments, passportIdFromObject, passportSources };
