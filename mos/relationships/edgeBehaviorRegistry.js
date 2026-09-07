"use strict";

const { MosError } = require("../errors/MosError");
const { cleanText } = require("../util/normalize");

const EDGE_BEHAVIOR_IDS = Object.freeze({
  RAIL_MEMBERSHIP: "aos.rail-membership.v1",
  NEUTRAL_CONNECTION: "aos.neutral-connection.v1"
});

const EDGE_BEHAVIORS = Object.freeze({
  [EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP]: Object.freeze({
    behaviorId: EDGE_BEHAVIOR_IDS.RAIL_MEMBERSHIP,
    sourceRole: "projected-object",
    targetRole: "rail-owner",
    projectsToRail: true,
    nestingPolicy: "recursive",
    cyclePolicy: "acyclic-structural",
    orderingPolicy: "explicit",
    cardinality: "many-to-many",
    placementScope: "durable-tenant"
  }),
  [EDGE_BEHAVIOR_IDS.NEUTRAL_CONNECTION]: Object.freeze({
    behaviorId: EDGE_BEHAVIOR_IDS.NEUTRAL_CONNECTION,
    sourceRole: "endpoint-a",
    targetRole: "endpoint-b",
    projectsToRail: false,
    nestingPolicy: "none",
    cyclePolicy: "bounded-traversal",
    orderingPolicy: "none",
    cardinality: "many-to-many",
    placementScope: "durable-tenant"
  })
});

function getEdgeBehavior(behaviorId) {
  const id = cleanText(behaviorId);
  const behavior = EDGE_BEHAVIORS[id];
  if (!behavior) {
    throw new MosError(
      "EDGE_BEHAVIOR_UNKNOWN",
      "The requested technical edge behavior is not registered.",
      { behaviorId: id || null },
      400
    );
  }
  return behavior;
}

module.exports = {
  EDGE_BEHAVIOR_IDS,
  EDGE_BEHAVIORS,
  getEdgeBehavior
};
