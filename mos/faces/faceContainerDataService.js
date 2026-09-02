const {
  listDirectContents
} = require(
  "../containers/containerService"
);

const {
  getContainerProjection,
  getBranchSummary
} = require(
  "../projections/projectionService"
);

const {
  cleanText
} = require("../util/normalize");


function getObjectContainerData(
  object
) {
  if (!object) {
    return null;
  }

  const objectId =
    cleanText(
      object.objectId
    );

  const canContain =
    object.capabilities
      ?.canContain === true;

  if (
    !objectId ||
    !canContain
  ) {
    return null;
  }

  /*
   * Source services own all calculations.
   * This adapter does not calculate value,
   * counts, descendants or aggregates.
   */
  const directChildren =
    listDirectContents(
      objectId
    );

  const projection =
    getContainerProjection(
      objectId
    );

  const branchSummary =
    getBranchSummary(
      objectId
    );

  return {
    canContain: true,

    directChildCount:
      directChildren.length,

    directChildren:
      directChildren.map(
        child => ({
          objectId:
            child.objectId,

          displayName:
            cleanText(
              child.displayName
            ),

          directContainerId:
            child.directContainerId ||
            null,

          definitionId:
            cleanText(
              child.definitionId ||
              child.objectDefinitionId ||
              child.customerObjectTypeId
            ) || null,

          capabilities:
            child.capabilities &&
            typeof child.capabilities ===
              "object"
              ? {
                  ...child.capabilities
                }
              : {}
        })
      ),

    projection:
      projection || null,

    branchSummary:
      branchSummary || null
  };
}


module.exports = {
  getObjectContainerData
};
