const {
  cleanText
} = require("../util/normalize");


function cleanArray(value) {
  return Array.isArray(value)
    ? [...new Set(
        value
          .map(cleanText)
          .filter(Boolean)
      )]
    : [];
}


function normalizeRequestedCapability(
  capabilityId
) {
  const value =
    cleanText(capabilityId);

  /*
   * Legacy Face definitions may still ask
   * for field:businessIdentifier.
   * Canonical identity capability is now:
   * identity:businessIdentifier
   */
  if (
    value ===
      "field:businessIdentifier"
  ) {
    return "identity:businessIdentifier";
  }

  return value;
}


function validateFaceAgainstManifest({
  definition,
  manifest
}) {
  if (
    !manifest ||
    manifest.authorized !== true
  ) {
    return {
      compatible: false,

      errors: [
        {
          code:
            "FACE_MANIFEST_UNAUTHORIZED",

          reason:
            manifest?.reason ||
            "unknown"
        }
      ],

      warnings: []
    };
  }

  const available =
    new Set(
      cleanArray(
        manifest.capabilities
      )
    );

  const availablePermissions =
    new Set(
      cleanArray(
        manifest.permissionScopes
      )
    );

  const requiredData =
    cleanArray([
      ...cleanArray(
        definition?.dataCapabilities
      ),

      ...cleanArray(
        definition?.requiredCapabilities
      )
    ]).map(
      normalizeRequestedCapability
    );

  const optionalData =
    cleanArray(
      definition?.optionalCapabilities
    ).map(
      normalizeRequestedCapability
    );

  const requiredObjectCapabilities =
    cleanArray(
      definition
        ?.compatibleObjectCapabilities
    );

  const compatibleObjectDefinitionIds =
    cleanArray(
      definition
        ?.compatibleObjectDefinitionIds
    );

  const requiredPermissions =
    cleanArray(
      definition
        ?.permissionScopes
    );

  const errors = [];
  const warnings = [];


  for (
    const capabilityId
    of requiredData
  ) {
    if (
      !available.has(
        capabilityId
      )
    ) {
      errors.push({
        code:
          "FACE_REQUIRED_DATA_MISSING",

        capabilityId
      });
    }
  }


  for (
    const capability
    of requiredObjectCapabilities
  ) {
    const capabilityId =
      capability.startsWith(
        "capability:"
      )
        ? capability
        : `capability:${capability}`;

    if (
      !available.has(
        capabilityId
      )
    ) {
      errors.push({
        code:
          "FACE_OBJECT_CAPABILITY_MISSING",

        capabilityId
      });
    }
  }


  if (
    compatibleObjectDefinitionIds.length
  ) {
    const manifestDefinitionId =
      cleanText(
        manifest.definitionId
      );

    if (
      !manifestDefinitionId ||
      !compatibleObjectDefinitionIds.includes(
        manifestDefinitionId
      )
    ) {
      errors.push({
        code:
          "FACE_OBJECT_DEFINITION_INCOMPATIBLE",

        definitionId:
          manifestDefinitionId ||
          null,

        allowedDefinitionIds:
          compatibleObjectDefinitionIds
      });
    }
  }


  for (
    const capabilityId
    of optionalData
  ) {
    if (
      !available.has(
        capabilityId
      )
    ) {
      warnings.push({
        code:
          "FACE_OPTIONAL_DATA_MISSING",

        capabilityId
      });
    }
  }


  for (
    const permissionScope
    of requiredPermissions
  ) {
    if (
      !availablePermissions.has(
        "*"
      ) &&
      !availablePermissions.has(
        permissionScope
      )
    ) {
      errors.push({
        code:
          "FACE_PERMISSION_SCOPE_MISSING",

        permissionScope
      });
    }
  }


  return {
    compatible:
      errors.length === 0,

    errors,
    warnings,

    availableCapabilityCount:
      available.size
  };
}


module.exports = {
  validateFaceAgainstManifest
};
