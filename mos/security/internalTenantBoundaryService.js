"use strict";

const {
  MosError
} = require(
  "../errors/MosError"
);

const {
  isEnforcementEnabled
} = require(
  "./internalRequestAuthService"
);


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
    ? { ...value }
    : {};
}


function getRequestPath(req) {
  return clean(
    req.path ||
    req.originalUrl ||
    req.url
  )
    .split("?")[0];
}


function reject(
  code,
  message,
  details = null,
  status = 403
) {
  throw new MosError(
    code,
    message,
    details,
    status
  );
}


function bindInternalTenantContext(
  req
) {
  if (
    !isEnforcementEnabled()
  ) {
    return {
      enforced: false
    };
  }

  const auth =
    req.ixiInternalAuth;

  if (
    !auth ||
    auth.authenticated !== true
  ) {
    reject(
      "IXI_INTERNAL_CONTEXT_REQUIRED",
      "Authenticated IXI internal request context is required.",
      null,
      401
    );
  }

  const principalId =
    clean(
      auth.principalId
    );

  const entityId =
    clean(
      auth.entityId
    );

  const path =
    getRequestPath(req);

  if (!principalId) {
    reject(
      "IXI_INTERNAL_PRINCIPAL_REQUIRED",
      "Authenticated IXI principalId is required.",
      null,
      401
    );
  }

  /*
   * AOS environment bootstrap is the one
   * operation allowed before an Entity ID
   * has been resolved.
   *
   * The signed principal is authoritative.
   */
  if (
    path ===
      "/aos/environment"
  ) {
    req.body = {
      ...safeObject(
        req.body
      ),

      ownerUserId:
        principalId
    };

    req.ixiRequestContext = {
      authenticated:
        true,

      principalId,

      entityId:
        entityId || null,

      source:
        "ixi-internal-signature"
    };

    return {
      enforced: true,
      principalId,
      entityId:
        entityId || null
    };
  }


  /*
   * Every remaining MOS customer operation
   * requires a signed Entity identity.
   */
  if (!entityId) {
    reject(
      "IXI_INTERNAL_ENTITY_REQUIRED",
      "Authenticated IXI entityId is required for this MOS operation.",
      {
        path
      },
      401
    );
  }


  /*
   * Global entity enumeration / raw entity
   * creation is not a tenant-scoped browser
   * or integration capability.
   *
   * Entity discovery is performed through
   * authenticated /aos/environment.
   */
  if (
    path === "/entities"
  ) {
    reject(
      "IXI_GLOBAL_ENTITY_ACCESS_FORBIDDEN",
      "Global IXI Entity access is not permitted inside an authenticated tenant request.",
      {
        principalId,
        entityId
      },
      403
    );
  }


  /*
   * Any URL carrying an Entity ID must match
   * the Entity authenticated by the HMAC
   * envelope.
   */
  const entityPathMatch =
    path.match(
      /^\/entities\/([^/]+)(?:\/|$)/
    );

  if (
    entityPathMatch
  ) {
    const claimedEntityId =
      decodeURIComponent(
        entityPathMatch[1]
      );

    if (
      claimedEntityId !==
        entityId
    ) {
      reject(
        "IXI_ENTITY_PATH_MISMATCH",
        "Requested IXI resource does not belong to the authenticated Entity.",
        {
          authenticatedEntityId:
            entityId,

          requestedEntityId:
            claimedEntityId
        },
        403
      );
    }
  }


  /*
   * Query tenant identity is never trusted.
   *
   * If supplied, it must agree with the
   * signed Entity. Then IX-Core replaces it
   * with the authenticated value.
   */
  if (
    req.query &&
    typeof req.query ===
      "object"
  ) {
    const claimedQueryEntityId =
      clean(
        req.query.entityId
      );

    if (
      claimedQueryEntityId &&
      claimedQueryEntityId !==
        entityId
    ) {
      reject(
        "IXI_ENTITY_QUERY_MISMATCH",
        "Query entityId does not match the authenticated Entity.",
        {
          authenticatedEntityId:
            entityId,

          requestedEntityId:
            claimedQueryEntityId
        },
        403
      );
    }

    req.query.entityId =
      entityId;
  }


  /*
   * Body tenant and actor identity are also
   * never trusted.
   *
   * We fail on attempted Entity substitution,
   * then replace tenant/actor values with the
   * authenticated envelope.
   */
  if (
    req.body &&
    typeof req.body ===
      "object" &&
    !Array.isArray(
      req.body
    )
  ) {
    const claimedBodyEntityId =
      clean(
        req.body.entityId
      );

    if (
      claimedBodyEntityId &&
      claimedBodyEntityId !==
        entityId
    ) {
      reject(
        "IXI_ENTITY_BODY_MISMATCH",
        "Body entityId does not match the authenticated Entity.",
        {
          authenticatedEntityId:
            entityId,

          requestedEntityId:
            claimedBodyEntityId
        },
        403
      );
    }

    req.body.entityId =
      entityId;

    /*
     * Mutations operate as the signed
     * principal. Caller-supplied actorId
     * cannot impersonate another user.
     */
    if (
      ![
        "GET",
        "HEAD"
      ].includes(
        clean(req.method)
          .toUpperCase()
      )
    ) {
      req.body.actorId =
        principalId;
    }

    delete req.body.ownerUserId;
  }


  /*
   * Standard request context for downstream
   * MOS services.
   *
   * New services should consume this instead
   * of reconstructing tenant identity from
   * request bodies or arbitrary headers.
   */
  req.ixiRequestContext = {
    authenticated:
      true,

    principalId,

    entityId,

    requestId:
      clean(
        auth.requestId
      ) || null,

    source:
      "ixi-internal-signature"
  };


  return {
    enforced: true,
    principalId,
    entityId
  };
}


function createInternalTenantBoundaryMiddleware() {
  return function internalTenantBoundaryMiddleware(
    req,
    res,
    next
  ) {
    try {
      bindInternalTenantContext(
        req
      );

      return next();

    } catch (error) {
      const status =
        Number(
          error?.statusCode ||
          error?.status ||
          403
        );

      return res
        .status(status)
        .json({
          ok: false,

          error: {
            code:
              error?.code ||
              "IXI_TENANT_BOUNDARY_FAILED",

            message:
              error?.message ||
              "IXI tenant boundary rejected the request.",

            details:
              error?.details ||
              null
          }
        });
    }
  };
}


module.exports = {
  getRequestPath,
  bindInternalTenantContext,
  createInternalTenantBoundaryMiddleware
};
