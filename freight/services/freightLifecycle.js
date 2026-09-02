"use strict";

const {
  FREIGHT_STATUS
} = require("../constants");

const {
  FreightError
} = require("../FreightError");

const {
  clean,
  nowIso
} = require("../util");

const TRANSITIONS = Object.freeze({
  draft:
    ["requested", "cancelled"],

  requested:
    ["awarded", "cancelled"],

  awarded:
    ["dispatched", "cancelled"],

  dispatched:
    ["picked-up", "cancelled"],

  "picked-up":
    ["in-transit", "delivered"],

  "in-transit":
    ["delivered"],

  delivered:
    ["billed", "reconciled"],

  billed:
    ["reconciled"],

  reconciled:
    ["paid", "closed"],

  paid:
    ["closed"],

  closed: [],
  cancelled: []
});

function canTransition(from, to) {
  return (
    TRANSITIONS[clean(from)] || []
  ).includes(clean(to));
}

function transition(
  record,
  nextStatus,
  actorId = ""
) {
  const current =
    clean(record?.status);

  const next =
    clean(nextStatus);

  if (!canTransition(current, next)) {
    throw new FreightError(
      "FREIGHT_INVALID_STATE",
      `Cannot transition Freight Order from ${current} to ${next}.`,
      {
        currentStatus: current,
        requestedStatus: next
      },
      409
    );
  }

  const timestamp = nowIso();

  return {
    ...record,

    identity: {
      ...record.identity,
      revision:
        Number(
          record?.identity?.revision || 0
        ) + 1
    },

    status: next,

    audit: {
      ...record.audit,
      updatedAt: timestamp,
      updatedBy: clean(actorId)
    }
  };
}

module.exports = {
  TRANSITIONS,
  canTransition,
  transition
};
