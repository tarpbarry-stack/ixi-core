"use strict";

const {
  TICKET_STATUS
} = require(
  "../constants"
);

const {
  TicketError
} = require(
  "../TicketError"
);

const {
  clean,
  safeObject,
  safeArray,
  nowIso,
  createId
} = require(
  "../util"
);

const {
  createTicket,
  normalizeTicket,
  assertRequestMutationAllowed
} = require(
  "../contracts/ticketContract"
);

const {
  transitionTicket
} = require(
  "./ticketLifecycle"
);

const {
  reserveTicketNumber,
  createTicketRecord,
  replaceTicketRecord,
  getTicketRecord,
  listTicketsByStatus,
  listTicketsByRepository
} = require(
  "../storage/ticketDynamoStore"
);

async function reserve({
  source =
    "internal-chat"
} = {}) {
  const prefix =
    source ===
    "customer-support"
      ? "SUP"
      : "CT";

  return reserveTicketNumber({
    prefix
  });
}

async function create({
  entityId,
  entityPassportId,
  actorPassportId,
  input = {}
}) {
  const source =
    safeObject(input);

  const clientDisplayNumber =
    clean(
      source.displayNumber
    );

  const reservation =
    await reserve({
      source:
        source.source
    });

  const record =
    createTicket({
      ...source,

      ticketId:
        clean(
          source.ticketId
        ) ||
        createId("ticket"),

      displayNumber:
        reservation.displayNumber,

      entityId,

      entityPassportId,

      actorPassportId,

      createdBy:
        actorPassportId,

      metadata: {
        ...safeObject(
          source.metadata
        ),

        clientDisplayNumber
      }
    });

  return createTicketRecord(
    record
  );
}

async function load({
  entityId,
  ticketId
}) {
  const record =
    await getTicketRecord({
      entityId,
      ticketId
    });

  if (!record) {
    throw new TicketError(
      "TICKET_NOT_FOUND",
      "Ticket not found.",
      {
        ticketId
      },
      404
    );
  }

  return record;
}

function assertTicketDeletionAllowed(ticket) {
  const deletableStatuses = new Set([
    TICKET_STATUS.DRAFT,
    TICKET_STATUS.READY_FOR_CHAT
  ]);

  if (!deletableStatuses.has(ticket?.status)) {
    throw new TicketError(
      "TICKET_DELETE_STATE_INVALID",
      "Only unworked draft or ready-for-chat Tickets can be deleted.",
      { status: ticket?.status || "" },
      409
    );
  }

  const execution = safeObject(ticket?.metadata?.execution);
  const hasExecutionHistory = [
    execution.assignedTo,
    execution.agentId,
    execution.runId,
    execution.claimedAt,
    execution.startedAt,
    execution.lastHeartbeatAt
  ].some(value => clean(value));

  if (hasExecutionHistory) {
    throw new TicketError(
      "TICKET_DELETE_EXECUTION_EXISTS",
      "A Ticket with agent execution history cannot be deleted.",
      {},
      409
    );
  }
}

async function remove({
  entityId,
  ticketId,
  actorPassportId,
  expectedRevision,
  reason = "obsolete"
}) {
  const current = await load({ entityId, ticketId });

  if (Number(expectedRevision) !== Number(current.revision)) {
    throw new TicketError(
      "TICKET_REVISION_CONFLICT",
      "Ticket deletion requires the current revision.",
      {
        expectedRevision: Number(expectedRevision || 0),
        currentRevision: Number(current.revision)
      },
      409
    );
  }

  assertTicketDeletionAllowed(current);

  const deletedAt = nowIso();
  const next = normalizeTicket({
    ...current,
    status: TICKET_STATUS.DELETED,
    metadata: {
      ...safeObject(current.metadata),
      deletion: {
        reason: clean(reason) || "obsolete",
        deletedAt,
        deletedBy: clean(actorPassportId)
      }
    },
    audit: {
      ...current.audit,
      updatedAt: deletedAt
    }
  });

  const deleted = await replaceTicketRecord({
    record: next,
    expectedRevision: current.revision
  });

  return {
    ticketId: deleted.ticketId,
    displayNumber: deleted.displayNumber,
    status: deleted.status,
    revision: deleted.revision,
    deletedAt
  };
}

async function patch({
  entityId,
  ticketId,
  actorPassportId,
  expectedRevision,
  patch = {}
}) {
  const current =
    await load({
      entityId,
      ticketId
    });

  const suppliedRevision =
    Number(
      expectedRevision ||
      patch.revision ||
      0
    );

  if (
    !suppliedRevision ||
    suppliedRevision !==
      Number(
        current.revision
      )
  ) {
    throw new TicketError(
      "TICKET_REVISION_REQUIRED",
      "Ticket update requires the current revision.",
      {
        suppliedRevision,
        currentRevision:
          current.revision
      },
      409
    );
  }

  const update =
    safeObject(patch);

  const touchesRequest =
    Object.prototype
      .hasOwnProperty.call(
        update,
        "originalRequest"
      ) ||
    Object.prototype
      .hasOwnProperty.call(
        update,
        "editSections"
      ) ||
    Object.prototype
      .hasOwnProperty.call(
        update,
        "headline"
      ) ||
    Object.prototype
      .hasOwnProperty.call(
        update,
        "repository"
      ) ||
    Object.prototype
      .hasOwnProperty.call(
        update,
        "type"
      ) ||
    Object.prototype
      .hasOwnProperty.call(
        update,
        "priority"
      ) ||
    Object.prototype
      .hasOwnProperty.call(
        update,
        "executionClass"
      );

  if (touchesRequest) {
    assertRequestMutationAllowed(
      current
    );
  }

  const next =
    normalizeTicket({
      ...current,

      ...update,

      ticketId:
        current.ticketId,

      displayNumber:
        current.displayNumber,

      source:
        current.source,

      authority:
        current.authority,

      github:
        current.github,

      closeout:
        current.closeout,

      verificationHistory:
        current.verificationHistory,

      audit: {
        ...current.audit,

        updatedAt:
          nowIso()
      }
    });

  next.authority.actorPassportId =
    current.authority.actorPassportId;

  return replaceTicketRecord({
    record:
      next,

    expectedRevision:
      current.revision
  });
}

