"use strict";

/*
 * IXI FINANCIAL ACCESS CONTEXT BRIDGE
 *
 * PURPOSE
 * -------
 *
 * Resolve trusted server-side Financial
 * access context.
 *
 *
 * CORE SECURITY RULE
 * ------------------
 *
 * NEVER TRUST THESE FROM THE CLIENT:
 *
 * roles
 * permissions
 * managedPassportIds
 * deniedPermissions
 * authenticated
 *
 *
 * The client may present identity evidence.
 *
 * IX-Core resolves:
 *
 * {
 *   authenticated,
 *   actorPassportId,
 *   entityPassportId,
 *   roles,
 *   permissions,
 *   managedPassportIds,
 *   deniedPermissions
 * }
 *
 * from trusted server-side sources.
 *
 *
 * THIS BRIDGE DOES NOT:
 *
 * - decide financial permissions
 * - calculate accounting
 * - persist financial documents
 * - discover recursive financial scope
 *
 *
 * It only resolves identity/access context.
 */


const crypto =
  require("crypto");


const {
  normalizeFinancialAccessContext
} =
  require(
    "./IXIFinancialPermissionEngine"
  );


/* =========================================================
   RESOLVER REGISTRY
   ========================================================= */

const accessResolvers =
  [];


/* =========================================================
   HELPERS
   ========================================================= */

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


function safeObject(
  value
) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}


function uniqueStrings(
  values
) {
  return Array.from(
    new Set(
      safeArray(
        values
      )
        .map(
          clean
        )
        .filter(
          Boolean
        )
    )
  );
}


function createResolutionId() {
  return `ifar_${crypto
    .randomBytes(10)
    .toString("hex")}`;
}


/* =========================================================
   REQUEST IDENTITY EVIDENCE
   ========================================================= */

/*
 * IMPORTANT:
 *
 * This is EVIDENCE, not authorization.
 *
 * It may come from:
 *
 * - verified auth middleware
 * - trusted internal service headers
 * - decoded server-side token claims
 *
 * It must NOT be treated as permission data.
 */

function normalizeFinancialIdentityEvidence(
  input = {}
) {
  const source =
    safeObject(
      input
    );


  return {
    authenticatedUserId:
      clean(
        source.authenticatedUserId ||
        source.userId
      ),

    actorPassportId:
      clean(
        source.actorPassportId
      ),

    entityPassportId:
      clean(
        source.entityPassportId
      ),

    authProvider:
      clean(
        source.authProvider
      ),

    sessionId:
      clean(
        source.sessionId
      ),

    tokenSubject:
      clean(
        source.tokenSubject
      ),

    trustedInternal:
      Boolean(
        source.trustedInternal
      ),

    metadata: {
      ...safeObject(
        source.metadata
      )
    }
  };
}


/* =========================================================
   RESOLVER REGISTRATION
   ========================================================= */

function registerFinancialAccessResolver({
  resolverId = "",
  priority = 100,
  canResolve,
  resolve
} = {}) {
  const id =
    clean(
      resolverId
    );


  if (
    !id
  ) {
    throw new Error(
      "resolverId is required."
    );
  }


  if (
    typeof canResolve !==
      "function"
  ) {
    throw new Error(
      `Financial access resolver ${id} requires canResolve().`
    );
  }


  if (
    typeof resolve !==
      "function"
  ) {
    throw new Error(
      `Financial access resolver ${id} requires resolve().`
    );
  }


  const existingIndex =
    accessResolvers
      .findIndex(
        resolver =>
          resolver.resolverId ===
            id
      );


  const entry = {
    resolverId:
      id,

    priority:
      Number(
        priority ||
        100
      ),

    canResolve,

    resolve
  };


  if (
    existingIndex >=
      0
  ) {
    accessResolvers[
      existingIndex
    ] =
      entry;
  } else {
    accessResolvers.push(
      entry
    );
  }


  accessResolvers.sort(
    (
      a,
      b
    ) =>
      a.priority -
      b.priority
  );


  return entry;
}


