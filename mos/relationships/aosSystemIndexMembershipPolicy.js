"use strict";

const { MosError } = require("../errors/MosError");
const { cleanText } = require("../util/normalize");

const AOS_SYSTEM_INDEX_MEMBERSHIP_POLICY_SCHEMA =
  "aos.system-index-membership.v1";

const OWNED_EQUIPMENT_ADAPTER_ID =
  "ixi-owned-equipment";

const SYSTEM_INDEX_TEMPLATE_ID =
  "ixi-system-index-v1";

const OWNED_EQUIPMENT_MEMBERSHIP_POLICY = Object.freeze({
  schema: AOS_SYSTEM_INDEX_MEMBERSHIP_POLICY_SCHEMA,
  enabled: true,
  defaultWorkspaceHome: true,
  allowedObjectTypes: Object.freeze(["machine"]),
  allowedDefinitionIds: Object.freeze([])
});

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizedList(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map(value => cleanText(value))
      .filter(Boolean)
  )];
}

function isExplicitAosSystemIndexObject(object = {}) {
  const metadata = safeObject(object?.metadata);
  const templateId = cleanText(
    object?.cardTemplateSlug ||
    object?.templateId ||
    metadata.templateId ||
    metadata.cardTemplateId
  );

  return (
    metadata.systemIndex === true ||
    metadata.isSystemIndex === true ||
    metadata.systemIndexPresentation === true ||
    metadata.systemAdapter === true ||
    metadata.rootContainer === true ||
    cleanText(metadata.hierarchyRole).toLowerCase() === "index" ||
    templateId === SYSTEM_INDEX_TEMPLATE_ID ||
    cleanText(object?.objectType).toLowerCase() === "system-index"
  );
}

function normalizeAosSystemIndexMembershipPolicy(value) {
  const source = safeObject(value);
  if (
    cleanText(source.schema) !==
    AOS_SYSTEM_INDEX_MEMBERSHIP_POLICY_SCHEMA
  ) {
    return null;
  }

  return {
    schema: AOS_SYSTEM_INDEX_MEMBERSHIP_POLICY_SCHEMA,
    enabled: source.enabled === true,
    defaultWorkspaceHome: source.defaultWorkspaceHome === true,
    allowedObjectTypes: normalizedList(source.allowedObjectTypes)
      .map(value => value.toLowerCase()),
    allowedDefinitionIds: normalizedList(source.allowedDefinitionIds)
  };
}

function getAosSystemIndexMembershipPolicy(object = {}) {
  if (!isExplicitAosSystemIndexObject(object)) return null;

  const metadata = safeObject(object?.metadata);
  /*
   * Equipment is an IXI-owned technical adapter, not customer vocabulary.
   * Its server contract takes precedence over mutable Object metadata so an
   * ordinary Object PATCH cannot widen the platform-owned membership class.
   */
  if (cleanText(metadata.adapterId) === OWNED_EQUIPMENT_ADAPTER_ID) {
    return {
      ...OWNED_EQUIPMENT_MEMBERSHIP_POLICY,
      allowedObjectTypes: [
        ...OWNED_EQUIPMENT_MEMBERSHIP_POLICY.allowedObjectTypes
      ],
      allowedDefinitionIds: []
    };
  }

  const explicit = normalizeAosSystemIndexMembershipPolicy(
    metadata.systemIndexMembershipPolicy
  );

  if (explicit) return explicit;

  return null;
}

function assertValidAosSystemIndexMembershipPolicy(value) {
  const source = safeObject(value);
  const normalized = normalizeAosSystemIndexMembershipPolicy(source);

  if (!normalized) {
    throw new MosError(
      "AOS_SYSTEM_INDEX_MEMBERSHIP_POLICY_INVALID",
      `System Index membership policy schema must be ${AOS_SYSTEM_INDEX_MEMBERSHIP_POLICY_SCHEMA}.`,
      null,
      400
    );
  }

  if (
    typeof source.enabled !== "boolean" ||
    typeof source.defaultWorkspaceHome !== "boolean" ||
    !Array.isArray(source.allowedObjectTypes) ||
    !Array.isArray(source.allowedDefinitionIds)
  ) {
    throw new MosError(
      "AOS_SYSTEM_INDEX_MEMBERSHIP_POLICY_INVALID",
      "System Index membership policy fields must use their canonical boolean and array types.",
      null,
      400
    );
  }

  if (normalized.allowedObjectTypes.includes("system-index")) {
    throw new MosError(
      "AOS_SYSTEM_INDEX_ROOT_MEMBERSHIP_PROHIBITED",
      "A System Index policy cannot admit another System Index.",
      null,
      409
    );
  }

  if (
    normalized.enabled &&
    normalized.allowedObjectTypes.length === 0 &&
    normalized.allowedDefinitionIds.length === 0
  ) {
    throw new MosError(
      "AOS_SYSTEM_INDEX_MEMBERSHIP_POLICY_INVALID",
      "An enabled System Index policy must declare at least one canonical Object type or customer definition.",
      null,
      400
    );
  }

  return normalized;
}

