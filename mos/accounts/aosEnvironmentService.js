const { withCanonicalReadScope } = require("../storage/canonicalReadScope");
const { loadInventory } = require("../../financial/IXIFinancialInventoryService");
const {
  ensureAosAccount,
  getAosAccountForUser
} = require("./aosAccountService");

const {
  listObjects
} = require("../objects/objectService");

const {
  listRelationships
} = require("../relationships/relationshipService");

const {
  EDGE_BEHAVIOR_IDS
} = require("../relationships/edgeBehaviorRegistry");

const {
  rebuildEntityProjections, projectVisibleInventory
} = require("../projections/projectionService");

const {
  cleanText
} = require("../util/normalize");

const {
  MosError
} = require("../errors/MosError");

const {
  filterDiscoverableObjects,
  buildMosObjectActorAuthority
} = require(
  "../../authority/IXIAuthorityMosBridge"
);

const {
  principalFromMosMembership
} = require("../security/mosMembershipAuthorityService");

const {
  resolveCanonicalObjectIdentity, normalizedPassportIds
} = require("../identity/canonicalObjectAdmissionService");

const {
  decorateRelationshipWithIdentityEvidence
} = require("../relationships/relationshipIdentityEvidenceService");

const {
  evaluateAosRailMembership,
  isExplicitAosSystemIndexObject
} = require("../relationships/aosSystemIndexMembershipPolicy");

const {
  withAuthorityPolicyReadScope
} = require("../../authority/IXIAuthorityPolicyResolver");

const { buildAosMembershipReview } = require("../relationships/aosMembershipReview");

function buildProjectionMap(
  projections = []
) {
  const map = {};

  projections.forEach(projection => {
    if (!projection?.containerId) {
      return;
    }

    map[projection.containerId] =
      projection;
  });

  return map;
}

