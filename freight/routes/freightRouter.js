"use strict";

const express =
  require("express");

const service =
  require(
    "../services/freightService"
  );

const {
  FreightError
} = require("../FreightError");

const {
  completeAssetMove
} = require(
  "../services/assetMoveService"
);

const router =
  express.Router();

function clean(value) {
  return String(
    value ?? ""
  ).trim();
}

function getContext(req) {
  const context =
    req.ixiFreightContext || {};

  if (
    !context.authenticated ||
    !context.aosEntityId ||
    !context.actorPassportId
  ) {
    throw new FreightError(
      "FREIGHT_AUTHENTICATION_REQUIRED",
      "Trusted Freight authentication context is required.",
      {},
      401
    );
  }

  return {
    entityId:
      clean(
        context.aosEntityId
      ),

    actorId:
      clean(
        context.actorPassportId
      ),

    entityPassportId:
      clean(
        context.entityPassportId
      )
  };
}

function sendError(
  res,
  error
) {
  return res
    .status(
      Number(
        error?.status
      ) || 500
    )
    .json({
      ok: false,

      error: {
        code:
          error?.code ||
          "FREIGHT_FAILED",

        message:
          error?.message ||
          "Freight operation failed.",

        details:
          error?.details ||
          null
      }
    });
}

router.post(
  "/orders",
  async (req, res) => {
    try {
      const context =
        getContext(req);

      const freightOrder =
        await service.create({
          ...(req.body || {}),
          ...context
        });

      return res
        .status(201)
        .json({
          ok: true,
          freightOrder
        });

    } catch (error) {
      return sendError(
        res,
        error
      );
    }
  }
);

router.get(
  "/orders/:freightOrderId",
  async (req, res) => {
    try {
      const context =
        getContext(req);

      const freightOrder =
        await service.load(
          context.entityId,
          req.params.freightOrderId
        );

      return res.json({
        ok: true,
        freightOrder
      });

    } catch (error) {
      return sendError(
        res,
        error
      );
    }
  }
);

router.get(
  "/assets/:passportId/orders",
  async (req, res) => {
    try {
      getContext(req);

      const orders =
        await service
          .listOrdersForAsset({
            passportId:
              req.params.passportId
          });

      return res.json({
        ok: true,
        orders
      });

    } catch (error) {
      return sendError(
        res,
        error
      );
    }
  }
);

function registerAction(
  suffix,
  handler
) {
  router.post(
    `/orders/:freightOrderId/${suffix}`,
    async (req, res) => {
      try {
        const context =
          getContext(req);

        const freightOrder =
          await handler({
            ...(req.body || {}),
            ...context,

            freightOrderId:
              req.params
                .freightOrderId
          });

        return res.json({
          ok: true,
          freightOrder
        });

      } catch (error) {
        return sendError(
          res,
          error
        );
      }
    }
  );
}

registerAction(
  "amend",
  service.amend
);

registerAction(
  "request",
  service.request
);

registerAction(
  "award",
  service.award
);

registerAction(
  "dispatch",
  service.dispatch
);

registerAction(
  "pickup",
  service.pickup
);

registerAction(
  "deliver",
  service.deliver
);

registerAction(
  "invoice",
  service.attachInvoice
);

registerAction(
  "reconcile",
  service.reconcile
);

router.get(
  "/orders/:freightOrderId/events",
  async (req, res) => {
    try {
      getContext(req);

      const events =
        await service
          .listFreightEvents({
            freightOrderId:
              req.params
                .freightOrderId
          });

      return res.json({
        ok: true,
        events
      });

    } catch (error) {
      return sendError(
        res,
        error
      );
    }
  }
);


router.post(
  "/asset-moves/complete",
  async (req, res) => {
    try {
      const context =
        getContext(req);

      const result =
        completeAssetMove({
          ...(req.body || {}),
          ...context
        });

      return res.json({
        ok: true,
        assetMove: result
      });

    } catch (error) {
      return sendError(
        res,
        error
      );
    }
  }
);

module.exports = {
  freightRouter: router
};
