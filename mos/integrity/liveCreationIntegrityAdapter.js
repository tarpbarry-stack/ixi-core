"use strict";

// Read canonical records, including retained tombstones. Reconciliation never
// creates identity or infers tenant ownership from customer vocabulary.
const { listObjects } = require("../objects/objectService");
const { readPassportRecords, passportSources } = require("../../passport/passportRegistry");
const { MOS_PATHS } = require("../storage/mosPaths");
const { readJsonFile } = require("../storage/jsonStore");
const { getPassportIdFromObject } = require("../../integrity/creationIntegrityService");
const PROVISIONING_CONTRACT = "ixi-aos-object-provision-v1";
const PROVISIONING_COMMAND_TYPE = "aos-object-provision";
const clean = value => String(value ?? "").trim();
const aosSources = passport => passportSources(passport).filter(source => source.sourceType === "aos-object");
const readAllObjects = () => listObjects({ status: null }) || [];
const isNewContractObject = object => clean(object?.metadata?.provisioning?.contractVersion) === PROVISIONING_CONTRACT;

function readIdempotencyRecords() {
  const store = readJsonFile(MOS_PATHS.idempotency, {});
  return store && typeof store === "object" && !Array.isArray(store) ? Object.values(store) : [];
}

function selectObjects(entityId, objects, passports) {
  const boundIds = new Set(passports.flatMap(aosSources).map(source => source.sourceId));
  return objects.filter(record => clean(record.entityId) === entityId &&
    (isNewContractObject(record) || boundIds.has(clean(record.objectId))));
}

function selectPassports(entityId, objects, passports) {
  const objectIds = new Set(objects.map(record => clean(record.objectId)));
  const referencedIds = new Set(objects.map(getPassportIdFromObject).filter(Boolean));
  return passports.filter(passport => {
    const sources = aosSources(passport);
    // Follow all canonical source bindings, including reused listing Passports.
    // Conflicting tenant/source evidence must enter the report, not disappear.
    return referencedIds.has(clean(passport.passportId)) ||
      sources.some(source => objectIds.has(source.sourceId)) ||
      (sources.length > 0 && clean(passport.entityId || passport.metadata?.entityId) === entityId);
  });
}

function loadObjects({ entityId }) {
  const id = clean(entityId);
  return id ? selectObjects(id, readAllObjects(), readPassportRecords()) : [];
}

function loadPassports({ entityId }) {
  const id = clean(entityId);
  if (!id) return [];
  const passports = readPassportRecords();
  return selectPassports(id, selectObjects(id, readAllObjects(), passports), passports);
}

function loadProvisioningRecords({ entityId }) {
  const id = clean(entityId);
  return id ? readIdempotencyRecords().filter(record => clean(record.entityId) === id &&
    clean(record.commandType) === PROVISIONING_COMMAND_TYPE) : [];
}

function listIntegrityEntityIds() {
  const passports = readPassportRecords();
  const boundIds = new Set(passports.flatMap(aosSources).map(source => source.sourceId));
  return [...new Set([
    ...readAllObjects().filter(record => isNewContractObject(record) || boundIds.has(clean(record.objectId)))
      .map(record => clean(record.entityId)),
    ...passports.filter(passport => aosSources(passport).length)
      .map(passport => clean(passport.entityId || passport.metadata?.entityId)),
    ...readIdempotencyRecords().filter(record => clean(record.commandType) === PROVISIONING_COMMAND_TYPE)
      .map(record => clean(record.entityId))
  ].filter(Boolean))].sort();
}

function describeLiveCreationIntegrityScope({ entityId }) {
  const objects = loadObjects({ entityId });
  return {
    entityId: clean(entityId), contractVersion: PROVISIONING_CONTRACT,
    objectCount: objects.length, passportCount: loadPassports({ entityId }).length,
    provisioningRecordCount: loadProvisioningRecords({ entityId }).length,
    legacyObjectsExcluded: false, unboundLegacyObjectsExcluded: true,
    retainedObjectsIncluded: true, readOnly: true
  };
}

module.exports = { PROVISIONING_CONTRACT, isNewContractObject, loadObjects, loadPassports,
  loadProvisioningRecords, listIntegrityEntityIds, describeLiveCreationIntegrityScope,
  selectObjects, selectPassports };
