const {
  readJsonFile,
  writeJsonFileAtomic
} = require("../storage/jsonStore");

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  createMosId
} = require("../objects/objectIdEngine");

const {
  cleanText,
  nowIso
} = require("../util/normalize");

const {
  MosError
} = require("../errors/MosError");

const {
  FACE_PERMISSIONS,
  requireFacePermission
} = require("./facePermissionService");

const {
  getPublishedFaceVersion
} = require("./faceLibraryService");

const {
  requireFaceCompatibleWithTarget
} = require("./faceTargetValidationService");

const {
  assignmentTargetMatchesObject
} = require("./faceAssignmentTargetMatcher");


function readAssignments() {
  return readJsonFile(
    MOS_PATHS.faceAssignments,
    {}
  );
}


function cleanArray(value) {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .map(cleanText)
            .filter(Boolean)
        )
      ]
    : [];
}


function requireEntityId(value) {
  const entityId =
    cleanText(value);

  if (!entityId) {
    throw new MosError(
      "FACE_ENTITY_REQUIRED",
      "entityId is required.",
      null,
      400
    );
  }

  return entityId;
}


function normalizeTarget(
  rawTarget
) {
  const target =
    rawTarget &&
    typeof rawTarget === "object" &&
    !Array.isArray(rawTarget)
      ? rawTarget
      : {};

  const normalized = {
    objectIds:
      cleanArray(
        target.objectIds
      ),

    objectDefinitionIds:
      cleanArray(
        target.objectDefinitionIds
      ),

    requiredCapabilities:
      cleanArray(
        target.requiredCapabilities
      )
  };

  if (
    normalized.objectIds.length === 0 &&
    normalized.objectDefinitionIds.length === 0 &&
    normalized.requiredCapabilities.length === 0
  ) {
    throw new MosError(
      "FACE_ASSIGNMENT_TARGET_REQUIRED",
      "A Face assignment requires objectIds, objectDefinitionIds, or requiredCapabilities.",
      null,
      400
    );
  }

  return normalized;
}


function createFaceAssignment({
  entityId,
  principalId,
  faceAppId,
  target,
  metadata = {}
}) {
  const normalizedEntityId =
    requireEntityId(entityId);

  const membership =
    requireFacePermission({
      entityId:
        normalizedEntityId,

      principalId,

      permission:
        FACE_PERMISSIONS.ASSIGN
    });

  const {
    record,
    version
  } =
    getPublishedFaceVersion({
      entityId:
        normalizedEntityId,

      faceAppId
    });

  const normalizedTarget =
    normalizeTarget(target);

  /*
   * Validate the published Face against
   * the actual customer-defined/persisted
   * objects matched by this target.
   *
   * Customer names and identifiers remain
   * authoritative. IXI validates only the
   * persisted data/capability contract.
   */
  const targetValidation =
    requireFaceCompatibleWithTarget({
      entityId:
        normalizedEntityId,

      principalId,

      definition:
        version.definition,

      target:
        normalizedTarget,

      permissionScopes:
        Array.isArray(
          membership.permissions
        )
          ? membership.permissions
          : []
    });

  const assignments =
    readAssignments();

  const duplicate =
    Object.values(assignments)
      .find(
        assignment =>
          assignment.entityId ===
            normalizedEntityId &&
          assignment.faceAppId ===
            record.faceAppId &&
          assignment.status ===
            "active" &&
          JSON.stringify(
            assignment.target
          ) ===
            JSON.stringify(
              normalizedTarget
            )
      );

  if (duplicate) {
    return {
      assignment:
        duplicate,
      duplicate: true
    };
  }

  const assignmentId =
    createMosId(
      "faceassignment"
    );

  const timestamp =
    nowIso();

  const assignment = {
    assignmentId,

    entityId:
      normalizedEntityId,

    faceAppId:
      record.faceAppId,

    /*
     * Assignment points at the Face identity,
     * while resolution follows the current
     * active published version.
     */
    assignedVersionId:
      version.versionId,

    target:
      normalizedTarget,

    status:
      "active",

    createdBy:
      cleanText(principalId),

    createdAt:
      timestamp,

    updatedAt:
      timestamp,

    removedBy:
      null,

    removedAt:
      null,

    metadata:
      metadata &&
      typeof metadata ===
        "object" &&
      !Array.isArray(metadata)
        ? {
            ...metadata
          }
        : {}
  };

  assignments[
    assignmentId
  ] = assignment;

  writeJsonFileAtomic(
    MOS_PATHS.faceAssignments,
    assignments
  );

  return {
    assignment,
    duplicate: false,
    validation:
      targetValidation
  };
}


function listFaceAssignments({
  entityId,
  principalId,
  faceAppId = null
}) {
  const normalizedEntityId =
    requireEntityId(entityId);

  requireFacePermission({
    entityId:
      normalizedEntityId,

    principalId,

    permission:
      FACE_PERMISSIONS
        .LIBRARY_READ
  });

  const requestedFaceAppId =
    cleanText(faceAppId);

  return Object.values(
    readAssignments()
  )
    .filter(
      assignment =>
        assignment.entityId ===
          normalizedEntityId
    )
    .filter(
      assignment =>
        !requestedFaceAppId ||
        assignment.faceAppId ===
          requestedFaceAppId
    )
    .sort(
      (a, b) =>
        String(
          b.createdAt || ""
        ).localeCompare(
          String(
            a.createdAt || ""
          )
        )
    );
}


function removeFaceAssignment({
  entityId,
  principalId,
  assignmentId
}) {
  const normalizedEntityId =
    requireEntityId(entityId);

  requireFacePermission({
    entityId:
      normalizedEntityId,

    principalId,

    permission:
      FACE_PERMISSIONS.UNASSIGN
  });

  const normalizedAssignmentId =
    cleanText(assignmentId);

  const assignments =
    readAssignments();

  const assignment =
    assignments[
      normalizedAssignmentId
    ];

  if (
    !assignment ||
    assignment.entityId !==
      normalizedEntityId
  ) {
    throw new MosError(
      "FACE_ASSIGNMENT_NOT_FOUND",
      "Face assignment was not found.",
      {
        assignmentId:
          normalizedAssignmentId
      },
      404
    );
  }

  if (
    assignment.status ===
      "removed"
  ) {
    return {
      assignment,
      alreadyRemoved: true
    };
  }

  const timestamp =
    nowIso();

  const nextAssignment = {
    ...assignment,

    status:
      "removed",

    updatedAt:
      timestamp,

    removedBy:
      cleanText(principalId),

    removedAt:
      timestamp
  };

  assignments[
    normalizedAssignmentId
  ] = nextAssignment;

  writeJsonFileAtomic(
    MOS_PATHS.faceAssignments,
    assignments
  );

  return {
    assignment:
      nextAssignment,
    alreadyRemoved: false
  };
}


function assignmentMatchesObject(
  assignment,
  object
) {
  if (
    !assignment ||
    assignment.status !==
      "active"
  ) {
    return false;
  }

  return assignmentTargetMatchesObject(
    assignment.target,
    object
  );
}


module.exports = {
  createFaceAssignment,
  listFaceAssignments,
  removeFaceAssignment,
  assignmentMatchesObject
};
