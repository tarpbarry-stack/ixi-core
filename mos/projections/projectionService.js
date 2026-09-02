const {
  readJsonFile,
  writeJsonFileAtomic
} = require("../storage/jsonStore");

const {
  MOS_PATHS
} = require("../storage/mosPaths");

const {
  MOS_OBJECT_STATUS
} = require("../constants");

const {
  MosError
} = require("../errors/MosError");

const {
  cleanText,
  nowIso
} = require("../util/normalize");


const PROJECTION_SCHEMA_VERSION =
  "mos-container-projection-v2";


/* =========================================================
   STORE ACCESS
   ========================================================= */

function readObjects() {
  const stored =
    readJsonFile(
      MOS_PATHS.objects,
      {}
    );

  return (
    stored &&
    typeof stored === "object" &&
    !Array.isArray(stored)
  )
    ? stored
    : {};
}


function readDefinitions() {
  const stored =
    readJsonFile(
      MOS_PATHS.customerObjectTypes,
      {}
    );

  return (
    stored &&
    typeof stored === "object" &&
    !Array.isArray(stored)
  )
    ? stored
    : {};
}


function readProjections() {
  const stored =
    readJsonFile(
      MOS_PATHS.projections,
      {}
    );

  return (
    stored &&
    typeof stored === "object" &&
    !Array.isArray(stored)
  )
    ? stored
    : {};
}


function writeProjections(
  projections
) {
  writeJsonFileAtomic(
    MOS_PATHS.projections,
    projections
  );
}


/* =========================================================
   BASIC HELPERS
   ========================================================= */

function numericValue(value) {
  const resolved =
    Number(value);

  return Number.isFinite(resolved)
    ? resolved
    : 0;
}


function getRequiredObject(
  objects,
  objectId
) {
  const object =
    objects[objectId];

  if (!object) {
    throw new MosError(
      "OBJECT_NOT_FOUND",
      `Object not found: ${objectId}`,
      {
        objectId
      },
      404
    );
  }

  return object;
}


function isActiveObject(object) {
  return (
    object &&
    object.status ===
      MOS_OBJECT_STATUS.ACTIVE
  );
}


/* =========================================================
   DEFINITION CATALOG

   CUSTOMER LANGUAGE IS AUTHORITATIVE.

   definitionId = stable semantic identity
   definitionKey = stable technical key
   label = customer's CURRENT saved wording

   We do not infer meaning from:
   - displayName
   - container name
   - objectType
   - parent name
   - words like PEOPLE / JOB / TOOL / VEHICLE
   ========================================================= */

function buildDefinitionCatalog({
  definitions,
  entityId
}) {
  const catalog = {};

  Object.values(
    definitions
  ).forEach(definition => {
    if (
      !definition ||
      definition.entityId !== entityId
    ) {
      return;
    }

    const definitionId =
      cleanText(
        definition.definitionId
      );

    if (!definitionId) {
      return;
    }

    catalog[definitionId] = {
      definitionId,

      definitionKey:
        cleanText(
          definition.definitionKey
        ) || null,

      label:
        cleanText(
          definition.label
        ) ||
        cleanText(
          definition.definitionKey
        ) ||
        definitionId,

      status:
        cleanText(
          definition.status
        ) || "active"
    };
  });

  return catalog;
}


function resolveObjectDefinition({
  object,
  definitionCatalog
}) {
  const definitionId =
    cleanText(
      object?.definitionId
    );

  if (!definitionId) {
    return null;
  }

  const canonical =
    definitionCatalog[
      definitionId
    ];

  if (canonical) {
    return {
      ...canonical,

      resolvedFrom:
        "definition-store"
    };
  }

  /*
   * Integrity fallback.
   *
   * We preserve the object's stable reference
   * rather than guessing what the Object means.
   */
  return {
    definitionId,

    definitionKey:
      cleanText(
        object?.definitionKey
      ) || null,

    label:
      cleanText(
        object?.definitionLabel
      ) ||
      cleanText(
        object?.definitionKey
      ) ||
      definitionId,

    status:
      "unresolved",

    resolvedFrom:
      "object-snapshot"
  };
}


/* =========================================================
   DEFINITION AGGREGATES
   ========================================================= */

function createDefinitionAggregate(
  descriptor
) {
  return {
    definitionId:
      descriptor.definitionId,

    definitionKey:
      descriptor.definitionKey ||
      null,

    label:
      descriptor.label,

    definitionStatus:
      descriptor.status ||
      "active",

    resolvedFrom:
      descriptor.resolvedFrom,

    itemCount:
      0,

    objectCount:
      0,

    containerCount:
      0,

    value:
      0
  };
}


