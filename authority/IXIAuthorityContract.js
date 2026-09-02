"use strict";

const crypto =
  require("crypto");

const {
  SUBJECT_TYPES,
  SCOPE_TYPES,
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


function clean(
  value
) {
  return String(
    value ??
    ""
  ).trim();
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


function safeArray(
  value
) {
  return Array.isArray(
    value
  )
    ? value
    : [];
}


function uniqueStrings(
  value
) {
  return Array.from(
    new Set(
      safeArray(
        value
      )
        .map(clean)
        .filter(Boolean)
    )
  );
}


function nowIso() {
  return new Date()
    .toISOString();
}


function randomId(
  prefix
) {
  return `${prefix}_${crypto
    .randomBytes(12)
    .toString("hex")}`;
}


function normalizeAuthorityRule(
  input = {}
) {
  const source =
    safeObject(
      input
    );

  const effect =
    clean(
      source.effect
    ).toLowerCase();


  if (
    effect !== "allow" &&
    effect !== "deny"
  ) {
    throw authorityError(
      "IXI_AUTHORITY_RULE_EFFECT_INVALID",
      "Authority rule effect must be allow or deny.",
      {
        effect
      },
      400
    );
  }


  const subject =
    safeObject(
      source.subject
    );

  const subjectType =
    clean(
      subject.type
    );


  if (
    !SUBJECT_TYPES.includes(
      subjectType
    )
  ) {
    throw authorityError(
      "IXI_AUTHORITY_SUBJECT_TYPE_INVALID",
      "Authority subject type is invalid.",
      {
        subjectType
      },
      400
    );
  }


  const scope =
    safeObject(
      source.scope
    );

  const scopeType =
    clean(
      scope.type
    ) ||
    "target";


  if (
    !SCOPE_TYPES.includes(
      scopeType
    )
  ) {
    throw authorityError(
      "IXI_AUTHORITY_SCOPE_TYPE_INVALID",
      "Authority scope type is invalid.",
      {
        scopeType
      },
      400
    );
  }


  const capabilities =
    uniqueStrings(
      source.capabilities
    );


  if (!capabilities.length) {
    throw authorityError(
      "IXI_AUTHORITY_CAPABILITY_REQUIRED",
      "At least one authority capability is required.",
      {},
      400
    );
  }


  const invalidCapabilities =
    capabilities.filter(
      capability =>
        !isRegisteredAuthorityCapability(
          capability
        )
    );


  if (invalidCapabilities.length) {
    throw authorityError(
      "IXI_AUTHORITY_CAPABILITY_INVALID",
      "Authority rule contains an unregistered capability.",
      {
        invalidCapabilities
      },
      400
    );
  }


  return {
    ruleId:
      clean(
        source.ruleId
      ) ||
      randomId(
        "rule"
      ),

    effect,

    subject: {
      type:
        subjectType,

      id:
        clean(
          subject.id
        )
    },

    capabilities,

    scope: {
      type:
        scopeType,

      passportId:
        clean(
          scope.passportId
        ),

      passportIds:
        uniqueStrings(
          scope.passportIds
        ),

      locationPassportId:
        clean(
          scope.locationPassportId
        )
    },

    conditions: {
      ...safeObject(
        source.conditions
      )
    },

    limits: {
      ...safeObject(
        source.limits
      )
    },

    enabled:
      source.enabled !== false,

    note:
      clean(
        source.note
      )
  };
}


function normalizeAuthorityPolicy(
  input = {}
) {
  const source =
    safeObject(
      input
    );

  const target =
    safeObject(
      source.target
    );

  const targetPassportId =
    clean(
      target.passportId ||
      source.targetPassportId
    );


  if (!targetPassportId) {
    throw authorityError(
      "IXI_AUTHORITY_TARGET_PASSPORT_REQUIRED",
      "Authority policy target Passport ID is required.",
      {},
      400
    );
  }


  const inheritance =
    safeObject(
      source.inheritance
    );


  return {
    schema:
      "ixi-authority-policy-v1",

    policyId:
      clean(
        source.policyId
      ) ||
      randomId(
        "pol"
      ),

    target: {
      passportId:
        targetPassportId,

      objectId:
        clean(
          target.objectId
        ),

      objectType:
        clean(
          target.objectType
        ),

      label:
        clean(
          target.label
        )
    },

    inheritance: {
      inheritFromAncestors:
        inheritance
          .inheritFromAncestors !==
          false,

      propagateToChildren:
        inheritance
          .propagateToChildren !==
          false
    },

    rules:
      safeArray(
        source.rules
      )
        .map(
          normalizeAuthorityRule
        ),

    metadata: {
      ...safeObject(
        source.metadata
      )
    },

    audit: {
      createdAt:
        clean(
          source?.audit?.createdAt
        ) ||
        nowIso(),

      createdBy:
        clean(
          source?.audit?.createdBy
        ),

      updatedAt:
        clean(
          source?.audit?.updatedAt
        ) ||
        nowIso(),

      updatedBy:
        clean(
          source?.audit?.updatedBy
        )
    }
  };
}


module.exports = {
  clean,
  safeObject,
  safeArray,
  uniqueStrings,

  normalizeAuthorityRule,
  normalizeAuthorityPolicy
};
