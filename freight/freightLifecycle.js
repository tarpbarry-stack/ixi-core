"use strict";

const TRANSITIONS = Object.freeze({
  draft: ["requested","cancelled"],
  requested: ["quoting","awarded","cancelled"],
  quoting: ["awarded","cancelled"],
  awarded: ["scheduled","cancelled"],
  scheduled: ["picked-up","cancelled"],
  "picked-up": ["in-transit","delivered"],
  "in-transit": ["delivered"],
  delivered: ["billed","reconciled"],
  billed: ["reconciled"],
  reconciled: ["paid","closed"],
  paid: ["closed"],
  closed: [],
  cancelled: []
});

function canTransition(from, to) {
  return (TRANSITIONS[String(from || "")] || []).includes(String(to || ""));
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    const error = new Error(`Freight Order cannot transition from ${from || "unknown"} to ${to || "unknown"}.`);
    error.code = "FREIGHT_INVALID_STATE";
    error.status = 409;
    throw error;
  }
}

function transitionFreightOrder(record, to, { actorId = "", at = new Date().toISOString(), patch = {} } = {}) {
  assertTransition(record?.status, to);
  return {
    ...record,
    ...patch,
    identity: { ...record.identity, revision: Number(record.identity?.revision || 0) + 1 },
    status: to,
    audit: { ...record.audit, updatedAt: at, updatedBy: String(actorId || "") }
  };
}

module.exports = { TRANSITIONS, canTransition, assertTransition, transitionFreightOrder };
