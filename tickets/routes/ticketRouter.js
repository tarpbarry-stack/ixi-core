"use strict";

const express =
  require("express");

const router =
  express.Router();

const {
  TicketError
} = require(
  "../TicketError"
);

const ticketService =
  require(
    "../services/ticketService"
  );

const {
  publishTicketToGitHub
} = require(
  "../services/ticketGithubService"
);

const {
  requireTicketPermission
} = require(
  "./ticketAuthorization"
);

function clean(value) {
  return String(
    value ?? ""
  ).trim();
}

function context(req) {
  const source =
    req.ixiTicketContext || {};

  if (
    !source.authenticated ||
    !source.aosEntityId ||
    !source.actorPassportId ||
    !source.entityPassportId
  ) {
    throw new TicketError(
      "TICKET_AUTHENTICATION_REQUIRED",
      "Trusted Ticket authentication context is required.",
      {},
      401
    );
  }

  return {
    entityId:
      clean(
        source.aosEntityId
      ),

    entityPassportId:
      clean(
        source.entityPassportId
      ),

    actorPassportId:
      clean(
        source.actorPassportId
      )
  };
}

function sendError(
  res,
  error
) {
  const status =
    Number(
      error?.status ||
      500
    );

  return res
    .status(status)
    .json({
      ok: false,

      contract:
        "ixi-ticket",

      contractVersion:
        "1.0.0",

      error: {
        code:
          clean(
            error?.code
          ) ||
          "TICKET_INTERNAL_ERROR",

        message:
          status >= 500
            ? "Ticket operation failed."
            : clean(
                error?.message
              ),

        details:
          error?.details &&
          typeof error.details ===
            "object"
            ? error.details
            : {}
      }
    });
}

function route(
  operation,
  permission,
  handler
) {
  return async (
    req,
    res
  ) => {
    try {
      const ctx =
        context(req);

      requireTicketPermission(
        req,
        permission
      );

      const data =
        await handler(
          req,
          ctx
        );

      return res.json({
        ok: true,

        contract:
          "ixi-ticket",

        contractVersion:
          "1.0.0",

        operation,

        data,

        ticket:
          data?.ticket ||
          (
            data?.ticketId
              ? data
              : undefined
          )
      });

    } catch (error) {
      console.error(
        `[IXI Ticket] ${operation}`,
        error
      );

      return sendError(
        res,
        error
      );
    }
  };
}


/* =========================================================
   RESERVE
   ========================================================= */

router.post(
  "/tickets/reserve",

  route(
    "ticket.reserve",
    "tickets.create",

    async req => {
      return ticketService.reserve({
        source:
          req.body?.source ||
          "internal-chat"
      });
    }
  )
);


/* =========================================================
   CREATE
   ========================================================= */

router.post(
  "/tickets",

  route(
    "ticket.create",
    "tickets.create",

    async (
      req,
      ctx
    ) => {
      const input =
        req.body?.ticket ||
        req.body ||
        {};

      /*
       * Browser diagnostic authority is ignored.
       * Trusted actor/entity always overwrite input.
       */
      return ticketService.create({
        ...ctx,
        input
      });
    }
  )
);


/* =========================================================
   LIST
   ========================================================= */

router.get(
  "/tickets",

  route(
    "ticket.list",
    "tickets.view",

    async (
      req,
      ctx
    ) => {
      const status =
        clean(
          req.query?.status
        );

      const repository =
        clean(
          req.query?.repository
        );

      const limit =
        Number(
          req.query?.limit ||
          100
        );

      if (status) {
        return {
          tickets:
            await ticketService
              .listTicketsByStatus({
                entityId:
                  ctx.entityId,

                status,

                limit
              })
        };
      }

      if (repository) {
        const all =
          await ticketService
            .listTicketsByRepository({
              repository,
              limit
            });

        return {
          tickets:
            all.filter(
              ticket =>
                clean(
                  ticket.authority
                    ?.entityId
                ) ===
                ctx.entityId
            )
        };
      }

      /*
       * No Scan in the production API.
       * Caller must choose a queue/status
       * until a dedicated Entity-all GSI is added.
       */
      throw new TicketError(
        "TICKET_LIST_FILTER_REQUIRED",
        "Ticket list requires status or repository filter.",
        {},
        400
      );
    }
  )
);