/* =========================================================
   RESOLVER LIST
   ========================================================= */

function listFinancialAccessResolvers() {
  return accessResolvers
    .map(
      resolver => ({
        resolverId:
          resolver.resolverId,

        priority:
          resolver.priority
      })
    );
}


/* =========================================================
   EMPTY CONTEXT
   ========================================================= */

function createUnauthenticatedFinancialAccessContext({
  reason = "unresolved",
  resolutionId = ""
} = {}) {
  return normalizeFinancialAccessContext({
    authenticated:
      false,

    actorPassportId:
      "",

    entityPassportId:
      "",

    roles:
      [],

    permissions:
      [],

    managedPassportIds:
      [],

    deniedPermissions:
      [],

    metadata: {
      resolutionId:
        clean(
          resolutionId
        ),

      resolutionReason:
        clean(
          reason
        )
    }
  });
}


/* =========================================================
   RESOLVE ACCESS CONTEXT
   ========================================================= */

async function resolveFinancialAccessContext(
  identityEvidence = {},
  {
    requestContext = {}
  } = {}
) {
  const evidence =
    normalizeFinancialIdentityEvidence(
      identityEvidence
    );


  const resolutionId =
    createResolutionId();


  for (
    const resolver of
      accessResolvers
  ) {
    let eligible =
      false;


    try {
      eligible =
        await resolver
          .canResolve({
            identityEvidence:
              evidence,

            requestContext:
              safeObject(
                requestContext
              )
          });
    } catch (
      error
    ) {
      continue;
    }


    if (
      !eligible
    ) {
      continue;
    }


    const resolved =
      await resolver
        .resolve({
          identityEvidence:
            evidence,

          requestContext:
            safeObject(
              requestContext
            )
        });


    if (
      !resolved
    ) {
      continue;
    }


    const normalized =
      normalizeFinancialAccessContext({
        ...safeObject(
          resolved
        ),

        metadata: {
          ...safeObject(
            resolved
              ?.metadata
          ),

          resolutionId,

          resolverId:
            resolver.resolverId
        }
      });


    return normalized;
  }


  return createUnauthenticatedFinancialAccessContext({
    reason:
      "no-resolver",

    resolutionId
  });
}


/* =========================================================
   TRUSTED INTERNAL RESOLVER
   ========================================================= */

/*
 * This resolver exists so IX-Core internal
 * jobs and server-side tests can operate
 * without pretending to be browser users.
 *
 *
 * IMPORTANT:
 *
 * It ONLY accepts contexts explicitly marked:
 *
 * trustedInternal: true
 *
 * Do not populate trustedInternal from an
 * arbitrary public request header.
 */

registerFinancialAccessResolver({
  resolverId:
    "trusted-internal",

  priority:
    10,

  canResolve:
    async ({
      identityEvidence
    }) =>
      Boolean(
        identityEvidence
          ?.trustedInternal
      ),

  resolve:
    async ({
      identityEvidence,
      requestContext
    }) => {
      const trustedAccess =
        safeObject(
          requestContext
            ?.trustedFinancialAccess
        );


      return {
        authenticated:
          true,

        actorPassportId:
          clean(
            trustedAccess.actorPassportId ||
            identityEvidence.actorPassportId
          ),

        entityPassportId:
          clean(
            trustedAccess.entityPassportId ||
            identityEvidence.entityPassportId
          ),

        roles:
          uniqueStrings(
            trustedAccess.roles
          ),

        permissions:
          uniqueStrings(
            trustedAccess.permissions
          ),

        managedPassportIds:
          uniqueStrings(
            trustedAccess.managedPassportIds
          ),

        deniedPermissions:
          uniqueStrings(
            trustedAccess.deniedPermissions
          ),

        metadata: {
          authProvider:
            "trusted-internal",

          authenticatedUserId:
            clean(
              identityEvidence
                .authenticatedUserId
            )
        }
      };
    }
});


