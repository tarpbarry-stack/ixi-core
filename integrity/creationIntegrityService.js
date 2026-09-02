"use strict";

const crypto = require("crypto");

const CONTRACT_VERSION = "ixi-aos-creation-integrity-v1";
const clean = value => String(value ?? "").trim();
const array = value => Array.isArray(value) ? value : [];
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};

function stableHash(value) {
  const normalized = JSON.stringify(value, Object.keys(value || {}).sort());
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function getObjectId(record = {}) {
  return clean(record.objectId || record.id?.uuid || record.id);
}

function getPassportIdFromObject(record = {}) {
  const direct = clean(record.passportId || record.ixiPassportId || record.passport?.passportId);
  if (direct) return direct;
  const identity = array(record.identities).find(item => clean(item?.identityType || item?.type || item?.kind) === "ixi-passport");
  return clean(identity?.passportId || identity?.value || identity?.id);
}

function getPassportId(record = {}) {
  return clean(record.passportId || record.id);
}

function getPassportSourceObjectId(record = {}) {
  if (clean(record.sourceType) !== "aos-object") return "";
  return clean(record.sourceId);
}

function getProvisioningCommandId(record = {}) {
  return clean(
    record.commandId ||
    record.provisioningKey ||
    record.metadata?.provisioning?.commandId ||
    record.metadata?.commandId
  );
}

function getProvisioningSource(record = {}) {
  return clean(
    record.source ||
    record.metadata?.source ||
    record.metadata?.provisioning?.source ||
    "unknown"
  );
}

function toTimestamp(value) {
  const text = clean(value);

  if (!text) {
    return null;
  }

  const timestamp =
    Date.parse(text);

  return Number.isFinite(timestamp)
    ? timestamp
    : null;
}


function passportRequiresEntityId({
  passport,
  enforcementAt
}) {
  const enforcementTimestamp =
    toTimestamp(
      enforcementAt
    );

  if (
    enforcementTimestamp === null
  ) {
    return false;
  }

  const createdTimestamp =
    toTimestamp(
      passport?.createdAt
    );

  /*
   * Once tenant enforcement exists,
   * a new Passport without a usable
   * creation timestamp cannot silently
   * escape the invariant.
   */
  if (
    createdTimestamp === null
  ) {
    return true;
  }

  return (
    createdTimestamp >=
      enforcementTimestamp
  );
}


function createFinding(code, severity, details = {}) {
  return {
    code,
    severity,
    ...details
  };
}

function reconcileCreationIntegrity({
  entityId,
  objects = [],
  passports = [],
  provisioningRecords = [],

  passportEntityEnforcementAt =
    process.env
      .IXI_AOS_PASSPORT_ENTITY_ENFORCEMENT_AT ||
    ""
} = {}) {
  const resolvedEntityId =
    clean(entityId);

  const scopedObjects =
    array(objects).filter(
      item =>
        !resolvedEntityId ||
        clean(
          item?.entityId
        ) ===
          resolvedEntityId
    );

  const scopedObjectIds =
    new Set(
      scopedObjects
        .map(
          item =>
            getObjectId(item)
        )
        .filter(Boolean)
    );

  const scopedPassports =
    array(passports).filter(
      item => {
        if (!resolvedEntityId) {
          return true;
        }

        const passportEntity =
          clean(
            item?.entityId ||
            item?.metadata?.entityId
          );

        const sourceObjectId =
          getPassportSourceObjectId(
            item
          );

        /*
         * Canonical source ownership wins
         * for reconciliation visibility.
         *
         * A wrong Passport.entityId must
         * produce an explicit mismatch,
         * not disappear from the report.
         */
        if (
          sourceObjectId &&
          scopedObjectIds.has(
            sourceObjectId
          )
        ) {
          return true;
        }

        return (
          !passportEntity ||
          passportEntity ===
            resolvedEntityId
        );
      }
    );
  const scopedProvisioning = array(provisioningRecords).filter(item => {
    const recordEntityId = clean(item?.entityId || item?.metadata?.entityId);
    return !resolvedEntityId || !recordEntityId || recordEntityId === resolvedEntityId;
  });

  const findings = [];
  const objectById = new Map();
  const passportById = new Map();
  const passportsBySourceObject = new Map();
  const objectsByPassport = new Map();
  const provisioningByCommand = new Map();

  for (const item of scopedObjects) {
    const objectId = getObjectId(item);
    if (!objectId) {
      findings.push(createFinding("OBJECT_ID_MISSING", "critical", { record: item }));
      continue;
    }
    if (objectById.has(objectId)) {
      findings.push(createFinding("DUPLICATE_OBJECT_ID", "critical", { objectId }));
    }
    objectById.set(objectId, item);

    const passportId = getPassportIdFromObject(item);
    if (!passportId) {
      findings.push(createFinding("OBJECT_PASSPORT_MISSING", "critical", { objectId }));
      continue;
    }
    const owners = objectsByPassport.get(passportId) || [];
    owners.push(objectId);
    objectsByPassport.set(passportId, owners);
  }

  for (const item of scopedPassports) {
    const passportId = getPassportId(item);
    if (!passportId) {
      findings.push(createFinding("PASSPORT_ID_MISSING", "critical", { record: item }));
      continue;
    }
    if (passportById.has(passportId)) {
      findings.push(createFinding("DUPLICATE_PASSPORT_ID", "critical", { passportId }));
    }
    passportById.set(passportId, item);

    const sourceObjectId =
      getPassportSourceObjectId(
        item
      );

    const passportEntityId =
      clean(
        item?.entityId ||
        item?.metadata?.entityId
      );

    const linkedObject =
      sourceObjectId
        ? objectById.get(
            sourceObjectId
          )
        : null;

    const expectedEntityId =
      clean(
        linkedObject?.entityId
      ) ||
      resolvedEntityId;

    if (
      passportEntityId &&
      expectedEntityId &&
      passportEntityId !==
        expectedEntityId
    ) {
      findings.push(
        createFinding(
          "PASSPORT_ENTITY_ID_MISMATCH",
          "critical",
          {
            passportId,

            sourceObjectId:
              sourceObjectId ||
              null,

            expectedEntityId,

            actualEntityId:
              passportEntityId
          }
        )
      );
    }

    if (
      !passportEntityId &&
      passportRequiresEntityId({
        passport:
          item,

        enforcementAt:
          passportEntityEnforcementAt
      })
    ) {
      findings.push(
        createFinding(
          "PASSPORT_ENTITY_ID_MISSING",
          "critical",
          {
            passportId,

            sourceObjectId:
              sourceObjectId ||
              null,

            expectedEntityId:
              expectedEntityId ||
              null,

            createdAt:
              clean(
                item?.createdAt
              ) ||
              null,

            enforcementAt:
              clean(
                passportEntityEnforcementAt
              ) ||
              null
          }
        )
      );
    }

    if (sourceObjectId) {
      const linked = passportsBySourceObject.get(sourceObjectId) || [];
      linked.push(passportId);
      passportsBySourceObject.set(sourceObjectId, linked);
    }
  }

  for (const [passportId, owners] of objectsByPassport.entries()) {
    if (owners.length > 1) {
      findings.push(createFinding("PASSPORT_LINKED_TO_MULTIPLE_OBJECTS", "critical", { passportId, objectIds: owners }));
    }
  }

  for (const [objectId, passportIds] of passportsBySourceObject.entries()) {
    if (passportIds.length > 1) {
      findings.push(createFinding("OBJECT_HAS_MULTIPLE_SOURCE_PASSPORTS", "critical", { objectId, passportIds }));
    }
  }

  for (const item of scopedObjects) {
    const objectId = getObjectId(item);
    if (!objectId) continue;
    const passportId = getPassportIdFromObject(item);
    if (!passportId) continue;
    const passport = passportById.get(passportId);
    if (!passport) {
      findings.push(createFinding("OBJECT_PASSPORT_RECORD_MISSING", "critical", { objectId, passportId }));
      continue;
    }
    const sourceObjectId = getPassportSourceObjectId(passport);
    if (sourceObjectId && sourceObjectId !== objectId) {
      findings.push(createFinding("OBJECT_PASSPORT_SOURCE_MISMATCH", "critical", { objectId, passportId, passportSourceObjectId: sourceObjectId }));
    }
  }

  for (const item of scopedPassports) {
    const passportId = getPassportId(item);
    const sourceObjectId = getPassportSourceObjectId(item);
    if (!passportId || !sourceObjectId) continue;
    const linkedObject = objectById.get(sourceObjectId);
    if (!linkedObject) {
      findings.push(createFinding("ORPHAN_AOS_PASSPORT", "critical", { passportId, sourceObjectId }));
      continue;
    }
    const objectPassportId = getPassportIdFromObject(linkedObject);
    if (objectPassportId !== passportId) {
      findings.push(createFinding("PASSPORT_OBJECT_LINK_MISMATCH", "critical", { passportId, sourceObjectId, objectPassportId }));
    }
  }

  for (const item of scopedProvisioning) {
    const commandId = getProvisioningCommandId(item);
    if (!commandId) {
      findings.push(createFinding("PROVISIONING_COMMAND_ID_MISSING", "high", { recordId: clean(item?.recordId || item?.id), source: getProvisioningSource(item) }));
      continue;
    }
    const signature = stableHash({
      objectId: clean(item?.objectId || item?.result?.objectId || item?.object?.objectId),
      passportId: clean(item?.passportId || item?.result?.passportId || item?.passport?.passportId),
      source: getProvisioningSource(item)
    });
    const existing = provisioningByCommand.get(commandId);
    if (existing && existing.signature !== signature) {
      findings.push(createFinding("PROVISIONING_COMMAND_CONFLICT", "critical", {
        commandId,
        first: existing,
        second: { signature, source: getProvisioningSource(item) }
      }));
    } else if (!existing) {
      provisioningByCommand.set(commandId, { signature, source: getProvisioningSource(item) });
    }
  }

  const severityCounts = findings.reduce((acc, item) => {
    acc[item.severity] = Number(acc[item.severity] || 0) + 1;
    return acc;
  }, {});

  const criticalCount = Number(severityCounts.critical || 0);
  const highCount = Number(severityCounts.high || 0);

  return {
    contractVersion: CONTRACT_VERSION,
    entityId: resolvedEntityId || null,
    generatedAt: new Date().toISOString(),
    status: criticalCount > 0 ? "failed" : highCount > 0 ? "attention" : "healthy",
    summary: {
      objectsChecked: scopedObjects.length,
      passportsChecked: scopedPassports.length,
      provisioningRecordsChecked: scopedProvisioning.length,
      findings: findings.length,
      severityCounts
    },
    findings
  };
}

function assertCreationIntegrity(input = {}) {
  const report = reconcileCreationIntegrity(input);
  if (report.status === "failed") {
    const error = new Error("AOS creation integrity reconciliation failed.");
    error.code = "AOS_CREATION_INTEGRITY_FAILED";
    error.status = 409;
    error.report = report;
    throw error;
  }
  return report;
}

module.exports = {
  CONTRACT_VERSION,
  getObjectId,
  getPassportIdFromObject,
  getPassportId,
  getPassportSourceObjectId,
  getProvisioningCommandId,
  reconcileCreationIntegrity,
  assertCreationIntegrity
};