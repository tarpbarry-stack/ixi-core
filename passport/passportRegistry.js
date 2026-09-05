// /passport/passportRegistry.js

const fs = require("fs");
const path = require("path");

const {
  generatePassportId,
  isValidPassportId,
  normalizePassportId,
  getPassportUrl
} = require("./passportSnEngine");

const DEFAULT_PASSPORT_DATA_FILE = path.join(__dirname, "passports.json");

function getPassportDataFile() {
  return process.env.IXI_PASSPORT_DATA_FILE || DEFAULT_PASSPORT_DATA_FILE;
}

function nowIso() {
  return new Date().toISOString();
}

function readPassportRecords() {
  const passportDataFile = getPassportDataFile();
  if (!fs.existsSync(passportDataFile)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(passportDataFile, "utf8");
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) return parsed;

    return [];
  } catch (error) {
    return [];
  }
}

function clean(value) {
  return String(value ?? "").trim();
}

function passportSources(record = {}) {
  const candidates = [
    {
      sourceType: clean(record.sourceType),
      sourceId: clean(record.sourceId)
    },
    ...(Array.isArray(record.sources) ? record.sources : [])
  ];

  const seen = new Set();

  return candidates
    .map(source => ({
      sourceType: clean(source?.sourceType),
      sourceId: clean(source?.sourceId)
    }))
    .filter(source => source.sourceType && source.sourceId)
    .filter(source => {
      const key = `${source.sourceType}|${source.sourceId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function writePassportRecords(records = []) {
  const passportDataFile = getPassportDataFile();
  fs.mkdirSync(path.dirname(passportDataFile), { recursive: true });
  const temporaryFile = `${passportDataFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(records, null, 2),
    "utf8"
  );
  fs.renameSync(temporaryFile, passportDataFile);
}

function findPassportById(passportId = "") {
  const normalized = normalizePassportId(passportId);
  const records = readPassportRecords();

  return records.find(record => record.passportId === normalized) || null;
}

function findPassportBySource(sourceType = "", sourceId = "") {
  const normalizedSourceType = clean(sourceType);
  const normalizedSourceId = clean(sourceId);
  const records = readPassportRecords();

  return (
    records.find(record => passportSources(record).some(source =>
      source.sourceType === normalizedSourceType &&
      source.sourceId === normalizedSourceId
    )) || null
  );
}

function bindPassportSource({
  passportId = "",
  sourceType = "",
  sourceId = "",
  entityId = ""
} = {}) {
  const normalizedPassportId = normalizePassportId(passportId);
  const normalizedSourceType = clean(sourceType);
  const normalizedSourceId = clean(sourceId);
  const normalizedEntityId = clean(entityId);

  if (!normalizedPassportId || !normalizedSourceType || !normalizedSourceId) {
    const error = new Error("Passport source binding requires Passport, source type, and source ID.");
    error.code = "PASSPORT_SOURCE_BINDING_REQUIRED";
    error.status = 400;
    throw error;
  }

  const records = readPassportRecords();
  const index = records.findIndex(record => record.passportId === normalizedPassportId);

  if (index < 0) {
    const error = new Error("IXI Passport was not found.");
    error.code = "PASSPORT_NOT_FOUND";
    error.status = 404;
    error.details = { passportId: normalizedPassportId };
    throw error;
  }

  const conflicting = records.find(record =>
    record.passportId !== normalizedPassportId &&
    passportSources(record).some(source =>
      source.sourceType === normalizedSourceType &&
      source.sourceId === normalizedSourceId
    )
  );

  if (conflicting) {
    const error = new Error("Passport source is already bound to another IXI Passport.");
    error.code = "PASSPORT_SOURCE_CONFLICT";
    error.status = 409;
    error.details = {
      passportId: normalizedPassportId,
      conflictingPassportId: conflicting.passportId,
      sourceType: normalizedSourceType,
      sourceId: normalizedSourceId
    };
    throw error;
  }

  const current = records[index];
  const currentEntityId = clean(current.entityId);

  if (currentEntityId && normalizedEntityId && currentEntityId !== normalizedEntityId) {
    const error = new Error("IXI Passport belongs to a different Entity.");
    error.code = "PASSPORT_ENTITY_MISMATCH";
    error.status = 403;
    error.details = {
      passportId: normalizedPassportId,
      expectedEntityId: normalizedEntityId,
      actualEntityId: currentEntityId
    };
    throw error;
  }

  const sources = passportSources(current);
  if (!sources.some(source =>
    source.sourceType === normalizedSourceType &&
    source.sourceId === normalizedSourceId
  )) {
    sources.push({
      sourceType: normalizedSourceType,
      sourceId: normalizedSourceId
    });
  }

  const updated = {
    ...current,
    entityId: currentEntityId || normalizedEntityId || null,
    sources,
    updatedAt: nowIso()
  };

  records[index] = updated;
  writePassportRecords(records);
  return updated;
}

function passportIdExists(passportId = "") {
  return !!findPassportById(passportId);
}

function deletePassportById(passportId = "") {
  const normalized = normalizePassportId(passportId);
  const records = readPassportRecords();

  const deleted =
    records.find(
      record =>
        record.passportId === normalized
    ) || null;

  if (!deleted) {
    return {
      ok: true,
      deleted: false,
      alreadyDeleted: true,
      passport: null
    };
  }

  const remaining =
    records.filter(
      record =>
        record.passportId !== normalized
    );

  writePassportRecords(remaining);

  return {
    ok: true,
    deleted: true,
    alreadyDeleted: false,
    passport: deleted
  };
}

function deletePassportBySource(
  sourceType = "",
  sourceId = ""
) {
  const normalizedSourceType =
    String(sourceType || "").trim();

  const normalizedSourceId =
    String(sourceId || "").trim();

  if (!normalizedSourceType) {
    throw new Error(
      "Passport sourceType is required"
    );
  }

  if (!normalizedSourceId) {
    throw new Error(
      "Passport sourceId is required"
    );
  }

  const records = readPassportRecords();

  const deleted =
    records.find(
      record =>
        String(record.sourceType) ===
          normalizedSourceType &&
        String(record.sourceId) ===
          normalizedSourceId
    ) || null;

  if (!deleted) {
    return {
      ok: true,
      deleted: false,
      alreadyDeleted: true,
      passport: null,
      sourceType:
        normalizedSourceType,
      sourceId:
        normalizedSourceId
    };
  }

  const remaining =
    records.filter(
      record =>
        !(
          String(record.sourceType) ===
            normalizedSourceType &&
          String(record.sourceId) ===
            normalizedSourceId
        )
    );

  writePassportRecords(remaining);

  return {
    ok: true,
    deleted: true,
    alreadyDeleted: false,
    passport: deleted,
    sourceType:
      normalizedSourceType,
    sourceId:
      normalizedSourceId
  };
}

function generateUniquePassportId() {
  let attempts = 0;

  while (attempts < 25) {
    const candidate = generatePassportId();

    if (!passportIdExists(candidate)) {
      return candidate;
    }

    attempts += 1;
  }

  throw new Error("Unable to generate unique Passport ID after 25 attempts");
}

function createPassportRecord(input = {}) {
  const sourceType = String(input.sourceType || "").trim();
  const sourceId = String(input.sourceId || "").trim();
  const entityId = String(input.entityId || "").trim();

  if (!sourceType) {
    throw new Error("Passport sourceType is required");
  }

  if (!sourceId) {
    throw new Error("Passport sourceId is required");
  }

  const existing = findPassportBySource(sourceType, sourceId);

  if (existing && isValidPassportId(existing.passportId)) {
    return existing;
  }

  const passportId = generateUniquePassportId();
  const timestamp = nowIso();

  const record = {
    passportId,
    passportUrl: getPassportUrl(passportId),

    sourceType,
    sourceId,

    /*
     * Tenant identity is persisted directly
     * on new Passport records when supplied
     * by a trusted creation boundary.
     *
     * Legacy Passport records remain valid
     * without this field and are not rewritten.
     */
    entityId:
      entityId || null,

    visibility: input.visibility || "private",
    status: input.status || "active",

    dealerName: input.dealerName || "",
    dealerLogoUrl: input.dealerLogoUrl || "",
    salesmanName: input.salesmanName || "",
    salesmanPhone: input.salesmanPhone || "",
    salesmanEmail: input.salesmanEmail || "",
    dealerAddress: input.dealerAddress || "",
    defaultShareMessage: input.defaultShareMessage || "",

    createdAt: timestamp,
    updatedAt: timestamp
  };

  const records = readPassportRecords();
  records.push(record);
  writePassportRecords(records);

  return record;
}

function ensurePassportForSource(input = {}) {
  const sourceType = String(input.sourceType || "").trim();
  const sourceId = String(input.sourceId || "").trim();

  const existing = findPassportBySource(sourceType, sourceId);

  if (existing && isValidPassportId(existing.passportId)) {
    return {
      ok: true,
      created: false,
      passport: existing
    };
  }

  const passport = createPassportRecord(input);

  return {
    ok: true,
    created: true,
    passport
  };
}

module.exports = {
  readPassportRecords,
  writePassportRecords,
  findPassportById,
  findPassportBySource,
  passportSources,
  bindPassportSource,
  passportIdExists,
  deletePassportById,
  deletePassportBySource,
  generateUniquePassportId,
  createPassportRecord,
  ensurePassportForSource
};