function addObjectToDefinitionAggregate({
  aggregateMap,
  object,
  definitionCatalog
}) {
  const descriptor =
    resolveObjectDefinition({
      object,
      definitionCatalog
    });

  if (!descriptor) {
    return false;
  }

  if (
    !aggregateMap[
      descriptor.definitionId
    ]
  ) {
    aggregateMap[
      descriptor.definitionId
    ] =
      createDefinitionAggregate(
        descriptor
      );
  }

  const aggregate =
    aggregateMap[
      descriptor.definitionId
    ];

  aggregate.itemCount += 1;

  if (
    object.capabilities?.canContain ===
    true
  ) {
    aggregate.containerCount += 1;
  } else {
    aggregate.objectCount += 1;
  }

  aggregate.value +=
    numericValue(
      object.value
    );

  return true;
}


function mergeDefinitionAggregates({
  target,
  source
}) {
  Object.values(
    source || {}
  ).forEach(sourceAggregate => {
    const definitionId =
      cleanText(
        sourceAggregate
          ?.definitionId
      );

    if (!definitionId) {
      return;
    }

    if (!target[definitionId]) {
      target[definitionId] = {
        ...sourceAggregate,

        itemCount:
          numericValue(
            sourceAggregate.itemCount
          ),

        objectCount:
          numericValue(
            sourceAggregate.objectCount
          ),

        containerCount:
          numericValue(
            sourceAggregate.containerCount
          ),

        value:
          numericValue(
            sourceAggregate.value
          )
      };

      return;
    }

    const targetAggregate =
      target[definitionId];

    targetAggregate.itemCount +=
      numericValue(
        sourceAggregate.itemCount
      );

    targetAggregate.objectCount +=
      numericValue(
        sourceAggregate.objectCount
      );

    targetAggregate.containerCount +=
      numericValue(
        sourceAggregate.containerCount
      );

    targetAggregate.value +=
      numericValue(
        sourceAggregate.value
      );

    /*
     * Canonical definition-store presentation wins.
     */
    if (
      sourceAggregate.resolvedFrom ===
      "definition-store"
    ) {
      targetAggregate.definitionKey =
        sourceAggregate.definitionKey;

      targetAggregate.label =
        sourceAggregate.label;

      targetAggregate.definitionStatus =
        sourceAggregate
          .definitionStatus;

      targetAggregate.resolvedFrom =
        "definition-store";
    }
  });
}


function sortDefinitionSummary(
  aggregateMap
) {
  return Object.values(
    aggregateMap || {}
  ).sort((a, b) => {
    const labelCompare =
      String(
        a.label || ""
      ).localeCompare(
        String(
          b.label || ""
        )
      );

    if (labelCompare) {
      return labelCompare;
    }

    return String(
      a.definitionId || ""
    ).localeCompare(
      String(
        b.definitionId || ""
      )
    );
  });
}


function buildCountMap(
  aggregateMap
) {
  const counts = {};

  Object.values(
    aggregateMap || {}
  ).forEach(aggregate => {
    counts[
      aggregate.definitionId
    ] =
      numericValue(
        aggregate.itemCount
      );
  });

  return counts;
}


function buildLabelMap(
  aggregateMap
) {
  const labels = {};

  Object.values(
    aggregateMap || {}
  ).forEach(aggregate => {
    labels[
      aggregate.definitionId
    ] =
      aggregate.label;
  });

  return labels;
}


/* =========================================================
   CONTAINMENT INDEX
   ========================================================= */

function buildChildrenIndex(
  objects
) {
  const childrenByContainer =
    new Map();

  Object.values(
    objects
  ).forEach(object => {
    if (!isActiveObject(object)) {
      return;
    }

    const containerId =
      cleanText(
        object.directContainerId
      );

    if (!containerId) {
      return;
    }

    if (
      !childrenByContainer.has(
        containerId
      )
    ) {
      childrenByContainer.set(
        containerId,
        []
      );
    }

    childrenByContainer
      .get(containerId)
      .push(object);
  });

  return childrenByContainer;
}


/* =========================================================
   CONTAINER PROJECTION

   Direct means DIRECT CHILDREN ONLY.

   Descendant means EVERYTHING BELOW this container,
   recursively, excluding the root container itself.

   Structural truth comes only from directContainerId.

   Meaning comes only from persisted definition identity.
   ========================================================= */

