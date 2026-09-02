const {
  readJsonFile
} = require("../storage/jsonStore");

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  cleanText
} = require("../util/normalize");

const {
  MosError
} = require("../errors/MosError");

const {
  createAuthorizedFaceDataManifest
} = require("./faceDataManifestService");

const {
  validateFaceAgainstManifest
} = require("./faceCompatibilityService");

const {
  assignmentTargetMatchesObject
} = require("./faceAssignmentTargetMatcher");


function readObjects() {
  return readJsonFile(
    MOS_PATHS.objects,
    {}
  );
}


function getEntityObjects(
  entityId
) {
  const normalizedEntityId =
    cleanText(entityId);

  return Object.values(
    readObjects()
  ).filter(
    object =>
      object?.entityId ===
        normalizedEntityId &&
      object?.status !==
        "deleted" &&
      !object?.softDeletedAt
  );
}


function objectsMatchingTarget({
  entityId,
  target
}) {
  return getEntityObjects(
    entityId
  ).filter(
    object =>
      assignmentTargetMatchesObject(
        target,
        object
      )
  );
}


function validateFaceForObjects({
  entityId,
  principalId,
  definition,
  objects,
  permissionScopes = []
}) {
  const results =
    objects.map(
      object => {
        const manifest =
          createAuthorizedFaceDataManifest({
            entityId,
            principalId,
            object,
            permissionScopes
          });

        const compatibility =
          validateFaceAgainstManifest({
            definition,
            manifest
          });

        return {
          objectId:
            object.objectId,

          definitionId:
            manifest.definitionId,

          displayName:
            manifest.identity
              ?.displayName ||
            null,

          compatible:
            compatibility.compatible,

          errors:
            compatibility.errors,

          warnings:
            compatibility.warnings
        };
      }
    );

  return {
    compatible:
      results.every(
        result =>
          result.compatible
      ),

    checkedObjects:
      results.length,

    results
  };
}


function requireFaceCompatibleWithTarget({
  entityId,
  principalId,
  definition,
  target,
  permissionScopes = []
}) {
  const objects =
    objectsMatchingTarget({
      entityId,
      target
    });

  if (!objects.length) {
    throw new MosError(
      "FACE_ASSIGNMENT_TARGET_EMPTY",
      "No current objects match this Face assignment target.",
      {
        target
      },
      409
    );
  }

  const validation =
    validateFaceForObjects({
      entityId,
      principalId,
      definition,
      objects,
      permissionScopes
    });

  if (!validation.compatible) {
    throw new MosError(
      "FACE_TARGET_INCOMPATIBLE",
      "The Face App requires data or capabilities unavailable on one or more target objects.",
      {
        checkedObjects:
          validation.checkedObjects,

        incompatible:
          validation.results.filter(
            result =>
              !result.compatible
          )
      },
      409
    );
  }

  return validation;
}


module.exports = {
  objectsMatchingTarget,
  validateFaceForObjects,
  requireFaceCompatibleWithTarget
};