function evaluateAosRailMembership({ sourceObject, targetObject } = {}) {
  if (isExplicitAosSystemIndexObject(sourceObject)) {
    return {
      allowed: false,
      code: "AOS_SYSTEM_INDEX_ROOT_MEMBERSHIP_PROHIBITED",
      reason: "system-index-root"
    };
  }

  if (!isExplicitAosSystemIndexObject(targetObject)) {
    return {
      allowed: true,
      code: null,
      reason: "ordinary-container"
    };
  }

  const policy = getAosSystemIndexMembershipPolicy(targetObject);
  if (!policy) {
    return {
      allowed: false,
      code: "AOS_SYSTEM_INDEX_MEMBERSHIP_POLICY_REQUIRED",
      reason: "missing-policy"
    };
  }

  if (!policy.enabled) {
    return {
      allowed: false,
      code: "AOS_SYSTEM_INDEX_MEMBERSHIP_DISABLED",
      reason: "policy-disabled"
    };
  }

  const sourceType = cleanText(sourceObject?.objectType).toLowerCase();
  const sourceDefinitionId = cleanText(sourceObject?.definitionId);
  const matchesType = Boolean(
    sourceType && policy.allowedObjectTypes.includes(sourceType)
  );
  const matchesDefinition = Boolean(
    sourceDefinitionId &&
    policy.allowedDefinitionIds.includes(sourceDefinitionId)
  );

  return matchesType || matchesDefinition
    ? {
        allowed: true,
        code: null,
        reason: matchesDefinition ? "definition-allowed" : "type-allowed",
        policy
      }
    : {
        allowed: false,
        code: "AOS_SYSTEM_INDEX_MEMBER_REJECTED",
        reason: "member-class-rejected",
        policy
      };
}

function assertAosRailMembershipAllowed({ sourceObject, targetObject } = {}) {
  const result = evaluateAosRailMembership({ sourceObject, targetObject });
  if (result.allowed) return result;

  const messages = {
    AOS_SYSTEM_INDEX_ROOT_MEMBERSHIP_PROHIBITED:
      "A System Index is a root projection and cannot be nested in any container.",
    AOS_SYSTEM_INDEX_MEMBERSHIP_POLICY_REQUIRED:
      "The target System Index has no canonical membership policy.",
    AOS_SYSTEM_INDEX_MEMBERSHIP_DISABLED:
      "The target System Index does not accept operational membership writes.",
    AOS_SYSTEM_INDEX_MEMBER_REJECTED:
      "The Object does not match the target System Index membership policy."
  };

  throw new MosError(
    result.code,
    messages[result.code] || "The System Index membership is not allowed.",
    {
      sourceObjectId: cleanText(sourceObject?.objectId) || null,
      sourceObjectType: cleanText(sourceObject?.objectType) || null,
      sourceDefinitionId: cleanText(sourceObject?.definitionId) || null,
      targetObjectId: cleanText(targetObject?.objectId) || null,
      reason: result.reason
    },
    409
  );
}

module.exports = {
  AOS_SYSTEM_INDEX_MEMBERSHIP_POLICY_SCHEMA,
  OWNED_EQUIPMENT_ADAPTER_ID,
  OWNED_EQUIPMENT_MEMBERSHIP_POLICY,
  isExplicitAosSystemIndexObject,
  normalizeAosSystemIndexMembershipPolicy,
  assertValidAosSystemIndexMembershipPolicy,
  getAosSystemIndexMembershipPolicy,
  evaluateAosRailMembership,
  assertAosRailMembershipAllowed
};
