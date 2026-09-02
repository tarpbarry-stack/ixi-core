const {
  ensureAosAccount
} = require("./aosAccountService");

const {
  listObjects
} = require("../objects/objectService");

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
  filterDiscoverableObjects
} = require(
  "../../authority/IXIAuthorityMosBridge"
);

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

async function loadAosEnvironment({
  ownerUserId,
  displayName = "IXI Entity",
  metadata = {},

  trustedEntity = null,
  authorityPrincipal = null
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
      ensureAosAccount({
        ownerUserId:
          normalizedUserId,

        displayName:
          cleanText(displayName) ||
          "IXI Entity",

        metadata
      });
  }

  const {
    account,
    entity,
    membership,
    created
  } = bootstrap;

  const objects =
    listObjects({
      entityId:
        entity.entityId,
      status: "active"
    });

  const discoverableObjects =
    authorityPrincipal
      ? await filterDiscoverableObjects({
          principal:
            authorityPrincipal,

          objects
        })
      : objects;

  const visibleObjectIds =
    new Set(
      discoverableObjects.map(
        object =>
          object.objectId
      )
    );

  const rootObjects =
    discoverableObjects.filter(
      object =>
        !object.directContainerId ||
        !visibleObjectIds.has(
          object.directContainerId
        )
    );

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
      discoverableObjects,

    rootObjects,

    projections:
      buildProjectionMap(
        discoverableProjections
      ),

    bootstrap: created
  };
}

module.exports = {
  loadAosEnvironment
};
