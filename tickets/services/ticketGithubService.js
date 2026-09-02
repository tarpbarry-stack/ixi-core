"use strict";

const {
  TICKET_STATUS
} = require("../constants");

const {
  TicketError
} = require("../TicketError");

const {
  clean,
  nowIso
} = require("../util");

const {
  normalizeTicket
} = require(
  "../contracts/ticketContract"
);

const {
  transitionTicket
} = require(
  "./ticketLifecycle"
);

const {
  buildTicketIssueTitle,
  buildTicketIssueBody
} = require(
  "../github/ticketMarkdown"
);

const {
  findTicketIssue,
  createIssue
} = require(
  "../github/githubAppClient"
);

const {
  getTicketRecord,
  replaceTicketRecord
} = require(
  "../storage/ticketDynamoStore"
);

function labelsForTicket(
  ticket
) {
  return [
    "ixi-chat-ticket",
    ticket.status,
    `type:${ticket.type}`,
    `priority:${ticket.priority}`
  ];
}

async function load({
  entityId,
  ticketId
}) {
  const ticket =
    await getTicketRecord({
      entityId,
      ticketId
    });

  if (!ticket) {
    throw new TicketError(
      "TICKET_NOT_FOUND",
      "Ticket not found.",
      {
        ticketId
      },
      404
    );
  }

  return ticket;
}

async function persistGitHubIssue({
  ticket,
  issue,
  expectedRevision
}) {
  const next =
    normalizeTicket({
      ...ticket,

      github: {
        ...(ticket.github || {}),

        repository:
          ticket.repository,

        issueNumber:
          Number(
            issue?.number ||
            0
          ),

        issueUrl:
          clean(
            issue?.html_url
          ),

        issueNodeId:
          clean(
            issue?.node_id
          ),

        state:
          clean(
            issue?.state
          ) ||
          "open",

        labels:
          labelsForTicket(
            ticket
          ),

        publishedAt:
          ticket.github
            ?.publishedAt ||
          nowIso(),

        syncedAt:
          nowIso()
      }
    });

  return replaceTicketRecord({
    record:
      next,

    expectedRevision
  });
}

async function publishTicketToGitHub({
  entityId,
  ticketId,
  actorPassportId
}) {
  let ticket =
    await load({
      entityId,
      ticketId
    });

  /*
   * Dynamo is the first idempotency boundary.
   */
  if (
    Number(
      ticket.github
        ?.issueNumber ||
      0
    ) > 0
  ) {
    return {
      ticket,
      created:
        false,
      idempotentReplay:
        true
    };
  }

  /*
   * Publication freezes request evidence.
   */
  if (
    ticket.status ===
    TICKET_STATUS.DRAFT
  ) {
    const transitioned =
      transitionTicket(
        ticket,
        TICKET_STATUS.READY_FOR_CHAT,
        {
          actorPassportId
        }
      );

    ticket =
      await replaceTicketRecord({
        record:
          transitioned,

        expectedRevision:
          ticket.revision
      });
  }

  if (
    ![
      TICKET_STATUS.READY_FOR_CHAT,
      TICKET_STATUS.WORKING,
      TICKET_STATUS.PR_OPEN,
      TICKET_STATUS.REOPENED
    ].includes(
      ticket.status
    )
  ) {
    throw new TicketError(
      "TICKET_GITHUB_STATE_INVALID",
      "Ticket cannot be published to GitHub from its current lifecycle state.",
      {
        status:
          ticket.status
      },
      409
    );
  }

  /*
   * GitHub itself is the second idempotency boundary.
   * If GitHub succeeded but Dynamo persistence was interrupted,
   * we find the existing IXI marker instead of creating a duplicate.
   */
  let issue =
    await findTicketIssue({
      repository:
        ticket.repository,

      ticketId:
        ticket.ticketId
    });

  let created =
    false;

  if (!issue) {
    issue =
      await createIssue({
        repository:
          ticket.repository,

        title:
          buildTicketIssueTitle(
            ticket
          ),

        body:
          buildTicketIssueBody(
            ticket
          ),

        labels:
          labelsForTicket(
            ticket
          )
      });

    created =
      true;
  }

  const saved =
    await persistGitHubIssue({
      ticket,

      issue,

      expectedRevision:
        ticket.revision
    });

  return {
    ticket:
      saved,

    created,

    idempotentReplay:
      !created
  };
}

module.exports = {
  publishTicketToGitHub
};
