const {
  cleanText
} = require("../util/normalize");


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


function getObjectDefinitionId(
  object
) {
  return cleanText(
    object?.definitionId ||
    object?.objectDefinitionId ||
    object?.customerObjectTypeId ||
    object?.templateId
  );
}


function getObjectCapabilities(
  object
) {
  const capabilities =
    new Set();

  if (
    object?.capabilities &&
    typeof object.capabilities ===
      "object" &&
    !Array.isArray(
      object.capabilities
    )
  ) {
    for (
      const [
        capability,
        enabled
      ] of Object.entries(
        object.capabilities
      )
    ) {
      if (enabled === true) {
        capabilities.add(
          cleanText(capability)
        );
      }
    }
  }

  for (
    const capability
    of cleanArray(
      object?.capabilityIds
    )
  ) {
    capabilities.add(
      capability
    );
  }

  return capabilities;
}


function assignmentTargetMatchesObject(
  target,
  object
) {
  if (
    !target ||
    !object
  ) {
    return false;
  }

  const objectId =
    cleanText(
      object.objectId ||
      object.id
    );

  const definitionId =
    getObjectDefinitionId(
      object
    );

  const objectIds =
    cleanArray(
      target.objectIds
    );

  const definitionIds =
    cleanArray(
      target.objectDefinitionIds
    );

  const requiredCapabilities =
    cleanArray(
      target.requiredCapabilities
    );

  /*
   * Explicit object assignment.
   */
  if (
    objectIds.length &&
    objectIds.includes(
      objectId
    )
  ) {
    return true;
  }

  /*
   * Customer definition assignment.
   * No business meaning is inferred
   * from labels or names.
   */
  if (
    definitionIds.length &&
    definitionId &&
    definitionIds.includes(
      definitionId
    )
  ) {
    return true;
  }

  /*
   * Capability assignment.
   */
  if (
    requiredCapabilities.length
  ) {
    const capabilities =
      getObjectCapabilities(
        object
      );

    return requiredCapabilities
      .every(
        capability =>
          capabilities.has(
            capability
          )
      );
  }

  return false;
}


module.exports = {
  assignmentTargetMatchesObject,
  getObjectDefinitionId,
  getObjectCapabilities
};
