"use strict";

const store =
  require(
    "./IXIAuthorityDynamoStore"
  );

const {
  normalizeAuthorityPolicy,
  clean,
  uniqueStrings
} =
  require(
    "./IXIAuthorityContract"
  );

const {
  evaluateAuthority
} =
  require(
    "./IXIAuthorityEvaluator"
  );

const {
  authorityError
} =
  require(
    "./IXIAuthorityErrors"
  );

const {
  resolveAuthorityPolicyChain
} =
  require(
    "./IXIAuthorityPolicyResolver"
  );


function principalFromAuthenticatedAccess(
  authenticatedAccess = {}
) {
  const authentication =
    authenticatedAccess
      ?.authentication ||
    {};

  const identity =
    authenticatedAccess
      ?.identity ||
    {};

  const membership =
    authenticatedAccess
      ?.membership ||
    {};


  return {
    authenticated:
      true,

    cognitoSubject:
      clean(
        authentication
          .cognitoSubject
      ),

    principalId:
      clean(
        identity.principalId ||
        identity.employeeId
      ),

    employeeId:
      clean(
        identity.employeeId
      ),

    actorPassportId:
      clean(
        identity.actorPassportId ||
        identity.employeePassportId ||
        membership.actorPassportId
      ),

    entityId:
      clean(
        membership.entityId ||
        identity.entityId
      ),

    entityPassportId:
      clean(
        membership.entityPassportId ||
        identity.entityPassportId
      ),

    roleIds:
      uniqueStrings(
        membership.roleIds
      ),

    groupIds:
      uniqueStrings(
        membership.groupIds
      ),

    directGrants:
      uniqueStrings(
        membership.directGrants
      ),

    directDenies:
      uniqueStrings(
        membership.directDenies
      ),

    scopes:
      uniqueStrings(
        membership.scopes
      )
  };
}


function hasBootstrapCapability(
  principal,
  capability
) {
  const id =
    clean(
      capability
    );

  if (
    uniqueStrings(
      principal.directDenies
    ).includes(id)
  ) {
    return false;
  }


  return uniqueStrings(
    principal.directGrants
  ).includes(id);
}


function assertAuthorityAdministrator(
  principal
) {
  const allowed =
    hasBootstrapCapability(
      principal,
      "authority.manage"
    ) ||
    hasBootstrapCapability(
      principal,
      "security.permissions.manage"
    );


  if (!allowed) {
    throw authorityError(
      "IXI_AUTHORITY_MANAGE_DENIED",
      "Authority administration permission is required.",
      {},
      403
    );
  }
}


async function getPolicy(
  passportId
) {
  const record =
    await store
      .getCurrentPolicyRecord(
        passportId
      );


  return record
    ? {
        ...record,
        policy:
          normalizeAuthorityPolicy(
            record.policy
          )
      }
    : null;
}


async function savePolicy({
  passportId,
  policy,
  principal
} = {}) {
  assertAuthorityAdministrator(
    principal
  );


  const normalized =
    normalizeAuthorityPolicy({
      ...policy,

      target: {
        ...(
          policy?.target ||
          {}
        ),

        passportId:
          clean(
            passportId
          )
      },

      audit: {
        ...(
          policy?.audit ||
          {}
        ),

        updatedAt:
          new Date()
            .toISOString(),

        updatedBy:
          clean(
            principal.actorPassportId ||
            principal.principalId ||
            principal.cognitoSubject
          )
      }
    });


  const previous =
    await store
      .getCurrentPolicyRecord(
        passportId
      );


  return store
    .putPolicyRecord({
      policy:
        normalized,

      previousRecord:
        previous,

      actorId:
        clean(
          principal.actorPassportId ||
          principal.principalId ||
          principal.cognitoSubject
        )
    });
}


async function evaluate({
  principal,
  capability,
  targetPassportId,
  entityPassportId = "",
  locationPassportId = ""
} = {}) {
  /*
   * Resolve the target + ancestor policy chain
   * entirely from authoritative server-side
   * AOS structural data.
   *
   * Browser-supplied ancestor lists are never
   * accepted.
   */

  const resolvedPolicyChain =
    await resolveAuthorityPolicyChain(
      targetPassportId
    );


  const policies =
    resolvedPolicyChain
      .policies;


  const directDenied =
    uniqueStrings(
      principal.directDenies
    ).includes(
      clean(
        capability
      )
    );


  if (directDenied) {
    return {
      allowed:
        false,

      decision:
        "deny",

      reason:
        "principal-direct-deny",

      capability:
        clean(
          capability
        ),

      targetPassportId:
        clean(
          targetPassportId
        )
    };
  }


  /*
   * Object/container policy is evaluated
   * BEFORE broad principal grants.
   *
   * This is critical:
   *
   * a company-wide aos.view grant must never
   * bypass a confidential container deny.
   */

  const policyDecision =
    evaluateAuthority({
      principal,
      capability,
      targetPassportId,

      entityPassportId:
        clean(
          entityPassportId ||
          principal.entityPassportId
        ),

      locationPassportId,

      policies,

      ancestorPassportIds:
        resolvedPolicyChain
          .graph
          .ancestorPassportIds
    });


  if (
    policyDecision.reason !==
      "default-deny"
  ) {
    return policyDecision;
  }


  const directGranted =
    uniqueStrings(
      principal.directGrants
    ).includes(
      clean(
        capability
      )
    );


  if (directGranted) {
    return {
      allowed:
        true,

      decision:
        "allow",

      reason:
        "principal-direct-grant",

      capability:
        clean(
          capability
        ),

      targetPassportId:
        clean(
          targetPassportId
        )
    };
  }


  return policyDecision;
}


module.exports = {
  principalFromAuthenticatedAccess,
  hasBootstrapCapability,
  assertAuthorityAdministrator,

  getPolicy,
  savePolicy,
  evaluate
};
