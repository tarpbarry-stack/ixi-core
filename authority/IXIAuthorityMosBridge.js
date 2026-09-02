"use strict";


const {
  getObject
} =
  require(
    "../mos/objects/objectService"
  );


const {
  resolvePassportForObject
} =
  require(
    "./IXIAuthorityGraphResolver"
  );


const {
  evaluate
} =
  require(
    "./IXIAuthorityService"
  );

const {
  resolveAuthorityPolicyChain
} =
  require(
    "./IXIAuthorityPolicyResolver"
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


function getObjectAuthorityIdentity(
  objectOrId
) {
  const object =
    typeof objectOrId === "string"
      ? getObject(objectOrId)
      : objectOrId;


  if (!object) {
    return {
      object:
        null,

      passport:
        null,

      passportId:
        ""
    };
  }


  const passport =
    resolvePassportForObject(
      object
    );


  return {
    object,

    passport,

    passportId:
      clean(
        passport?.passportId
      )
  };
}


/*
 * COMPATIBILITY RULE
 *
 * Objects without authoritative Passport
 * identity remain accessible during migration.
 *
 * Once Passport coverage is complete this
 * compatibility behavior can be removed and
 * the estate can become strict default-deny.
 */

async function evaluateMosObjectAuthority({
  principal,
  object,
  capability
} = {}) {
  if (!principal?.authenticated) {
    return {
      enforced:
        false,

      allowed:
        true,

      reason:
        "compatibility-no-ixi-principal"
    };
  }


  const identity =
    getObjectAuthorityIdentity(
      object
    );


  if (!identity.passportId) {
    return {
      enforced:
        false,

      allowed:
        true,

      reason:
        "compatibility-object-without-passport",

      objectId:
        clean(
          identity.object?.objectId
        )
    };
  }


  /*
   * Compatibility migration rule:
   *
   * A Passport by itself does NOT activate
   * strict default-deny.
   *
   * Authority becomes enforceable when:
   *
   * - an effective target/ancestor policy exists
   * - the principal carries a direct grant
   * - the principal carries a direct deny
   */

  const policyChain =
    await resolveAuthorityPolicyChain(
      identity.passportId
    );


  const capabilityName =
    clean(
      capability
    );


  const directGrants =
    Array.isArray(
      principal.directGrants
    )
      ? principal.directGrants
      : [];


  const directDenies =
    Array.isArray(
      principal.directDenies
    )
      ? principal.directDenies
      : [];


  const hasAuthorityEvidence =
    policyChain.policies.length > 0 ||
    directGrants.includes(
      capabilityName
    ) ||
    directDenies.includes(
      capabilityName
    );


  if (!hasAuthorityEvidence) {
    return {
      enforced:
        false,

      allowed:
        true,

      reason:
        "compatibility-no-effective-policy",

      objectId:
        clean(
          identity.object?.objectId
        ),

      passportId:
        identity.passportId
    };
  }


  const decision =
    await evaluate({
      principal,

      capability:
        capabilityName,

      targetPassportId:
        identity.passportId
    });


  return {
    enforced:
      true,

    ...decision,

    objectId:
      clean(
        identity.object?.objectId
      ),

    passportId:
      identity.passportId
  };
}


async function assertMosObjectAuthority({
  principal,
  object,
  capability
} = {}) {
  const decision =
    await evaluateMosObjectAuthority({
      principal,
      object,
      capability
    });


  if (
    decision.enforced &&
    !decision.allowed
  ) {
    throw authorityError(
      "IXI_AOS_AUTHORITY_DENIED",
      "IXI Authority denied this AOS operation.",
      {
        capability:
          clean(capability),

        objectId:
          clean(
            decision.objectId
          ),

        passportId:
          clean(
            decision.passportId
          ),

        reason:
          clean(
            decision.reason
          ),

        policyId:
          clean(
            decision.policyId
          ),

        ruleId:
          clean(
            decision.ruleId
          ),

        sourcePassportId:
          clean(
            decision.sourcePassportId
          )
      },
      403
    );
  }


  return decision;
}


async function filterDiscoverableObjects({
  principal,
  objects = []
} = {}) {
  if (!principal?.authenticated) {
    return objects;
  }


  const sourceObjects =
    Array.isArray(objects)
      ? objects
      : [];


  const objectById =
    new Map(
      sourceObjects
        .map(
          object => [
            clean(
              object?.objectId
            ),
            object
          ]
        )
        .filter(
          ([objectId]) =>
            Boolean(objectId)
        )
    );


  const hiddenObjectIds =
    new Set();


  /*
   * PASS 1
   *
   * Evaluate every object's own effective
   * Authority state.
   */

  for (
    const object of sourceObjects
  ) {
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
      hiddenObjectIds.add(
        clean(
          object.objectId
        )
      );
    }
  }


  /*
   * PASS 2
   *
   * Descendants of hidden objects are hidden
   * structurally even if they:
   *
   * - have no Passport yet
   * - have no direct policy
   * - would otherwise be compatibility-visible
   *
   * A secured subtree must never be broken
   * apart and promoted into visible roots.
   */

  let changed =
    true;


  while (changed) {
    changed =
      false;


    for (
      const object of sourceObjects
    ) {
      const objectId =
        clean(
          object?.objectId
        );


      if (
        !objectId ||
        hiddenObjectIds.has(
          objectId
        )
      ) {
        continue;
      }


      const parentId =
        clean(
          object?.directContainerId
        );


      if (
        parentId &&
        hiddenObjectIds.has(
          parentId
        )
      ) {
        hiddenObjectIds.add(
          objectId
        );

        changed =
          true;
      }
    }
  }


  return sourceObjects.filter(
    object =>
      !hiddenObjectIds.has(
        clean(
          object?.objectId
        )
      )
  );
}


module.exports = {
  getObjectAuthorityIdentity,

  evaluateMosObjectAuthority,
  assertMosObjectAuthority,

  filterDiscoverableObjects
};