function buildRailProjectionMap(relationships = [], objects = []) {
  const map = {};
  const objectsById = new Map(
    objects.map(object => [cleanText(object?.objectId), object])
  );
  const projectedMembersByOwner = new Map();
  const governedMemberObjectIds = new Set(
    relationships
      .filter(relationship =>
        relationship?.status === "active" &&
        relationship?.behaviorId === EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP
      )
      .map(relationship => cleanText(relationship?.sourceObjectId))
      .filter(Boolean)
  );

  relationships
    .filter(relationship => {
      if (relationship?.status !== "active") return false;
      if (relationship?.behaviorId === EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP) {
        return evaluateAosRailMembership({
          sourceObject: objectsById.get(cleanText(relationship?.sourceObjectId)),
          targetObject: objectsById.get(cleanText(relationship?.targetObjectId))
        }).allowed;
      }
      if (cleanText(relationship?.behaviorId)) return false;

      const sourceObjectId = cleanText(relationship?.sourceObjectId);
      const targetObjectId = cleanText(relationship?.targetObjectId);
      const sourceObject = objectsById.get(sourceObjectId);
      const targetObject = objectsById.get(targetObjectId);

      /*
       * Legacy direct-container state is read-only migration evidence. It
       * cannot compete with a governed rail membership, even when the two
       * edges name different owners. This prevents stale exclusive placement
       * from swallowing an Object that already has governed membership.
       */
      if (governedMemberObjectIds.has(sourceObjectId)) return false;

      /*
       * System Indexes are root peer collections. A stale legacy containment
       * record must never project one System Index inside another.
       */
      if (
        isExplicitAosSystemIndexObject(sourceObject) ||
        !evaluateAosRailMembership({
          sourceObject,
          targetObject
        }).allowed
      ) {
        return false;
      }

      return (
        cleanText(sourceObject?.directContainerId) === targetObjectId
      );
    })
    .sort((left, right) =>
      Number(right?.behaviorId === EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP) -
        Number(left?.behaviorId === EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP) ||
      cleanText(left?.orderKey).localeCompare(cleanText(right?.orderKey)) ||
      cleanText(left?.createdAt).localeCompare(cleanText(right?.createdAt)) ||
      cleanText(left?.relationshipId).localeCompare(cleanText(right?.relationshipId))
    )
    .forEach(relationship => {
      const sourceIdentity = resolveCanonicalObjectIdentity({
        entityId: relationship.entityId,
        objectId: relationship.sourceObjectId
      });
      const targetIdentity = resolveCanonicalObjectIdentity({
        entityId: relationship.entityId,
        objectId: relationship.targetObjectId
      });
      const railOwnerObjectId = cleanText(relationship.targetObjectId);
      const projectedMemberKey = `${railOwnerObjectId}\u0000${sourceIdentity.objectId}`;
      if (projectedMembersByOwner.has(projectedMemberKey)) return;
      projectedMembersByOwner.set(projectedMemberKey, relationship.relationshipId);
      const governed =
        relationship.behaviorId === EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP;
      if (!map[railOwnerObjectId]) {
        map[railOwnerObjectId] = {
          railOwnerObjectId,
          railOwnerPassportId: targetIdentity.passportId,
          railOwnerIdentity: {
            objectId: targetIdentity.objectId,
            passportId: targetIdentity.passportId,
            entityId: targetIdentity.entityId
          },
          behaviorId: EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP,
          members: []
        };
      }
      map[railOwnerObjectId].members.push({
        objectId: sourceIdentity.objectId,
        passportId: sourceIdentity.passportId,
        sourceIdentity: {
          objectId: sourceIdentity.objectId,
          passportId: sourceIdentity.passportId,
          entityId: sourceIdentity.entityId
        },
        targetIdentity: {
          objectId: targetIdentity.objectId,
          passportId: targetIdentity.passportId,
          entityId: targetIdentity.entityId
        },
        relationshipId: relationship.relationshipId,
        relationshipRevision: Number(relationship.revision || 0),
        relationshipStatus: relationship.status,
        behaviorId: relationship.behaviorId || null,
        definitionId: relationship.definitionId || null,
        orderKey: relationship.orderKey || null,
        customerLabel: relationship.relationshipLabel || null,
        migrationEvidence: governed
          ? null
          : {
              kind: "legacy-direct-container-corroborated.v1",
              readOnly: true,
              directContainerId: railOwnerObjectId
            }
      });
    });

  return map;
}