function calculateContainerProjection({
  objects,
  containerId,
  childrenByContainer,
  definitionCatalog,
  recursionStack =
    new Set()
}) {
  const container =
    getRequiredObject(
      objects,
      containerId
    );

  if (
    container.capabilities?.canContain !==
    true
  ) {
    throw new MosError(
      "OBJECT_NOT_CONTAINER",
      `${container.displayName || containerId} cannot contain objects.`,
      {
        containerId
      },
      409
    );
  }

  if (
    recursionStack.has(
      containerId
    )
  ) {
    throw new MosError(
      "CONTAINMENT_CYCLE_DETECTED",
      "A containment cycle exists while calculating projections.",
      {
        containerId,
        path:
          Array.from(
            recursionStack
          )
      },
      409
    );
  }

  recursionStack.add(
    containerId
  );

  const directChildren =
    childrenByContainer.get(
      containerId
    ) || [];


  const directDefinitionAggregateMap =
    {};

  const descendantDefinitionAggregateMap =
    {};


  let directObjectCount = 0;
  let directContainerCount = 0;

  let descendantObjectCount = 0;
  let descendantContainerCount = 0;


  let directValue = 0;
  let descendantValue = 0;


  let directUnclassifiedCount = 0;
  let directUnclassifiedValue = 0;

  let descendantUnclassifiedCount = 0;
  let descendantUnclassifiedValue = 0;


  directChildren.forEach(child => {
    const childValue =
      numericValue(
        child.value
      );

    const childIsContainer =
      child.capabilities?.canContain ===
      true;


    /*
     * DIRECT TOTALS
     */
    directValue +=
      childValue;

    if (childIsContainer) {
      directContainerCount += 1;
    } else {
      directObjectCount += 1;
    }


    /*
     * DIRECT DEFINITION AGGREGATION
     */
    const classifiedDirect =
      addObjectToDefinitionAggregate({
        aggregateMap:
          directDefinitionAggregateMap,

        object:
          child,

        definitionCatalog
      });

    if (!classifiedDirect) {
      directUnclassifiedCount += 1;

      directUnclassifiedValue +=
        childValue;
    }


    /*
     * Every direct child is also a descendant.
     */
    const classifiedDescendant =
      addObjectToDefinitionAggregate({
        aggregateMap:
          descendantDefinitionAggregateMap,

        object:
          child,

        definitionCatalog
      });

    if (!classifiedDescendant) {
      descendantUnclassifiedCount += 1;

      descendantUnclassifiedValue +=
        childValue;
    }


    /*
     * RECURSION
     */
    if (childIsContainer) {
      descendantContainerCount += 1;

      const childProjection =
        calculateContainerProjection({
          objects,

          containerId:
            child.objectId,

          childrenByContainer,

          definitionCatalog,

          recursionStack
        });


      descendantObjectCount +=
        childProjection
          .descendantObjectCount;

      descendantContainerCount +=
        childProjection
          .descendantContainerCount;


      /*
       * childProjection.branchValue includes:
       * child own value + all descendants below child.
       */
      descendantValue +=
        childProjection
          .branchValue;


      descendantUnclassifiedCount +=
        childProjection
          .descendantUnclassifiedCount;

      descendantUnclassifiedValue +=
        childProjection
          .descendantUnclassifiedValue;


      mergeDefinitionAggregates({
        target:
          descendantDefinitionAggregateMap,

        source:
          childProjection
            .descendantDefinitionAggregateMap
      });

    } else {
      descendantObjectCount += 1;

      descendantValue +=
        childValue;
    }
  });


  recursionStack.delete(
    containerId
  );


  const ownValue =
    numericValue(
      container.value
    );


  const directDefinitionSummary =
    sortDefinitionSummary(
      directDefinitionAggregateMap
    );

  const descendantDefinitionSummary =
    sortDefinitionSummary(
      descendantDefinitionAggregateMap
    );


  return {
    schemaVersion:
      PROJECTION_SCHEMA_VERSION,

    containerId,

    entityId:
      container.entityId,


    /*
     * DIRECT STRUCTURE
     */
    directObjectCount,

    directContainerCount,

    directItemCount:
      directObjectCount +
      directContainerCount,


    /*
     * RECURSIVE STRUCTURE
     */
    descendantObjectCount,

    descendantContainerCount,

    descendantItemCount:
      descendantObjectCount +
      descendantContainerCount,


    /*
     * VALUE
     */
    ownValue,

    directValue,

    descendantValue,

    branchValue:
      ownValue +
      descendantValue,


    /*
     * CUSTOMER-DEFINITION VIEW
     *
     * These are the semantic dimensions AOS should use.
     */
    directDefinitionSummary,

    descendantDefinitionSummary,


    /*
     * Lightweight lookup maps.
     */
    directDefinitionCounts:
      buildCountMap(
        directDefinitionAggregateMap
      ),

    descendantDefinitionCounts:
      buildCountMap(
        descendantDefinitionAggregateMap
      ),

    definitionLabels: {
      ...buildLabelMap(
        directDefinitionAggregateMap
      ),

      ...buildLabelMap(
        descendantDefinitionAggregateMap
      )
    },


    /*
     * Full internal aggregate structures.
     *
     * These are also useful for analytical faces,
     * dashboards, API clients and recursive rebuilds.
     */
    directDefinitionAggregateMap,

    descendantDefinitionAggregateMap,


    /*
     * DATA QUALITY
     *
     * We flag missing semantics.
     * We never guess them.
     */
    directUnclassifiedCount,

    directUnclassifiedValue,

    descendantUnclassifiedCount,

    descendantUnclassifiedValue,


    calculatedAt:
      nowIso()
  };
}