/* =========================================================
   READ
   ========================================================= */

router.get(
  "/tickets/:ticketId",

  route(
    "ticket.read",
    "tickets.view",

    async (
      req,
      ctx
    ) => {
      return ticketService.load({
        entityId:
          ctx.entityId,

        ticketId:
          req.params.ticketId
      });
    }
  )
);


/* =========================================================
   DELETE UNWORKED TICKET
   ========================================================= */

router.delete(
  "/tickets/:ticketId",

  route(
    "ticket.delete",
    "tickets.manage",

    async (
      req,
      ctx
    ) => {
      return ticketService.remove({
        entityId:
          ctx.entityId,

        ticketId:
          req.params.ticketId,

        actorPassportId:
          ctx.actorPassportId,

        expectedRevision:
          req.body?.expectedRevision ||
          req.body?.revision,

        reason:
          req.body?.reason ||
          "obsolete"
      });
    }
  )
);


/* =========================================================
   PATCH DRAFT
   ========================================================= */

router.patch(
  "/tickets/:ticketId",

  route(
    "ticket.patch",
    "tickets.manage",

    async (
      req,
      ctx
    ) => {
      return ticketService.patch({
        entityId:
          ctx.entityId,

        ticketId:
          req.params.ticketId,

        actorPassportId:
          ctx.actorPassportId,

        expectedRevision:
          req.body?.expectedRevision ||
          req.body?.revision ||
          req.body?.patch?.revision,

        patch:
          req.body?.patch ||
          {}
      });
    }
  )
);


/* =========================================================
   GITHUB PUBLISH
   ========================================================= */

router.post(
  "/tickets/:ticketId/github/publish",

  route(
    "ticket.github.publish",
    "tickets.publish",

    async (
      req,
      ctx
    ) => {
      return publishTicketToGitHub({
        entityId:
          ctx.entityId,

        ticketId:
          req.params.ticketId,

        actorPassportId:
          ctx.actorPassportId
      });
    }
  )
);


/* =========================================================
   CLOSEOUT
   ========================================================= */

router.post(
  "/tickets/:ticketId/closeout",

  route(
    "ticket.closeout",
    "tickets.manage",

    async (
      req,
      ctx
    ) => {
      return ticketService.submitCloseout({
        entityId:
          ctx.entityId,

        ticketId:
          req.params.ticketId,

        actorPassportId:
          ctx.actorPassportId,

        expectedRevision:
          req.body?.expectedRevision ||
          req.body?.revision,

        closeout:
          req.body?.closeout ||
          {}
      });
    }
  )
);


/* =========================================================
   VERIFY
   ========================================================= */

router.post(
  "/tickets/:ticketId/verify",

  route(
    "ticket.verify",
    "tickets.verify",

    async (
      req,
      ctx
    ) => {
      return ticketService.verify({
        entityId:
          ctx.entityId,

        ticketId:
          req.params.ticketId,

        actorPassportId:
          ctx.actorPassportId,

        expectedRevision:
          req.body?.expectedRevision ||
          req.body?.revision,

        decision:
          req.body?.decision,

        note:
          req.body?.note
      });
    }
  )
);


/* =========================================================
   REOPEN
   ========================================================= */

router.post(
  "/tickets/:ticketId/reopen",

  route(
    "ticket.reopen",
    "tickets.verify",

    async (
      req,
      ctx
    ) => {
      return ticketService.reopen({
        entityId:
          ctx.entityId,

        ticketId:
          req.params.ticketId,

        actorPassportId:
          ctx.actorPassportId,

        expectedRevision:
          req.body?.expectedRevision ||
          req.body?.revision,

        note:
          req.body?.note
      });
    }
  )
);

module.exports = {
  ticketRouter:
    router
};
