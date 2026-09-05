"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertTicketDeletionAllowed
} = require("./services/ticketService");

function ticket(status, execution = {}) {
  return {
    status,
    metadata: { execution }
  };
}

test("unworked draft and ready-for-chat Tickets may be deleted", () => {
  assert.doesNotThrow(() => assertTicketDeletionAllowed(ticket("draft")));
  assert.doesNotThrow(() => assertTicketDeletionAllowed(ticket("ready-for-chat")));
});

test("worked and lifecycle-complete Tickets may not be deleted", () => {
  for (const status of ["working", "pr-open", "ready-to-verify", "reopened", "closed", "rejected", "deleted"]) {
    assert.throws(
      () => assertTicketDeletionAllowed(ticket(status)),
      error => error.code === "TICKET_DELETE_STATE_INVALID" && error.status === 409
    );
  }
});

test("execution history blocks deletion even when status is ready-for-chat", () => {
  assert.throws(
    () => assertTicketDeletionAllowed(ticket("ready-for-chat", {
      agentId: "codex-root",
      runId: "run-1",
      claimedAt: "2026-09-05T00:00:00.000Z"
    })),
    error => error.code === "TICKET_DELETE_EXECUTION_EXISTS" && error.status === 409
  );
});
