const {
  readJsonFile
} = require("../storage/jsonStore");

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  MosError
} = require("../errors/MosError");

const {
  cleanText
} = require("../util/normalize");


const FACE_PERMISSIONS =
  Object.freeze({
    LIBRARY_READ:
      "face.library.read",

    CREATE:
      "face.create",

    EDIT:
      "face.edit",

    PUBLISH:
      "face.publish",

    RETIRE:
      "face.retire",

    ASSIGN:
      "face.assign",

    UNASSIGN:
      "face.unassign",

    MANAGE_PERMISSIONS:
      "face.permissions.manage"
  });


function readMemberships() {
  return readJsonFile(
    MOS_PATHS.memberships,
    {}
  );
}


function normalizePermissions(
  permissions
) {
  return Array.isArray(permissions)
    ? permissions
        .map(cleanText)
        .filter(Boolean)
    : [];
}


function findActiveMembership({
  entityId,
  principalId
}) {
  const normalizedEntityId =
    cleanText(entityId);

  const normalizedPrincipalId =
    cleanText(principalId);

  if (
    !normalizedEntityId ||
    !normalizedPrincipalId
  ) {
    return null;
  }

  const memberships =
    readMemberships();

  return (
    Object.values(memberships).find(
      membership =>
        membership?.status ===
          "active" &&
        membership?.entityId ===
          normalizedEntityId &&
        membership?.principalType ===
          "sharetribe-user" &&
        membership?.principalId ===
          normalizedPrincipalId
    ) ||
    null
  );
}


function membershipAllows(
  membership,
  permission
) {
  if (!membership) {
    return false;
  }

  const permissions =
    normalizePermissions(
      membership.permissions
    );

  if (
    permissions.includes("*")
  ) {
    return true;
  }

  return permissions.includes(
    cleanText(permission)
  );
}


function requireFacePermission({
  entityId,
  principalId,
  permission
}) {
  const membership =
    findActiveMembership({
      entityId,
      principalId
    });

  if (!membership) {
    throw new MosError(
      "FACE_MEMBERSHIP_REQUIRED",
      "An active entity membership is required.",
      {
        entityId:
          cleanText(entityId),

        principalId:
          cleanText(principalId)
      },
      403
    );
  }

  if (
    !membershipAllows(
      membership,
      permission
    )
  ) {
    throw new MosError(
      "FACE_PERMISSION_DENIED",
      "The current membership does not permit this Face Library action.",
      {
        entityId:
          cleanText(entityId),

        principalId:
          cleanText(principalId),

        permission:
          cleanText(permission)
      },
      403
    );
  }

  return membership;
}


module.exports = {
  FACE_PERMISSIONS,
  findActiveMembership,
  membershipAllows,
  requireFacePermission
};