/* =========================================================
   REBUILD ENTITY
   ========================================================= */

function rebuildEntityProjections(
  entityId
) {
  const normalizedEntityId =
    cleanText(
      entityId
    );

  if (!normalizedEntityId) {
    throw new MosError(
      "PROJECTION_ENTITY_REQUIRED",
      "entityId is required.",
      null,
      400
    );
  }


  const allObjects =
    readObjects();

  const definitions =
    readDefinitions();


  const entityObjects =
    Object.values(
      allObjects
    ).filter(
      object =>
        object.entityId ===
          normalizedEntityId &&
        isActiveObject(object)
    );


  const objects = {};

  entityObjects.forEach(
    object => {
      objects[
        object.objectId
      ] = object;
    }
  );


  const definitionCatalog =
    buildDefinitionCatalog({
      definitions,

      entityId:
        normalizedEntityId
    });


  const childrenByContainer =
    buildChildrenIndex(
      objects
    );


  const projections =
    readProjections();


  /*
   * Replace this Entity's projection set atomically.
   */
  Object.keys(
    projections
  ).forEach(key => {
    if (
      projections[key]?.entityId ===
      normalizedEntityId
    ) {
      delete projections[key];
    }
  });


  entityObjects
    .filter(
      object =>
        object.capabilities?.canContain ===
        true
    )
    .forEach(container => {
      projections[
        container.objectId
      ] =
        calculateContainerProjection({
          objects,

          containerId:
            container.objectId,

          childrenByContainer,

          definitionCatalog
        });
    });


  writeProjections(
    projections
  );


  return Object.values(
    projections
  ).filter(
    projection =>
      projection.entityId ===
        normalizedEntityId
  );
}


/* =========================================================
   READ PROJECTION
   ========================================================= */

function getContainerProjection(
  containerId
) {
  const projections =
    readProjections();

  return (
    projections[
      containerId
    ] ||
    null
  );
}


/* =========================================================
   BRANCH SUMMARY

   This remains the compact summary consumed by
   object routes and other runtime callers.
   ========================================================= */

function getBranchSummary(
  objectId
) {
  const objects =
    readObjects();

  const object =
    getRequiredObject(
      objects,
      objectId
    );


  if (
    object.capabilities?.canContain ===
    true
  ) {
    let projection =
      getContainerProjection(
        objectId
      );


    if (
      !projection ||
      projection.schemaVersion !==
        PROJECTION_SCHEMA_VERSION
    ) {
      rebuildEntityProjections(
        object.entityId
      );

      projection =
        getContainerProjection(
          objectId
        );
    }


    return {
      objectId,

      rootValue:
        numericValue(
          object.value
        ),

      descendantValue:
        projection
          ?.descendantValue ||
        0,

      branchValue:
        projection
          ?.branchValue ||
        numericValue(
          object.value
        ),

      directObjectCount:
        projection
          ?.directObjectCount ||
        0,

      directContainerCount:
        projection
          ?.directContainerCount ||
        0,

      directItemCount:
        projection
          ?.directItemCount ||
        0,

      descendantObjectCount:
        projection
          ?.descendantObjectCount ||
        0,

      descendantContainerCount:
        projection
          ?.descendantContainerCount ||
        0,

      descendantItemCount:
        projection
          ?.descendantItemCount ||
        0,

      branchItemCount:
        1 +
        (
          projection
            ?.descendantItemCount ||
          0
        ),

      directDefinitionSummary:
        projection
          ?.directDefinitionSummary ||
        [],

      descendantDefinitionSummary:
        projection
          ?.descendantDefinitionSummary ||
        [],

      unclassifiedCount:
        projection
          ?.descendantUnclassifiedCount ||
        0
    };
  }


  return {
    objectId,

    rootValue:
      numericValue(
        object.value
      ),

    descendantValue:
      0,

    branchValue:
      numericValue(
        object.value
      ),

    directObjectCount:
      0,

    directContainerCount:
      0,

    directItemCount:
      0,

    descendantObjectCount:
      0,

    descendantContainerCount:
      0,

    descendantItemCount:
      0,

    branchItemCount:
      1,

    directDefinitionSummary:
      [],

    descendantDefinitionSummary:
      [],

    unclassifiedCount:
      object.definitionId
        ? 0
        : 1
  };
}


module.exports = {
  rebuildEntityProjections,
  getContainerProjection,
  getBranchSummary
};
