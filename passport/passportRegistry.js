// /passport/passportRegistry.js

const fs = require("fs");
const path = require("path");

const {
  generatePassportId,
  isValidPassportId,
  normalizePassportId,
  getPassportUrl
} = require("./passportSnEngine");

const PASSPORT_DATA_FILE = path.join(__dirname, "passports.json");

function nowIso() {
  return new Date().toISOString();
}

function readPassportRecords() {
  if (!fs.existsSync(PASSPORT_DATA_FILE)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(PASSPORT_DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) return parsed;

    return [];
  } catch (error) {
    return [];
  }
}

function writePassportRecords(records = []) {
  fs.writeFileSync(
    PASSPORT_DATA_FILE,
    JSON.stringify(records, null, 2),
    "utf8"
  );
}

function findPassportById(passportId = "") {
  const normalized = normalizePassportId(passportId);
  const records = readPassportRecords();

  return records.find(record => record.passportId === normalized) || null;
}

function findPassportBySource(sourceType = "", sourceId = "") {
  const records = readPassportRecords();

  return (
    records.find(record =>
      record.sourceType === sourceType &&
      String(record.sourceId) === String(sourceId)
    ) || null
  );
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
  passportIdExists,
  deletePassportById,
  deletePassportBySource,
  generateUniquePassportId,
  createPassportRecord,
  ensurePassportForSource
};