async function transition({
  entityId,
  ticketId,
  actorPassportId,
  expectedRevision,
  nextStatus
}) {
  const current =
    await load({
      entityId,
      ticketId
    });

  if (
    Number(expectedRevision) !==
    Number(current.revision)
  ) {
    throw new TicketError(
      "TICKET_REVISION_CONFLICT",
      "Ticket transition requires the current revision.",
      {
        expectedRevision,
        currentRevision:
          current.revision
      },
      409
    );
  }

  const next =
    transitionTicket(
      current,
      nextStatus,
      {
        actorPassportId
      }
    );

  return replaceTicketRecord({
    record:
      next,

    expectedRevision:
      current.revision
  });
}

async function submitCloseout({
  entityId,
  ticketId,
  actorPassportId,
  expectedRevision,
  closeout = {}
}) {
  const current =
    await load({
      entityId,
      ticketId
    });

  if (
    Number(expectedRevision) !==
    Number(current.revision)
  ) {
    throw new TicketError(
      "TICKET_REVISION_CONFLICT",
      "Ticket closeout requires the current revision.",
      {},
      409
    );
  }

  if (
    ![
      TICKET_STATUS.WORKING,
      TICKET_STATUS.PR_OPEN
    ].includes(
      current.status
    )
  ) {
    throw new TicketError(
      "TICKET_CLOSEOUT_STATE_INVALID",
      "Ticket closeout is only allowed from working or pr-open.",
      {
        status:
          current.status
      },
      409
    );
  }

  let next =
    normalizeTicket({
      ...current,

      closeout: {
        ...safeObject(closeout),

        completedAt:
          nowIso(),

        completedBy:
          clean(
            actorPassportId
          )
      }
    });

  next =
    transitionTicket(
      next,
      TICKET_STATUS.READY_TO_VERIFY,
      {
        actorPassportId
      }
    );

  return replaceTicketRecord({
    record:
      next,

    expectedRevision:
      current.revision
  });
}

async function verify({
  entityId,
  ticketId,
  actorPassportId,
  expectedRevision,
  decision,
  note = ""
}) {
  const current =
    await load({
      entityId,
      ticketId
    });

  if (
    Number(expectedRevision) !==
    Number(current.revision)
  ) {
    throw new TicketError(
      "TICKET_REVISION_CONFLICT",
      "Ticket verification requires the current revision.",
      {},
      409
    );
  }

  if (
    current.status !==
    TICKET_STATUS.READY_TO_VERIFY
  ) {
    throw new TicketError(
      "TICKET_VERIFY_STATE_INVALID",
      "Only ready-to-verify Tickets can be audited.",
      {
        status:
          current.status
      },
      409
    );
  }

  const resolved =
    clean(
      decision
    ).toLowerCase();

  if (
    ![
      "approve",
      "reopen"
    ].includes(
      resolved
    )
  ) {
    throw new TicketError(
      "TICKET_VERIFY_DECISION_INVALID",
      "Verification decision must be approve or reopen.",
      {},
      400
    );
  }

  const event = {
    verificationId:
      createId(
        "verification"
      ),

    decision:
      resolved,

    note:
      clean(
        note
      ),

    actorPassportId:
      clean(
        actorPassportId
      ),

    createdAt:
      nowIso()
  };

  let next =
    normalizeTicket({
      ...current,

      verificationHistory: [
        ...safeArray(
          current.verificationHistory
        ),
        event
      ]
    });

  next =
    transitionTicket(
      next,
      resolved === "approve"
        ? TICKET_STATUS.CLOSED
        : TICKET_STATUS.REOPENED,
      {
        actorPassportId
      }
    );

  return replaceTicketRecord({
    record:
      next,

    expectedRevision:
      current.revision
  });
}

async function reopen({
  entityId,
  ticketId,
  actorPassportId,
  expectedRevision,
  note = ""
}) {
  const current =
    await load({
      entityId,
      ticketId
    });

  if (
    Number(expectedRevision) !==
    Number(current.revision)
  ) {
    throw new TicketError(
      "TICKET_REVISION_CONFLICT",
      "Ticket reopen requires the current revision.",
      {},
      409
    );
  }

  const event = {
    verificationId:
      createId(
        "verification"
      ),

    decision:
      "reopen",

    note:
      clean(
        note
      ),

    actorPassportId:
      clean(
        actorPassportId
      ),

    createdAt:
      nowIso()
  };

  let next =
    normalizeTicket({
      ...current,

      verificationHistory: [
        ...safeArray(
          current.verificationHistory
        ),
        event
      ]
    });

  next =
    transitionTicket(
      next,
      TICKET_STATUS.REOPENED,
      {
        actorPassportId
      }
    );

  return replaceTicketRecord({
    record:
      next,

    expectedRevision:
      current.revision
  });
}

module.exports = {
  reserve,
  create,
  load,
  remove,
  patch,
  transition,
  submitCloseout,
  verify,
  reopen,

  listTicketsByStatus,
  listTicketsByRepository,
  assertTicketDeletionAllowed
};
