const {
  listRelationships
} = require(
  "../relationships/relationshipService"
);

const {
  cleanText
} = require("../util/normalize");


function getObjectRelationships({
  entityId,
  objectId
}) {
  const normalizedEntityId =
    cleanText(entityId);

  const normalizedObjectId =
    cleanText(objectId);

  if (
    !normalizedEntityId ||
    !normalizedObjectId
  ) {
    return {
      records: [],
      relatedObjectIds: [],
      relationshipTypes: [],
      count: 0
    };
  }

  /*
   * relationshipService owns truth.
   * Face adapter only composes the records
   * involving this object.
   */
  const relationships =
    listRelationships({
      entityId:
        normalizedEntityId,
      status: "active"
    })
      .filter(
        relationship =>
          relationship.sourceObjectId ===
            normalizedObjectId ||
          relationship.targetObjectId ===
            normalizedObjectId
      )
      .map(
        relationship => {
          const direction =
            relationship.sourceObjectId ===
              normalizedObjectId
              ? "outbound"
              : "inbound";

          const relatedObjectId =
            direction === "outbound"
              ? relationship.targetObjectId
              : relationship.sourceObjectId;

          return {
            relationshipId:
              relationship.relationshipId,

            relationshipType:
              cleanText(
                relationship.relationshipType
              ),

            direction,

            sourceObjectId:
              relationship.sourceObjectId,

            targetObjectId:
              relationship.targetObjectId,

            relatedObjectId,

            metadata:
              relationship.metadata &&
              typeof relationship.metadata ===
                "object"
                ? {
                    ...relationship.metadata
                  }
                : {},

            createdAt:
              relationship.createdAt ||
              null,

            updatedAt:
              relationship.updatedAt ||
              null
          };
        }
      );

  return {
    records:
      relationships,

    relatedObjectIds:
      [
        ...new Set(
          relationships
            .map(
              relationship =>
                relationship.relatedObjectId
            )
            .filter(Boolean)
        )
      ],

    relationshipTypes:
      [
        ...new Set(
          relationships
            .map(
              relationship =>
                relationship.relationshipType
            )
            .filter(Boolean)
        )
      ],

    count:
      relationships.length
  };
}


module.exports = {
  getObjectRelationships
};