/* =========================================================
   STATIC TEST RESOLVER
   ========================================================= */

/*
 * TEST ONLY.
 *
 * Enabled only when:
 *
 * IXI_FINANCIAL_ENABLE_TEST_ACCESS=true
 *
 * This lets us exercise HTTP authorization
 * before the production auth resolver is
 * attached.
 */

registerFinancialAccessResolver({
  resolverId:
    "static-test",

  priority:
    900,

  canResolve:
    async ({
      identityEvidence
    }) =>
      process.env
        .IXI_FINANCIAL_ENABLE_TEST_ACCESS ===
          "true" &&
      clean(
        identityEvidence
          ?.authProvider
      ) ===
        "financial-test",

  resolve:
    async ({
      identityEvidence
    }) => ({
      authenticated:
        true,

      actorPassportId:
        clean(
          identityEvidence
            .actorPassportId ||
          "passport:employee:financial-test"
        ),

      entityPassportId:
        clean(
          identityEvidence
            .entityPassportId ||
          "passport:entity:financial-test"
        ),

      roles: [
        "financial-admin"
      ],

      permissions:
        [],

      managedPassportIds:
        [],

      deniedPermissions:
        [],

      metadata: {
        authProvider:
          "financial-test"
      }
    })
});


/* =========================================================
   REQUEST EVIDENCE EXTRACTION
   ========================================================= */

/*
 * This function only extracts identity
 * evidence.
 *
 * It does NOT accept permissions from headers.
 */

function getFinancialIdentityEvidenceFromRequest(
  req
) {
  const trustedIdentity =
    safeObject(
      req
        ?.ixiIdentity
    );


  /*
   * Preferred future path:
   *
   * auth middleware places verified identity
   * in req.ixiIdentity.
   */
  if (
    Object.keys(
      trustedIdentity
    ).length
  ) {
    return normalizeFinancialIdentityEvidence(
      trustedIdentity
    );
  }


  /*
   * Test bridge only.
   *
   * Public role/permission headers are NOT
   * parsed here.
   */
  if (
    process.env
      .IXI_FINANCIAL_ENABLE_TEST_ACCESS ===
        "true" &&
    clean(
      req
        ?.headers
        ?.[
          "x-ixi-financial-test"
        ]
    ) ===
      "true"
  ) {
    return normalizeFinancialIdentityEvidence({
      authProvider:
        "financial-test",

      actorPassportId:
        clean(
          req
            ?.headers
            ?.[
              "x-ixi-actor-passport"
            ]
        ),

      entityPassportId:
        clean(
          req
            ?.headers
            ?.[
              "x-ixi-entity-passport"
            ]
        )
    });
  }


  return normalizeFinancialIdentityEvidence(
    {}
  );
}


/* =========================================================
   EXPRESS RESOLUTION HELPER
   ========================================================= */

async function resolveFinancialAccessContextFromRequest(
  req
) {
  const evidence =
    getFinancialIdentityEvidenceFromRequest(
      req
    );


  return resolveFinancialAccessContext(
    evidence,
    {
      requestContext: {
        requestId:
          clean(
            req
              ?.headers
              ?.[
                "x-request-id"
              ]
          ),

        sourceIp:
          clean(
            req
              ?.ip ||
            req
              ?.socket
              ?.remoteAddress
          ),

        userAgent:
          clean(
            req
              ?.headers
              ?.[
                "user-agent"
              ]
          ),

        trustedFinancialAccess:
          safeObject(
            req
              ?.trustedFinancialAccess
          )
      }
    }
  );
}


/* =========================================================
   EXPORTS
   ========================================================= */

module.exports = {
  normalizeFinancialIdentityEvidence,

  registerFinancialAccessResolver,
  listFinancialAccessResolvers,

  createUnauthenticatedFinancialAccessContext,

  resolveFinancialAccessContext,

  getFinancialIdentityEvidenceFromRequest,

  resolveFinancialAccessContextFromRequest
};
