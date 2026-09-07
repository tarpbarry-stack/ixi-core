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
const PASSPORT_LOCK_TIMEOUT_MS = 5000;
const PASSPORT_STALE_LOCK_MS = 30000;

function getPassportDataFile() {
  return process.env.IXI_PASSPORT_DATA_FILE || DEFAULT_PASSPORT_DATA_FILE;
}

function nowIso() {
  return new Date().toISOString();
}

function registryError(code, message, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.status = 500;
  return error;
}

function readPassportRecords() {
  const passportDataFile = getPassportDataFile();
  if (!fs.existsSync(passportDataFile)) {
    return [];
  }

  let raw;
  try {
    raw = fs.readFileSync(passportDataFile, "utf8");
  } catch (error) {
    throw registryError(
      "PASSPORT_REGISTRY_READ_FAILED",
      `IXI Passport registry could not be read: ${passportDataFile}`,
      error
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw registryError(
      "PASSPORT_REGISTRY_INVALID_JSON",
      `IXI Passport registry contains invalid JSON: ${passportDataFile}`,
      error
    );
  }

  if (!Array.isArray(parsed)) {
    throw registryError(
      "PASSPORT_REGISTRY_INVALID_SHAPE",
      `IXI Passport registry must contain a JSON array: ${passportDataFile}`
    );
  }

  return parsed;
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

function sleepSync(milliseconds) {
  const wait = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(wait, 0, 0, milliseconds);
}

function acquirePassportRegistryLock() {
  const passportDataFile = getPassportDataFile();
  fs.mkdirSync(path.dirname(passportDataFile), { recursive: true });
  const lockFile = `${passportDataFile}.lock`;
  const deadline = Date.now() + PASSPORT_LOCK_TIMEOUT_MS;

  while (true) {
    try {
      const descriptor = fs.openSync(lockFile, "wx", 0o600);
      fs.writeFileSync(
        descriptor,
        JSON.stringify({ pid: process.pid, acquiredAt: nowIso() }),
        "utf8"
      );
      return { descriptor, lockFile };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw registryError(
          "PASSPORT_REGISTRY_LOCK_FAILED",
          `IXI Passport registry lock could not be acquired: ${lockFile}`,
          error
        );
      }

      try {
        const age = Date.now() - fs.statSync(lockFile).mtimeMs;
        if (age > PASSPORT_STALE_LOCK_MS) {
          fs.unlinkSync(lockFile);
          continue;
        }
      } catch (statError) {
        if (statError?.code === "ENOENT") continue;
        throw registryError(
          "PASSPORT_REGISTRY_LOCK_FAILED",
          `IXI Passport registry lock could not be inspected: ${lockFile}`,
          statError
        );
      }

      if (Date.now() >= deadline) {
        throw registryError(
          "PASSPORT_REGISTRY_LOCK_TIMEOUT",
          `IXI Passport registry remained locked: ${lockFile}`
        );
      }

      sleepSync(25);
    }
  }
}

function releasePassportRegistryLock(lock) {
  try {
    fs.closeSync(lock.descriptor);
  } finally {
    try {
      fs.unlinkSync(lock.lockFile);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function withPassportRegistryLock(operation) {
  const lock = acquirePassportRegistryLock();
  try {
    return operation();
  } finally {
    releasePassportRegistryLock(lock);
  }
}

function writePassportRecordsUnlocked(records = []) {
  if (!Array.isArray(records)) {
    throw registryError(
      "PASSPORT_REGISTRY_INVALID_WRITE",
      "IXI Passport registry writes require an array."
    );
  }

  const passportDataFile = getPassportDataFile();
  fs.mkdirSync(path.dirname(passportDataFile), { recursive: true });
  const temporaryFile = `${passportDataFile}.${process.pid}.${Date.now()}.tmp`;
  let mode = 0o600;
  let ownership = null;

  try {
    const current = fs.statSync(passportDataFile);
    mode = current.mode & 0o777;
    ownership = { uid: current.uid, gid: current.gid };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  try {
    const descriptor = fs.openSync(temporaryFile, "wx", mode);
    try {
      fs.writeFileSync(descriptor, JSON.stringify(records, null, 2), "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }

    fs.chmodSync(temporaryFile, mode);
    if (ownership) {
      try {
        fs.chownSync(temporaryFile, ownership.uid, ownership.gid);
      } catch (error) {
        if (error?.code !== "EPERM") throw error;
      }
    }

    fs.renameSync(temporaryFile, passportDataFile);

    const directoryDescriptor = fs.openSync(path.dirname(passportDataFile), "r");
    try {
      fs.fsyncSync(directoryDescriptor);
    } finally {
      fs.closeSync(directoryDescriptor);
    }
  } catch (error) {
    try {
      fs.unlinkSync(temporaryFile);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") error.cleanupError = cleanupError;
    }
    throw error;
  }
}

function writePassportRecords(records = []) {
  return withPassportRegistryLock(() =>
    writePassportRecordsUnlocked(records)
  );
}

function mutatePassportRecords(mutator) {
  return withPassportRegistryLock(() => {
    const records = readPassportRecords();
    const mutation = mutator(records);
    writePassportRecordsUnlocked(mutation.records);
    return mutation.result;
  });
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

  return mutatePassportRecords(records => {
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
    return { records, result: updated };
  });
}

function passportIdExists(passportId = "") {
  return !!findPassportById(passportId);
}

function deletePassportById(passportId = "") {
  const normalized = normalizePassportId(passportId);
  return mutatePassportRecords(records => {

    const deleted =
      records.find(
        record =>
          record.passportId === normalized
      ) || null;

    if (!deleted) {
      return {
        records,
        result: {
          ok: true,
          deleted: false,
          alreadyDeleted: true,
          passport: null
        }
      };
    }

    const remaining =
      records.filter(
        record =>
          record.passportId !== normalized
      );

    return {
      records: remaining,
      result: {
        ok: true,
        deleted: true,
        alreadyDeleted: false,
        passport: deleted
      }
    };
  });
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

  return mutatePassportRecords(records => {

    const deleted =
      records.find(
        record => passportSources(record).some(source =>
          source.sourceType === normalizedSourceType &&
          source.sourceId === normalizedSourceId
        )
      ) || null;

    if (!deleted) {
      return {
        records,
        result: {
          ok: true,
          deleted: false,
          alreadyDeleted: true,
          passport: null,
          sourceType: normalizedSourceType,
          sourceId: normalizedSourceId
        }
      };
    }

    const remaining =
      records.filter(
        record => !passportSources(record).some(source =>
          source.sourceType === normalizedSourceType &&
          source.sourceId === normalizedSourceId
        )
      );

    return {
      records: remaining,
      result: {
        ok: true,
        deleted: true,
        alreadyDeleted: false,
        passport: deleted,
        sourceType: normalizedSourceType,
        sourceId: normalizedSourceId
      }
    };
  });
}

function unbindPassportSource(
  sourceType = "",
  sourceId = ""
) {
  const normalizedSourceType = String(sourceType || "").trim();
  const normalizedSourceId = String(sourceId || "").trim();

  if (!normalizedSourceType) throw new Error("Passport sourceType is required");
  if (!normalizedSourceId) throw new Error("Passport sourceId is required");

  return mutatePassportRecords(records => {
    const index = records.findIndex(record => passportSources(record).some(source =>
      source.sourceType === normalizedSourceType &&
      source.sourceId === normalizedSourceId
    ));

    if (index < 0) {
      return {
        records,
        result: {
          ok: true,
          changed: false,
          alreadyUnbound: true,
          passport: null,
          sourceType: normalizedSourceType,
          sourceId: normalizedSourceId
        }
      };
    }

    const current = records[index];
    const remainingSources = passportSources(current).filter(source => !(
      source.sourceType === normalizedSourceType &&
      source.sourceId === normalizedSourceId
    ));

    if (!remainingSources.length) {
      const error = new Error(
        "The final source cannot be unbound from a Passport; delete the Passport explicitly instead."
      );
      error.code = "PASSPORT_FINAL_SOURCE_UNBIND_FORBIDDEN";
      error.details = { passportId: current.passportId };
      throw error;
    }

    const primaryStillPresent = remainingSources.some(source =>
      source.sourceType === String(current.sourceType || "").trim() &&
      source.sourceId === String(current.sourceId || "").trim()
    );
    const primary = primaryStillPresent
      ? {
          sourceType: String(current.sourceType || "").trim(),
          sourceId: String(current.sourceId || "").trim()
        }
      : remainingSources[0];

    const updated = {
      ...current,
      sourceType: primary.sourceType,
      sourceId: primary.sourceId,
      sources: remainingSources,
      updatedAt: nowIso()
    };

    records[index] = updated;
    return {
      records,
      result: {
        ok: true,
        changed: true,
        alreadyUnbound: false,
        passport: updated,
        sourceType: normalizedSourceType,
        sourceId: normalizedSourceId
      }
    };
  });
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

  return mutatePassportRecords(records => {
    const existing = records.find(record => passportSources(record).some(source =>
      source.sourceType === sourceType && source.sourceId === sourceId
    ));

    if (existing && isValidPassportId(existing.passportId)) {
      return { records, result: existing };
    }

    let passportId = "";
    for (let attempts = 0; attempts < 25; attempts += 1) {
      const candidate = generatePassportId();
      if (!records.some(record => record.passportId === candidate)) {
        passportId = candidate;
        break;
      }
    }

    if (!passportId) {
      throw new Error("Unable to generate unique Passport ID after 25 attempts");
    }

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

    records.push(record);
    return { records, result: record };
  });
}

function ensurePassportForSource(input = {}) {
  const sourceType = String(input.sourceType || "").trim();
  const sourceId = String(input.sourceId || "").trim();

  if (!sourceType) throw new Error("Passport sourceType is required");
  if (!sourceId) throw new Error("Passport sourceId is required");

  return mutatePassportRecords(records => {
    const existing = records.find(record => passportSources(record).some(source =>
      source.sourceType === sourceType && source.sourceId === sourceId
    ));

    if (existing && isValidPassportId(existing.passportId)) {
      return {
        records,
        result: { ok: true, created: false, passport: existing }
      };
    }

    let passportId = "";
    for (let attempts = 0; attempts < 25; attempts += 1) {
      const candidate = generatePassportId();
      if (!records.some(record => record.passportId === candidate)) {
        passportId = candidate;
        break;
      }
    }
    if (!passportId) {
      throw new Error("Unable to generate unique Passport ID after 25 attempts");
    }

    const timestamp = nowIso();
    const passport = {
      passportId,
      passportUrl: getPassportUrl(passportId),
      sourceType,
      sourceId,
      entityId: clean(input.entityId) || null,
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

    records.push(passport);
    return {
      records,
      result: { ok: true, created: true, passport }
    };
  });
}

function reassignPassportId({
  currentPassportId = "",
  requestedPassportId = "",
  expectedEntityId = ""
} = {}) {
  const currentId = normalizePassportId(currentPassportId);
  const requestedId = normalizePassportId(requestedPassportId);
  const entityId = clean(expectedEntityId);

  if (!isValidPassportId(currentId) || !isValidPassportId(requestedId)) {
    const error = new Error("Both the current and requested IXI Passport IDs must be valid.");
    error.code = "PASSPORT_REASSIGN_ID_INVALID";
    error.status = 400;
    throw error;
  }

  const records = readPassportRecords();
  const currentIndex = records.findIndex(record => record.passportId === currentId);
  if (currentIndex < 0) {
    const error = new Error("The current IXI Passport was not found.");
    error.code = "PASSPORT_REASSIGN_SOURCE_NOT_FOUND";
    error.status = 404;
    throw error;
  }

  const collision = records.find(record =>
    record.passportId === requestedId && record.passportId !== currentId
  );
  if (collision) {
    const error = new Error("The requested IXI Passport is already assigned.");
    error.code = "PASSPORT_REASSIGN_TARGET_CONFLICT";
    error.status = 409;
    error.details = { requestedPassportId: requestedId };
    throw error;
  }

  const current = records[currentIndex];
  const currentEntityId = clean(current.entityId);
  if (entityId && currentEntityId && entityId !== currentEntityId) {
    const error = new Error("The IXI Passport belongs to a different Entity.");
    error.code = "PASSPORT_REASSIGN_ENTITY_MISMATCH";
    error.status = 403;
    throw error;
  }

  if (currentId === requestedId) {
    return { ok: true, changed: false, passport: current };
  }

  const updated = {
    ...current,
    passportId: requestedId,
    passportUrl: getPassportUrl(requestedId),
    previousPassportIds: [...new Set([
      ...(Array.isArray(current.previousPassportIds)
        ? current.previousPassportIds.map(normalizePassportId).filter(isValidPassportId)
        : []),
      currentId
    ])],
    updatedAt: nowIso()
  };

  records[currentIndex] = updated;
  writePassportRecords(records);
  return { ok: true, changed: true, passport: updated };
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
  unbindPassportSource,
  generateUniquePassportId,
  createPassportRecord,
  ensurePassportForSource,
  reassignPassportId
};
