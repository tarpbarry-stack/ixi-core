"use strict";

const express = require("express");
const { calculateFreightRoute } = require("./routeService");

function createFreightRouteRouter({resolveActor=null}={}) {
  const router = express.Router();
  router.post("/calculate", async (req, res) => {
    try {
      if(typeof resolveActor==="function"){
        const actor=await resolveActor(req);
        if(!actor?.actorId&&!actor?.userId){
          const error=new Error("Authenticated actor is required.");error.code="FREIGHT_PERMISSION_DENIED";error.status=403;throw error;
        }
      }else if(process.env.NODE_ENV==="production"){
        const error=new Error("Trusted route authorization is not configured.");error.code="FREIGHT_PERMISSION_DENIED";error.status=503;throw error;
      }
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
