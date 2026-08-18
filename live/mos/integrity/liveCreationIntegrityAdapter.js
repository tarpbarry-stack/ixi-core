"use strict";

/*
 * IXI AOS LIVE CREATION INTEGRITY ADAPTER
 *
 * This file is source-controlled at live/mos/integrity/
 * but is installed verbatim to:
 *   /var/www/ix-core/mos/integrity/liveCreationIntegrityAdapter.js
 *
 * Read-only canonical operational adapter.
 * No customer business vocabulary establishes
 * scope, ownership, or meaning.
 */

const {
  listObjects
} = require("../objects/objectService");

const {
  readPassportRecords
} = require("../../passport/passportRegistry");

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  readJsonFile
} = require("../storage/jsonStore");

const PROVISIONING_CONTRACT =
  "ixi-aos-object-provision-v1";

const PROVISIONING_COMMAND_TYPE =
  "aos-object-provision";

function clean(value) {
  return String(value ?? "").trim();
}

function readAllObjects() {
  return listObjects({}) || [];
}

function readIdempotencyRecords() {
  const store = readJsonFile(
    MOS_PATHS.idempotency,
    {}
  );

  if (
    !store ||
    typeof store !== "object" ||
    Array.isArray(store)
  ) {
    return [];
  }

  return Object.values(store);
}

function isNewContractObject(object) {
  return (
    String(
      object?.metadata?.provisioning?.contractVersion || ""
    ).trim() === PROVISIONING_CONTRACT
  );
}

function loadObjects({ entityId }) {
  const normalizedEntityId = clean(entityId);
  if (!normalizedEntityId) return [];

  return readAllObjects().filter(
    object =>
      clean(object?.entityId) === normalizedEntityId &&
      isNewContractObject(object)
  );
}

function loadPassports({ entityId }) {
  const normalizedEntityId = clean(entityId);
  if (!normalizedEntityId) return [];

  const objectIds = new Set(
    loadObjects({ entityId: normalizedEntityId })
      .map(object => clean(object.objectId))
      .filter(Boolean)
  );

  return (readPassportRecords() || []).filter(
    passport => {
      if (clean(passport?.sourceType) !== "aos-object") {
        return false;
      }

      const passportEntityId = clean(passport?.entityId);
      const sourceObjectId = clean(passport?.sourceId);

      /*
       * A Passport enters this tenant scope when:
       * - it directly persists this entityId, OR
       * - its canonical AOS source Object belongs to
       *   this Entity (legacy compatibility and
       *   explicit mismatch detection).
       */
      return (
        passportEntityId === normalizedEntityId ||
        objectIds.has(sourceObjectId)
      );
    }
  );
}

function loadProvisioningRecords({ entityId }) {
  const normalizedEntityId = clean(entityId);
  if (!normalizedEntityId) return [];

  return readIdempotencyRecords().filter(
    record =>
      clean(record?.entityId) === normalizedEntityId &&
      clean(record?.commandType) === PROVISIONING_COMMAND_TYPE
  );
}

function listIntegrityEntityIds() {
  const entityIds = new Set();

  for (const object of readAllObjects()) {
    if (!isNewContractObject(object)) continue;
    const entityId = clean(object?.entityId);
    if (entityId) entityIds.add(entityId);
  }

  for (const passport of readPassportRecords() || []) {
    if (clean(passport?.sourceType) !== "aos-object") continue;
    const entityId = clean(passport?.entityId);
    if (entityId) entityIds.add(entityId);
  }

  for (const record of readIdempotencyRecords()) {
    if (clean(record?.commandType) !== PROVISIONING_COMMAND_TYPE) {
      continue;
    }
    const entityId = clean(record?.entityId);
    if (entityId) entityIds.add(entityId);
  }

  return [...entityIds].sort();
}

function describeLiveCreationIntegrityScope({ entityId }) {
  return {
    entityId: clean(entityId),
    contractVersion: PROVISIONING_CONTRACT,
    objectCount: loadObjects({ entityId }).length,
    passportCount: loadPassports({ entityId }).length,
    provisioningRecordCount:
      loadProvisioningRecords({ entityId }).length,
    legacyObjectsExcluded: true,
    readOnly: true
  };
}

module.exports = {
  PROVISIONING_CONTRACT,
  isNewContractObject,
  loadObjects,
  loadPassports,
  loadProvisioningRecords,
  listIntegrityEntityIds,
  describeLiveCreationIntegrityScope
};
