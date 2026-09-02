"use strict";

/*
 * IXI AOS LIVE CREATION INTEGRITY ADAPTER
 *
 * Read-only canonical operational adapter.
 *
 * No customer business vocabulary is used
 * to establish scope, ownership or meaning.
 */

const {
  listObjects
} = require(
  "../objects/objectService"
);

const {
  readPassportRecords
} = require(
  "../../passport/passportRegistry"
);

const {
  MOS_PATHS
} = require(
  "../storage/mosPaths"
);

const {
  readJsonFile
} = require(
  "../storage/jsonStore"
);


const PROVISIONING_CONTRACT =
  "ixi-aos-object-provision-v1";

const PROVISIONING_COMMAND_TYPE =
  "aos-object-provision";


function clean(value) {
  return String(
    value ?? ""
  ).trim();
}


function safeObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}


function readAllObjects() {
  return (
    listObjects({}) ||
    []
  );
}


function readIdempotencyRecords() {
  const store =
    readJsonFile(
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

  return Object.values(
    store
  );
}


function isNewContractObject(
  object
) {
  return (
    clean(
      object?.metadata
        ?.provisioning
        ?.contractVersion
    ) ===
      PROVISIONING_CONTRACT
  );
}


function loadObjects({
  entityId
}) {
  const normalizedEntityId =
    clean(entityId);

  if (!normalizedEntityId) {
    return [];
  }

  return readAllObjects()
    .filter(
      object =>
        clean(
          object?.entityId
        ) ===
          normalizedEntityId &&
        isNewContractObject(
          object
        )
    );
}


function loadPassports({
  entityId
}) {
  const normalizedEntityId =
    clean(entityId);

  if (!normalizedEntityId) {
    return [];
  }

  const objects =
    loadObjects({
      entityId:
        normalizedEntityId
    });

  const objectIds =
    new Set(
      objects
        .map(
          object =>
            clean(
              object.objectId
            )
        )
        .filter(Boolean)
    );

  return (
    readPassportRecords() ||
    []
  ).filter(
    passport => {
      if (
        clean(
          passport?.sourceType
        ) !==
          "aos-object"
      ) {
        return false;
      }

      const passportEntityId =
        clean(
          passport?.entityId
        );

      const sourceObjectId =
        clean(
          passport?.sourceId
        );

      /*
       * Two legitimate paths into scope:
       *
       * 1. New Passport explicitly belongs
       *    to the authenticated Entity.
       *
       * 2. Historical Passport has no
       *    entityId but its canonical source
       *    Object belongs to this Entity.
       *
       * A wrong entityId on an in-scope
       * source Object remains visible so
       * reconciliation reports the mismatch.
       */
      return (
        passportEntityId ===
          normalizedEntityId ||
        objectIds.has(
          sourceObjectId
        )
      );
    }
  );
}


function loadProvisioningRecords({
  entityId
}) {
  const normalizedEntityId =
    clean(entityId);

  if (!normalizedEntityId) {
    return [];
  }

  return readIdempotencyRecords()
    .filter(
      record =>
        clean(
          record?.entityId
        ) ===
          normalizedEntityId &&
        clean(
          record?.commandType
        ) ===
          PROVISIONING_COMMAND_TYPE
    );
}


function listIntegrityEntityIds() {
  const entityIds =
    new Set();

  /*
   * Permanent new-contract Objects.
   */
  for (
    const object of
      readAllObjects()
  ) {
    if (
      !isNewContractObject(
        object
      )
    ) {
      continue;
    }

    const entityId =
      clean(
        object?.entityId
      );

    if (entityId) {
      entityIds.add(
        entityId
      );
    }
  }

  /*
   * New tenant-aware AOS Passports.
   *
   * This keeps a tenant visible even if
   * its source Object later disappears.
   */
  for (
    const passport of
      readPassportRecords() ||
      []
  ) {
    if (
      clean(
        passport?.sourceType
      ) !==
        "aos-object"
    ) {
      continue;
    }

    const entityId =
      clean(
        passport?.entityId
      );

    if (entityId) {
      entityIds.add(
        entityId
      );
    }
  }

  /*
   * Provisioning provenance.
   *
   * This keeps a tenant visible even if
   * Object/Passport persistence is damaged.
   */
  for (
    const record of
      readIdempotencyRecords()
  ) {
    if (
      clean(
        record?.commandType
      ) !==
        PROVISIONING_COMMAND_TYPE
    ) {
      continue;
    }

    const entityId =
      clean(
        record?.entityId
      );

    if (entityId) {
      entityIds.add(
        entityId
      );
    }
  }

  return [
    ...entityIds
  ].sort();
}


function describeLiveCreationIntegrityScope({
  entityId
}) {
  return {
    entityId:
      clean(entityId),

    contractVersion:
      PROVISIONING_CONTRACT,

    objectCount:
      loadObjects({
        entityId
      }).length,

    passportCount:
      loadPassports({
        entityId
      }).length,

    provisioningRecordCount:
      loadProvisioningRecords({
        entityId
      }).length,

    legacyObjectsExcluded:
      true,

    readOnly:
      true
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
