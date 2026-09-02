const {
  cleanText
} = require("../util/normalize");

const {
  readJsonFile
} = require("../storage/jsonStore");

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  getPublishedFaceVersion
} = require("./faceLibraryService");

const {
  assignmentMatchesObject
} = require("./faceAssignmentService");

const {
  createAuthorizedFaceDataManifest
} = require("./faceDataManifestService");

const {
  validateFaceAgainstManifest
} = require("./faceCompatibilityService");


function resolveAssignedFaces({
  entityId,
  principalId = null,
  permissionScopes = [],
  object
}) {
  const normalizedEntityId =
    cleanText(entityId);

  if (
    !normalizedEntityId ||
    !object
  ) {
    return [];
  }

  const assignments =
    readJsonFile(
      MOS_PATHS.faceAssignments,
      {}
    );

  const matches =
    Object.values(assignments)
      .filter(
        assignment =>
          assignment.entityId ===
            normalizedEntityId &&
          assignment.status ===
            "active"
      )
      .filter(
        assignment =>
          assignmentMatchesObject(
            assignment,
            object
          )
      );

  const manifest =
    createAuthorizedFaceDataManifest({
      entityId:
        normalizedEntityId,

      principalId,

      object,

      permissionScopes
    });

  const resolved = [];

  for (
    const assignment of matches
  ) {
    try {
      const {
        record,
        version
      } =
        getPublishedFaceVersion({
          entityId:
            normalizedEntityId,

          faceAppId:
            assignment.faceAppId
        });

      const compatibility =
        validateFaceAgainstManifest({
          definition:
            version.definition,

          manifest
        });

      /*
       * Fail closed.
       * Never render a Face whose current
       * data contract is no longer valid.
       */
      if (
        !compatibility.compatible
      ) {
        continue;
      }

      resolved.push({
        assignmentId:
          assignment.assignmentId,

        faceAppId:
          record.faceAppId,

        faceSlug:
          record.faceSlug,

        label:
          record.label,

        faceNumber:
          record.faceNumber,

        versionId:
          version.versionId,

        version:
          version.version,

        definition:
          version.definition,

        assignmentTarget:
          assignment.target,

        compatibility: {
          compatible: true,
          warnings:
            compatibility.warnings
        }
      });
    } catch {
      /*
       * Retired, broken, unauthorized or
       * incompatible Faces do not poison
       * the entire object console.
       */
      continue;
    }
  }

  return resolved.sort(
    (a, b) =>
      Number(
        a.faceNumber || 0
      ) -
      Number(
        b.faceNumber || 0
      ) ||
      String(
        a.label || ""
      ).localeCompare(
        String(
          b.label || ""
        )
      )
  );
}


module.exports = {
  resolveAssignedFaces
};