async function loadAosEnvironmentWithinAuthorityScope({
  ownerUserId,
  displayName = "IXI Entity",
  metadata = {},

  trustedEntity = null,
  authorityPrincipal = null,
  strictAuthorization = false,
  allowProvisioning = true
}) {
  const normalizedUserId =
    cleanText(ownerUserId);

  if (!normalizedUserId) {
    throw new MosError(
      "AOS_AUTHENTICATED_USER_REQUIRED",
      "Authenticated user ID is required.",
      null,
      401
    );
  }

  let bootstrap = null;

  if (trustedEntity) {
    bootstrap = {
      account: {
        accountId:
          null,

        tenantId:
          null,

        primaryEntityId:
          trustedEntity.entityId,

        status:
          "active",

        settings:
          {}
      },

      entity:
        trustedEntity,

      membership: {
        principalType:
          "ixi-principal",

        principalId:
          authorityPrincipal
            ?.principalId ||
          null,

        role:
          null,

        permissions:
          authorityPrincipal
            ?.directGrants ||
          []
      },

      created:
        false
    };
  } else {
    bootstrap =
      allowProvisioning
        ? ensureAosAccount({
            ownerUserId: normalizedUserId,
            displayName: cleanText(displayName) || "IXI Entity",
            metadata
          })
        : {
            ...getAosAccountForUser(normalizedUserId),
            created: { account: false, entity: false, membership: false }
          };
  }

  const {
    account,
    entity,
    membership,
    created
  } = bootstrap;

  const effectiveAuthorityPrincipal =
    authorityPrincipal ||
    principalFromMosMembership(membership, {
      strictAuthorization
    });

  const allObjects =
    listObjects({
      entityId:
        entity.entityId,
      status: "active"
    });

  const inventoryEntityPassportId = cleanText(effectiveAuthorityPrincipal?.entityPassportId || membership?.entityPassportId || entity?.passportId);
  const inventory = inventoryEntityPassportId ? await loadInventory(inventoryEntityPassportId) : null;
  const objects = allObjects.flatMap(object => {
    const state = normalizedPassportIds(object).map(passportId => inventory?.current?.[passportId]).find(Boolean);
    if (state?.state === "sold") return [];
    return [{ ...object, ...(state ? { inventoryLifecycle: state } : {}), ...(state?.forcePrivate ? { machineAccess: "private", fields: { ...object.fields, machineAccess: "private" } } : {}) }];
  });

  const discoverableObjects =
    effectiveAuthorityPrincipal
      ? await filterDiscoverableObjects({
          principal:
            effectiveAuthorityPrincipal,

          objects
        })
      : objects;

  const authorizedObjects = await Promise.all(
    discoverableObjects.map(async object => ({
      ...object,
      ...(await buildMosObjectActorAuthority({
        principal: effectiveAuthorityPrincipal,
        object
      }))
    }))
  );

  const authorizedObjectById = new Map(
    authorizedObjects.map(object => [object.objectId, object])
  );

  const visibleObjectIds =
    new Set(
      discoverableObjects.map(
        object =>
          object.objectId
      )
    );

  /* Return an edge only when both endpoints are discoverable. */
  const relationships =
    listRelationships({
      entityId: entity.entityId,
      status: "active"
    }).filter(relationship =>
      visibleObjectIds.has(relationship.sourceObjectId) &&
      visibleObjectIds.has(relationship.targetObjectId)
    ).map(relationship => decorateRelationshipWithIdentityEvidence(relationship));

  const rootObjects =
    discoverableObjects.filter(
      object =>
        !object.directContainerId ||
        !visibleObjectIds.has(
          object.directContainerId
        )
    ).map(object => authorizedObjectById.get(object.objectId));

  const membershipReview = buildAosMembershipReview(relationships, discoverableObjects);

  const projections = objects.length < allObjects.length
    ? projectVisibleInventory({ entityId: entity.entityId, visibleObjects: discoverableObjects })
    : rebuildEntityProjections(entity.entityId);

  /*
   * SECURITY:
   *
   * Projection records can reveal the
   * existence, counts, values or composition
   * of secured containers.
   *
   * Only projections belonging to objects
   * already authorized for discovery may
   * leave IX-Core.
   */

  const discoverableProjections =
    projections.filter(
      projection =>
        visibleObjectIds.has(
          projection.containerId
        )
    );

  return {
    account: {
      accountId:
        account.accountId,

      tenantId:
        account.tenantId,

      primaryEntityId:
        account.primaryEntityId,

      status:
        account.status,

      settings:
        account.settings || {}
    },

    principal: {
      principalType:
        membership.principalType,

      principalId:
        membership.principalId,

      role:
        membership.role,

      permissions:
        membership.permissions || []
    },

    entity,

    objects:
      authorizedObjects.map(object => ({
        ...object,
        ...(membershipReview[object.objectId]
          ? { membershipReview: membershipReview[object.objectId] }
          : {})
      })),

    relationships,

    railProjections:
      buildRailProjectionMap(
        relationships,
        discoverableObjects
      ),

    rootObjects,

    projections:
      buildProjectionMap(
        discoverableProjections
      ),

    bootstrap: created
  };
}

function loadAosEnvironment(options = {}) {
  const read = () => withAuthorityPolicyReadScope(() => loadAosEnvironmentWithinAuthorityScope(options));
  return options.allowProvisioning === false ? withCanonicalReadScope(read) : read();
}

module.exports = {
  buildRailProjectionMap,
  loadAosEnvironment
};
