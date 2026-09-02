"use strict";

/*
 * IXI AUTHORITY — MOS SCOPE
 *
 * Server-side tenant/entity and activity-record
 * protection for MOS informational routes.
 */

const {
  getObject
} = require(
  "../mos/objects/objectService"
);

const {
  resolveAosEntityId
} = require(
  "../identity/IXIEntityBindingService"
);

const {
  evaluateMosObjectAuthority
} = require(
  "./IXIAuthorityMosBridge"
);

const {
  authorityError
} = require(
  "./IXIAuthorityErrors"
);


function clean(value) {
  return String(
    value ??
    ""
  ).trim();
}


async function resolveTrustedMosEntityId(
  req
) {
  const access =
    req?.ixiAuthenticatedAccess;

  if (!access) {
    /*
     * Legacy compatibility caller.
     */
    return "";
  }


  const identityEntityId =
    clean(
      access?.membership?.entityId ||
      access?.identity?.entityId
    );


  if (!identityEntityId) {
    throw authorityError(
      "IXI_AOS_ENTITY_CONTEXT_REQUIRED",
      "Authenticated AOS request requires IXI Entity context.",
      {},
      400
    );
  }


  const aosEntityId =
    await resolveAosEntityId(
      identityEntityId
    );


  if (!aosEntityId) {
    throw authorityError(
      "IXI_AOS_ENTITY_BINDING_REQUIRED",
      "Authenticated IXI Entity is not bound to an AOS Entity.",
      {
        identityEntityId
      },
      409
    );
  }


  return aosEntityId;
}


async function assertTrustedMosEntity({
  req,
  requestedEntityId = ""
} = {}) {
  const trustedEntityId =
    await resolveTrustedMosEntityId(
      req
    );


  /*
   * Compatibility caller.
   */
  if (!trustedEntityId) {
    return clean(
      requestedEntityId
    );
  }


  const requested =
    clean(
      requestedEntityId
    );


  if (
    requested &&
    requested !== trustedEntityId
  ) {
    throw authorityError(
      "IXI_AOS_CROSS_ENTITY_DENIED",
      "Authenticated AOS request cannot access another Entity.",
      {
        requestedEntityId:
          requested,

        authenticatedAosEntityId:
          trustedEntityId
      },
      403
    );
  }


  return trustedEntityId;
}


/*
 * Extract object/container references from an
 * event/movement record without trusting the
 * browser to declare security scope.
 *
 * We inspect persisted server data only.
 */

function collectMosObjectIds(
  value,
  results = new Set(),
  depth = 0
) {
  if (
    depth > 8 ||
    value === null ||
    value === undefined
  ) {
    return results;
  }


  if (Array.isArray(value)) {
    value.forEach(item =>
      collectMosObjectIds(
        item,
        results,
        depth + 1
      )
    );

    return results;
  }


  if (
    typeof value !== "object"
  ) {
    return results;
  }


  for (
    const [key, child] of
      Object.entries(value)
  ) {
    const normalizedKey =
      clean(key)
        .toLowerCase();


    if (
      typeof child === "string" &&
      (
        normalizedKey === "objectid" ||
        normalizedKey.endsWith("objectid") ||
        normalizedKey === "containerid" ||
        normalizedKey.endsWith("containerid")
      )
    ) {
      const id =
        clean(child);

      if (id) {
        results.add(id);
      }
    }


    if (
      child &&
      typeof child === "object"
    ) {
      collectMosObjectIds(
        child,
        results,
        depth + 1
      );
    }
  }


  return results;
}


async function canDiscoverMosRecord({
  principal,
  record
} = {}) {
  if (!principal?.authenticated) {
    return true;
  }


  const objectIds =
    Array.from(
      collectMosObjectIds(
        record
      )
    );


  /*
   * Entity-level events with no object reference
   * are protected by the authenticated Entity
   * boundary instead of inventing an object.
   */

  if (!objectIds.length) {
    return true;
  }


  for (
    const objectId of objectIds
  ) {
    let object = null;


    try {
      object =
        getObject(
          objectId
        );
    } catch {
      /*
       * Unknown/stale object references are not
       * sufficient reason to expose the record.
       */
      return false;
    }


    const decision =
      await evaluateMosObjectAuthority({
        principal,
        object,
        capability:
          "aos.discover"
      });


    if (
      decision.enforced &&
      !decision.allowed
    ) {
      return false;
    }
  }


  return true;
}


async function filterDiscoverableMosRecords({
  principal,
  records = []
} = {}) {
  if (!principal?.authenticated) {
    return Array.isArray(records)
      ? records
      : [];
  }


  const visible = [];


  for (
    const record of
      (
        Array.isArray(records)
          ? records
          : []
      )
  ) {
    if (
      await canDiscoverMosRecord({
        principal,
        record
      })
    ) {
      visible.push(record);
    }
  }


  return visible;
}


module.exports = {
  resolveTrustedMosEntityId,
  assertTrustedMosEntity,

  collectMosObjectIds,
  canDiscoverMosRecord,
  filterDiscoverableMosRecords
};
