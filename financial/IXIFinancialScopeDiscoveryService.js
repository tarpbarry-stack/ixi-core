"use strict";

/*
 * IXI FINANCIAL SCOPE DISCOVERY SERVICE
 *
 * PRODUCTION CONTRACT
 * -------------------
 *
 * Financial scope contains ONLY:
 *
 *   1. the authenticated Entity Passport; and
 *
 *   2. permanent AOS objects that satisfy the
 *      complete AOS provisioning invariant:
 *
 *      persisted ixi-passport identity
 *          +
 *      aos-object Passport registry identity
 *          +
 *      matching objectId / Passport ID
 *          +
 *      completed + verified provisioning
 *          +
 *      Authority aos.discover
 *
 *
 * This service does NOT:
 *
 * - create Passports
 * - migrate objects
 * - repair development records
 * - provide compatibility behavior
 * - infer production eligibility
 */


const {
  listObjects
} =
  require(
    "../mos/objects/objectService"
  );


const {
  getObjectPassportIdentity
} =
  require(
    "../mos/provisioning/aosObjectProvisioningService"
  );


const {
  findPassportBySource
} =
  require(
    "../passport/passportRegistry"
  );


const {
  filterDiscoverableObjects
} =
  require(
    "../authority/IXIAuthorityMosBridge"
  );


function clean(value) {
  return String(
    value ??
    ""
  ).trim();
}


function uniqueStrings(
  values = []
) {
  return Array.from(
    new Set(
      (
        Array.isArray(values)
          ? values
          : []
      )
        .map(clean)
        .filter(Boolean)
    )
  );
}


/* =========================================================
   PRODUCTION IDENTITY VALIDATION
   ========================================================= */

function resolveProductionObjectIdentity(
  object
) {
  if (
    !object ||
    typeof object !== "object"
  ) {
    return null;
  }


  const objectId =
    clean(
      object.objectId
    );


  if (!objectId) {
    return null;
  }


  /*
   * Person Passports are actor identities.
   *
   * They are not aos-object financial objects.
   */

  if (
    clean(
      object.objectType
    ).toLowerCase() ===
      "person"
  ) {
    return null;
  }


  const persistedIdentity =
    getObjectPassportIdentity(
      object
    );


  const persistedPassportId =
    clean(
      persistedIdentity
        ?.passportId
    );


  if (!persistedPassportId) {
    return null;
  }


  const registryPassport =
    findPassportBySource(
      "aos-object",
      objectId
    );


  const registryPassportId =
    clean(
      registryPassport
        ?.passportId
    );


  if (
    !registryPassportId ||
    registryPassportId !==
      persistedPassportId
  ) {
    return null;
  }


  if (
    clean(
      registryPassport
        ?.sourceType
    ) !==
      "aos-object" ||
    clean(
      registryPassport
        ?.sourceId
    ) !==
      objectId
  ) {
    return null;
  }


  const provisioning =
    object.metadata
      ?.provisioning;


  if (
    clean(
      provisioning
        ?.state
    ) !==
      "complete" ||
    provisioning
      ?.verified !==
      true ||
    provisioning
      ?.passportProvisioned !==
      true ||
    clean(
      provisioning
        ?.passportId
    ) !==
      persistedPassportId
  ) {
    return null;
  }


  return {
    objectId,

    passportId:
      persistedPassportId,

    displayName:
      clean(
        object.displayName
      ),

    objectType:
      clean(
        object.objectType
      ),

    directContainerId:
      clean(
        object.directContainerId
      )
  };
}


/* =========================================================
   AUTHENTICATED COMPANY FINANCIAL SCOPE
   ========================================================= */

async function discoverFinancialPassportScope({
  principal,
  aosEntityId,
  entityPassportId
} = {}) {
  const entityId =
    clean(
      aosEntityId
    );


  const entityPassport =
    clean(
      entityPassportId
    );


  if (!entityId) {
    throw new Error(
      "Financial scope discovery requires authenticated aosEntityId."
    );
  }


  if (!entityPassport) {
    throw new Error(
      "Financial scope discovery requires authenticated entityPassportId."
    );
  }


  const activeObjects =
    listObjects({
      entityId,

      status:
        "active"
    });


  /*
   * First establish permanent production
   * eligibility.
   */

  const productionObjects =
    activeObjects
      .map(object => ({
        object,

        identity:
          resolveProductionObjectIdentity(
            object
          )
      }))
      .filter(
        entry =>
          Boolean(
            entry.identity
          )
      );


  /*
   * Then apply Authority.
   *
   * Production identity does not imply that
   * the current principal may discover it.
   */

  const discoverableObjects =
    await filterDiscoverableObjects({
      principal,

      objects:
        productionObjects.map(
          entry =>
            entry.object
        )
    });


  const discoverableObjectIds =
    new Set(
      discoverableObjects.map(
        object =>
          clean(
            object.objectId
          )
      )
    );


  const objectScopes =
    productionObjects
      .filter(entry =>
        discoverableObjectIds.has(
          entry.identity.objectId
        )
      )
      .map(entry =>
        entry.identity
      );


  /*
   * Entity Passport is the company root.
   *
   * Authorized permanent object Passports
   * extend the Financial estate.
   */

  const scopePassportIds =
    uniqueStrings([
      entityPassport,

      ...objectScopes.map(
        item =>
          item.passportId
      )
    ]);


  return {
    schema:
      "ixi-financial-scope-discovery-v1",

    entityId,

    entityPassportId:
      entityPassport,

    rootPassportId:
      entityPassport,

    scopePassportIds,

    objectScopes,

    counts: {
      activeObjects:
        activeObjects.length,

      productionObjects:
        productionObjects.length,

      authorityDiscoverableObjects:
        objectScopes.length,

      financialPassportScope:
        scopePassportIds.length
    }
  };
}


module.exports = {
  resolveProductionObjectIdentity,
  discoverFinancialPassportScope
};
