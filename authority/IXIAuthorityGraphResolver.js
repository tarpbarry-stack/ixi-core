"use strict";

/*
 * IXI AUTHORITY GRAPH RESOLVER
 *
 * PURPOSE
 * -------
 *
 * Resolve the authoritative AOS containment
 * chain entirely on the server.
 *
 * Browser-supplied ancestor chains are never
 * trusted.
 *
 *
 * STRUCTURAL TRUTH
 * ----------------
 *
 * MOS/AOS structural containment is defined by:
 *
 *     object.directContainerId
 *
 * Customer labels, names and object vocabulary
 * do not determine containment or authority.
 */


const {
  getObject,
  listObjects
} =
  require(
    "../mos/objects/objectService"
  );


const {
  findPassportById,
  findPassportBySource
} =
  require(
    "../passport/passportRegistry"
  );


const {
  authorityError
} =
  require(
    "./IXIAuthorityErrors"
  );


function clean(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


function safeArray(
  value
) {
  return Array.isArray(
    value
  )
    ? value
    : [];
}


/* =========================================================
   PASSPORT → OBJECT
   ========================================================= */

/*
 * Current Passport infrastructure retains
 * sourceType/sourceId.
 *
 * Authority deliberately does not infer an
 * object from its display name or type.
 */

function resolveObjectFromPassport(
  passportId
) {
  const id =
    clean(
      passportId
    );

  if (!id) {
    return null;
  }


  const passport =
    findPassportById(
      id
    );


  if (!passport) {
    return null;
  }


  const sourceId =
    clean(
      passport.sourceId
    );


  if (!sourceId) {
    return null;
  }


  try {
    const object =
      getObject(
        sourceId
      );


    return {
      passport,
      object
    };

  } catch {
    return null;
  }
}


/* =========================================================
   OBJECT → PASSPORT
   ========================================================= */

function resolvePassportForObject(
  object
) {
  const objectId =
    clean(
      object?.objectId
    );


  if (!objectId) {
    return null;
  }


  /*
   * Do not assume one permanent sourceType.
   *
   * Existing Passport records are searched
   * against known AOS/MOS object source types.
   *
   * This is compatibility infrastructure until
   * Passport itself is moved to an authoritative
   * AWS-backed registry.
   */

  const sourceTypes = [
    "mos-object",
    "aos-object",
    "object",
    "mos-person"
  ];


  for (
    const sourceType of
      sourceTypes
  ) {
    const passport =
      findPassportBySource(
        sourceType,
        objectId
      );


    if (passport) {
      return passport;
    }
  }


  /*
   * Some object records may already carry
   * explicit Passport identity.
   */

  const explicitPassportId =
    clean(
      object.passportId ||
      object.ixiPassportId ||
      object?.metadata?.passportId
    );


  if (explicitPassportId) {
    return (
      findPassportById(
        explicitPassportId
      ) ||
      {
        passportId:
          explicitPassportId,

        sourceType:
          "object-explicit",

        sourceId:
          objectId
      }
    );
  }


  return null;
}


/* =========================================================
   ANCESTOR WALK
   ========================================================= */

function buildAuthorityAncestorChain(
  object
) {
  const objects =
    listObjects({
      entityId:
        object.entityId,
      status:
        null
    });


  const byId =
    new Map(
      safeArray(
        objects
      )
        .map(
          item => [
            clean(
              item.objectId
            ),
            item
          ]
        )
        .filter(
          ([id]) =>
            Boolean(id)
        )
    );


  const ancestors =
    [];

  const visited =
    new Set();


  let parentId =
    clean(
      object.directContainerId
    );


  while (parentId) {

    if (
      visited.has(
        parentId
      )
    ) {
      throw authorityError(
        "IXI_AUTHORITY_GRAPH_CYCLE",
        "AOS containment cycle detected while resolving Authority.",
        {
          objectId:
            clean(
              object.objectId
            ),

          repeatedObjectId:
            parentId
        },
        409
      );
    }


    visited.add(
      parentId
    );


    const parent =
      byId.get(
        parentId
      );


    if (!parent) {
      throw authorityError(
        "IXI_AUTHORITY_ANCESTOR_NOT_FOUND",
        "Authority could not resolve an AOS ancestor object.",
        {
          objectId:
            clean(
              object.objectId
            ),

          missingAncestorObjectId:
            parentId
        },
        409
      );
    }


    if (
      clean(
        parent.entityId
      ) !==
      clean(
        object.entityId
      )
    ) {
      throw authorityError(
        "IXI_AUTHORITY_CROSS_ENTITY_GRAPH",
        "AOS Authority containment cannot cross Entity boundaries.",
        {
          objectId:
            clean(
              object.objectId
            ),

          ancestorObjectId:
            clean(
              parent.objectId
            ),

          objectEntityId:
            clean(
              object.entityId
            ),

          ancestorEntityId:
            clean(
              parent.entityId
            )
        },
        409
      );
    }


    const passport =
      resolvePassportForObject(
        parent
      );


    ancestors.push({
      object:
        parent,

      passport,

      objectId:
        clean(
          parent.objectId
        ),

      passportId:
        clean(
          passport?.passportId
        )
    });


    parentId =
      clean(
        parent.directContainerId
      );
  }


  return ancestors;
}


/* =========================================================
   AUTHORITY GRAPH
   ========================================================= */

function resolveAuthorityGraph(
  targetPassportId
) {
  const resolved =
    resolveObjectFromPassport(
      targetPassportId
    );


  if (!resolved) {
    /*
     * Not every Authority target must currently
     * be a MOS object.
     *
     * Financial Passports and future domain
     * Passports may have policies too.
     *
     * Therefore an unresolved object graph is
     * a valid leaf target, not an authentication
     * failure.
     */

    return {
      targetPassportId:
        clean(
          targetPassportId
        ),

      object:
        null,

      entityId:
        "",

      ancestors:
        [],

      ancestorPassportIds:
        [],

      graphResolved:
        false
    };
  }


  const ancestors =
    buildAuthorityAncestorChain(
      resolved.object
    );


  return {
    targetPassportId:
      clean(
        targetPassportId
      ),

    object:
      resolved.object,

    entityId:
      clean(
        resolved.object.entityId
      ),

    ancestors,

    ancestorPassportIds:
      ancestors
        .map(
          item =>
            clean(
              item.passportId
            )
        )
        .filter(Boolean),

    graphResolved:
      true
  };
}


module.exports = {
  resolveObjectFromPassport,
  resolvePassportForObject,

  buildAuthorityAncestorChain,
  resolveAuthorityGraph
};
