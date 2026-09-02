const {
  readJsonFile
} = require("../storage/jsonStore");

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  objectsMatchingTarget,
  validateFaceForObjects
} = require("./faceTargetValidationService");


function getActiveAssignmentsForFace({
  entityId,
  faceAppId
}) {
  const store =
    readJsonFile(
      MOS_PATHS.faceAssignments,
      {}
    );

  return Object.values(store)
    .filter(
      assignment =>
        assignment?.entityId ===
          entityId &&
        assignment?.faceAppId ===
          faceAppId &&
        assignment?.status ===
          "active"
    );
}


function validateFacePublication({
  entityId,
  principalId,
  faceAppId,
  definition,
  permissionScopes = []
}) {
  const assignments =
    getActiveAssignmentsForFace({
      entityId,
      faceAppId
    });

  /*
   * A new Face may legitimately be
   * published before its first assignment.
   */
  if (!assignments.length) {
    return {
      compatible: true,
      checkedAssignments: 0,
      checkedObjects: 0,
      results: [],
      warnings: []
    };
  }

  const results = [];
  const warnings = [];

  for (
    const assignment
    of assignments
  ) {
    const objects =
      objectsMatchingTarget({
        entityId,
        target:
          assignment.target
      });

    /*
     * A capability/definition assignment
     * can temporarily have zero objects.
     * That is not itself a publishing error.
     */
    if (!objects.length) {
      warnings.push({
        code:
          "FACE_ASSIGNMENT_CURRENTLY_EMPTY",

        assignmentId:
          assignment.assignmentId,

        target:
          assignment.target
      });

      continue;
    }

    const validation =
      validateFaceForObjects({
        entityId,
        principalId,
        definition,
        objects,
        permissionScopes
      });

    results.push({
      assignmentId:
        assignment.assignmentId,

      target:
        assignment.target,

      compatible:
        validation.compatible,

      checkedObjects:
        validation.checkedObjects,

      results:
        validation.results
    });
  }

  const incompatible =
    results.filter(
      result =>
        !result.compatible
    );

  return {
    compatible:
      incompatible.length === 0,

    checkedAssignments:
      assignments.length,

    checkedObjects:
      results.reduce(
        (total, result) =>
          total +
          Number(
            result.checkedObjects || 0
          ),
        0
      ),

    results,
    warnings,

    incompatible
  };
}


module.exports = {
  getActiveAssignmentsForFace,
  validateFacePublication
};
