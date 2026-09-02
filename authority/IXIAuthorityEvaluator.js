"use strict";

const {
  clean,
  safeArray,
  safeObject,
  uniqueStrings
} =
  require(
    "./IXIAuthorityContract"
  );

const {
  isRegisteredAuthorityCapability
} =
  require(
    "./IXIAuthorityRegistry"
  );

const {
  authorityError
} =
  require(
    "./IXIAuthorityErrors"
  );


function subjectMatches({
  rule,
  principal
}) {
  const subject =
    safeObject(
      rule.subject
    );

  const type =
    clean(
      subject.type
    );

  const id =
    clean(
      subject.id
    );


  if (
    type ===
      "all-authenticated"
  ) {
    return Boolean(
      principal.authenticated
    );
  }


  if (
    type ===
      "principal"
  ) {
    return Boolean(
      id &&
      [
        principal.principalId,
        principal.employeeId,
        principal.actorPassportId,
        principal.cognitoSubject
      ]
        .map(clean)
        .includes(id)
    );
  }


  if (
    type ===
      "role"
  ) {
    return uniqueStrings(
      principal.roleIds
    ).includes(
      id
    );
  }


  if (
    type ===
      "group"
  ) {
    return uniqueStrings(
      principal.groupIds
    ).includes(
      id
    );
  }


  if (
    type ===
      "entity-member"
  ) {
    return Boolean(
      principal.authenticated &&
      principal.entityId
    );
  }


  return false;
}


function scopeMatches({
  rule,
  targetPassportId,
  entityPassportId = "",
  locationPassportId = "",
  ancestorPassportIds = []
}) {
  const scope =
    safeObject(
      rule.scope
    );

  const type =
    clean(
      scope.type
    ) ||
    "target";


  if (
    type ===
      "target"
  ) {
    return (
      clean(
        scope.passportId
      ) ===
      clean(
        targetPassportId
      )
    );
  }


  if (
    type ===
      "target-and-descendants"
  ) {
    const sourcePassportId =
      clean(
        scope.passportId
      );


    /*
     * The target matches when:
     *
     * 1. the policy is attached directly to
     *    the target Passport; OR
     *
     * 2. the policy source Passport is an
     *    authoritative server-resolved
     *    ancestor of the target.
     *
     * The browser never supplies this chain.
     */

    return (
      sourcePassportId ===
        clean(
          targetPassportId
        ) ||
      safeArray(
        ancestorPassportIds
      )
        .map(clean)
        .includes(
          sourcePassportId
        )
    );
  }


  if (
    type ===
      "entity"
  ) {
    return Boolean(
      clean(
        entityPassportId
      ) &&
      clean(
        scope.passportId
      ) ===
        clean(
          entityPassportId
        )
    );
  }


  if (
    type ===
      "location"
  ) {
    return Boolean(
      clean(
        locationPassportId
      ) &&
      clean(
        scope.locationPassportId ||
        scope.passportId
      ) ===
        clean(
          locationPassportId
        )
    );
  }


  if (
    type ===
      "selected-passports"
  ) {
    return uniqueStrings(
      scope.passportIds
    ).includes(
      clean(
        targetPassportId
      )
    );
  }


  return false;
}


function evaluateAuthority({
  principal = {},
  capability = "",
  targetPassportId = "",
  entityPassportId = "",
  locationPassportId = "",
  policies = [],
  ancestorPassportIds = []
} = {}) {
  const requestedCapability =
    clean(
      capability
    );


  if (
    !isRegisteredAuthorityCapability(
      requestedCapability
    )
  ) {
    throw authorityError(
      "IXI_AUTHORITY_CAPABILITY_UNKNOWN",
      "Authority capability is not registered.",
      {
        capability:
          requestedCapability
      },
      400
    );
  }


  const actor =
    {
      ...safeObject(
        principal
      ),

      authenticated:
        principal.authenticated ===
        true
    };


  if (
    !actor.authenticated
  ) {
    return {
      allowed:
        false,

      decision:
        "deny",

      reason:
        "principal-not-authenticated",

      capability:
        requestedCapability,

      targetPassportId:
        clean(
          targetPassportId
        )
    };
  }


  const candidates =
    [];


  safeArray(
    policies
  ).forEach(
    (
      policy,
      policyIndex
    ) => {
      safeArray(
        policy?.rules
      ).forEach(
        rule => {
          if (
            rule?.enabled ===
              false
          ) {
            return;
          }


          if (
            !safeArray(
              rule.capabilities
            )
              .map(clean)
              .includes(
                requestedCapability
              )
          ) {
            return;
          }


          if (
            !subjectMatches({
              rule,
              principal:
                actor
            })
          ) {
            return;
          }


          if (
            !scopeMatches({
              rule,
              targetPassportId,
              entityPassportId,
              locationPassportId,
              ancestorPassportIds
            })
          ) {
            return;
          }


          candidates.push({
            effect:
              clean(
                rule.effect
              ),

            ruleId:
              clean(
                rule.ruleId
              ),

            policyId:
              clean(
                policy.policyId
              ),

            sourcePassportId:
              clean(
                policy
                  ?.target
                  ?.passportId
              ),

            policyIndex
          });
        }
      );
    }
  );


  /*
   * Policies must be supplied in specificity
   * order:
   *
   *   target first
   *   nearest ancestor next
   *   entity defaults last
   *
   * Explicit deny wins at the same or greater
   * specificity.
   */

  const deny =
    candidates.find(
      candidate =>
        candidate.effect ===
          "deny"
    );


  if (deny) {
    return {
      allowed:
        false,

      decision:
        "deny",

      reason:
        "explicit-deny",

      capability:
        requestedCapability,

      targetPassportId:
        clean(
          targetPassportId
        ),

      policyId:
        deny.policyId,

      ruleId:
        deny.ruleId,

      sourcePassportId:
        deny.sourcePassportId
    };
  }


  const allow =
    candidates.find(
      candidate =>
        candidate.effect ===
          "allow"
    );


  if (allow) {
    return {
      allowed:
        true,

      decision:
        "allow",

      reason:
        "explicit-allow",

      capability:
        requestedCapability,

      targetPassportId:
        clean(
          targetPassportId
        ),

      policyId:
        allow.policyId,

      ruleId:
        allow.ruleId,

      sourcePassportId:
        allow.sourcePassportId
    };
  }


  return {
    allowed:
      false,

    decision:
      "deny",

    reason:
      "default-deny",

    capability:
      requestedCapability,

    targetPassportId:
      clean(
        targetPassportId
      )
  };
}


module.exports = {
  subjectMatches,
  scopeMatches,
  evaluateAuthority
};
