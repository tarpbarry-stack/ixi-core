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
  rebuildEntityProjections
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
  resolveCanonicalObjectIdentity
} = require("../identity/canonicalObjectAdmissionService");

const {
  decorateRelationshipWithIdentityEvidence
} = require("../relationships/relationshipIdentityEvidenceService");

const {
  withAuthorityPolicyReadScope
} = require("../../authority/IXIAuthorityPolicyResolver");

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

  relationships
    .filter(relationship =>
      relationship?.status === "active" && (
        relationship?.behaviorId === EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP ||
        (
          !cleanText(relationship?.behaviorId) &&
          cleanText(
            objectsById.get(cleanText(relationship?.sourceObjectId))
              ?.directContainerId
          ) === cleanText(relationship?.targetObjectId)
        )
      )
    )
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

  const objects =
    listObjects({
      entityId:
        entity.entityId,
      status: "active"
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

  const projections =
    rebuildEntityProjections(
      entity.entityId
    );

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
      authorizedObjects,

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
  return withAuthorityPolicyReadScope(
    () => loadAosEnvironmentWithinAuthorityScope(options)
  );
}

module.exports = {
  buildRailProjectionMap,
  loadAosEnvironment
};
