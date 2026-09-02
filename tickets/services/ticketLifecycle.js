"use strict";

const {
  TICKET_STATUS
} = require("../constants");

const {
  TicketError
} = require("../TicketError");

const {
  nowIso,
  clean
} = require("../util");

const {
  normalizeTicket,
  lockOriginalRequest
} = require("../contracts/ticketContract");

const TRANSITIONS = Object.freeze({
  [TICKET_STATUS.DRAFT]: new Set([
    TICKET_STATUS.READY_FOR_CHAT,
    TICKET_STATUS.REJECTED
  ]),

  [TICKET_STATUS.READY_FOR_CHAT]: new Set([
    TICKET_STATUS.WORKING,
    TICKET_STATUS.REJECTED
  ]),

  [TICKET_STATUS.WORKING]: new Set([
    TICKET_STATUS.PR_OPEN,
    TICKET_STATUS.READY_TO_VERIFY,
    TICKET_STATUS.REJECTED
  ]),

  [TICKET_STATUS.PR_OPEN]: new Set([
    TICKET_STATUS.WORKING,
    TICKET_STATUS.READY_TO_VERIFY,
    TICKET_STATUS.REJECTED
  ]),

  [TICKET_STATUS.READY_TO_VERIFY]: new Set([
    TICKET_STATUS.CLOSED,
    TICKET_STATUS.REOPENED
  ]),

  [TICKET_STATUS.REOPENED]: new Set([
    TICKET_STATUS.WORKING,
    TICKET_STATUS.READY_FOR_CHAT
  ]),

  [TICKET_STATUS.REJECTED]: new Set([
    TICKET_STATUS.REOPENED
  ]),

  [TICKET_STATUS.CLOSED]: new Set([
    TICKET_STATUS.REOPENED
  ])
});

function transitionTicket(
  source,
  nextStatus,
  {
    actorPassportId = "",
    at = nowIso()
  } = {}
) {
  let ticket =
    normalizeTicket(source);

  const from =
    ticket.status;

  const to =
    clean(nextStatus).toLowerCase();

  if (
    from === to
  ) {
    return ticket;
  }

  const allowed =
    TRANSITIONS[from];

  if (
    !allowed ||
    !allowed.has(to)
  ) {
    throw new TicketError(
      "TICKET_TRANSITION_INVALID",
      `Ticket cannot transition from ${from} to ${to}.`,
      {
        from,
        to
      },
      409
    );
  }

  if (
    from === TICKET_STATUS.DRAFT &&
    to === TICKET_STATUS.READY_FOR_CHAT
  ) {
    ticket =
      lockOriginalRequest(
        ticket,
        at
      );
  }

  ticket.status =
    to;

  ticket.audit.updatedAt =
    at;

  if (
    to === TICKET_STATUS.CLOSED
  ) {
    ticket.audit.closedAt =
      at;

    ticket.audit.closedBy =
      clean(actorPassportId);
  }

  if (
    to === TICKET_STATUS.REOPENED
  ) {
    ticket.audit.closedAt = "";
    ticket.audit.closedBy = "";
  }

  return ticket;
}

function canTransition(
  from,
  to
) {
  return Boolean(
    TRANSITIONS[from]?.has(to)
  );
}

module.exports = {
  TRANSITIONS,
  transitionTicket,
  canTransition
};
