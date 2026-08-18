"use strict";

const express = require("express");
const { calculateFreightRoute } = require("./routeService");

function createFreightRouteRouter() {
  const router = express.Router();
  router.post("/calculate", async (req, res) => {
    try {
      const route = await calculateFreightRoute({
        origin: req.body?.origin,
        destination: req.body?.destination,
        provider: req.body?.provider
      });
      res.json({ ok: true, route });
    } catch (error) {
      res.status(Number(error?.status || 500)).json({
        ok: false,
        error: {
          code: error?.code || "FREIGHT_ROUTE_FAILED",
          message: error?.message || "Freight route calculation failed.",
          details: error?.details || null
        }
      });
    }
  });
  return router;
}

module.exports = { createFreightRouteRouter };
