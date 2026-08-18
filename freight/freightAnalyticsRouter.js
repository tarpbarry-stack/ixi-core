"use strict";

const express = require("express");

function createFreightAnalyticsRouter({ pool, resolveActor = null } = {}) {
  if (!pool) throw new Error("Freight analytics requires a PostgreSQL pool.");
  const router = express.Router();

  async function entityId(req) {
    const resolved = typeof resolveActor === "function" ? await resolveActor(req) : {};
    return String(resolved?.entityId || req.query?.entityId || req.headers["x-ixi-entity-id"] || "").trim();
  }

  router.get("/summary", async (req, res) => {
    try {
      const entity = await entityId(req);
      if (!entity) return res.status(400).json({ ok:false,error:{code:"FREIGHT_ENTITY_REQUIRED",message:"Entity is required."} });
      const result = await pool.query(`
        SELECT
          COUNT(*)::int AS order_count,
          COUNT(*) FILTER (WHERE status IN ('scheduled','picked-up','in-transit'))::int AS active_moves,
          COUNT(*) FILTER (WHERE status IN ('delivered','billed'))::int AS reconciliation_queue,
          COALESCE(SUM((record->'economics'->>'expectedTotal')::numeric),0) AS expected_total,
          COALESCE(SUM((record->'economics'->>'actualTotal')::numeric) FILTER (WHERE status IN ('reconciled','paid','closed')),0) AS actual_total,
          COALESCE(SUM((record->'route'->>'routeMiles')::numeric),0) AS route_miles,
          COALESCE(AVG(NULLIF((record->'economics'->>'actualPerMile')::numeric,0)) FILTER (WHERE status IN ('reconciled','paid','closed')),0) AS avg_actual_per_mile,
          COALESCE(AVG((record->'economics'->>'variance')::numeric) FILTER (WHERE status IN ('reconciled','paid','closed')),0) AS avg_variance
        FROM ixi_freight_orders WHERE entity_id=$1
      `,[entity]);
      const row=result.rows[0]||{};
      res.json({ok:true,summary:{
        orderCount:Number(row.order_count||0),activeMoves:Number(row.active_moves||0),reconciliationQueue:Number(row.reconciliation_queue||0),
        expectedTotal:Number(row.expected_total||0),actualTotal:Number(row.actual_total||0),routeMiles:Number(row.route_miles||0),
        averageActualPerMile:Number(row.avg_actual_per_mile||0),averageVariance:Number(row.avg_variance||0)
      }});
    } catch(error){res.status(500).json({ok:false,error:{code:"FREIGHT_ANALYTICS_FAILED",message:error.message}})}
  });

  router.get("/carriers", async (req,res)=>{
    try{
      const entity=await entityId(req);if(!entity)return res.status(400).json({ok:false,error:{code:"FREIGHT_ENTITY_REQUIRED",message:"Entity is required."}});
      const result=await pool.query(`
        SELECT
          COALESCE(NULLIF(carrier_passport_id,''), record->'execution'->>'carrierName') AS carrier_key,
          MAX(record->'execution'->>'carrierName') AS carrier_name,
          COUNT(*)::int AS loads,
          COALESCE(SUM((record->'route'->>'routeMiles')::numeric),0) AS route_miles,
          COALESCE(SUM((record->'economics'->>'actualTotal')::numeric) FILTER (WHERE status IN ('reconciled','paid','closed')),0) AS actual_spend,
          COALESCE(AVG(NULLIF((record->'economics'->>'actualPerMile')::numeric,0)) FILTER (WHERE status IN ('reconciled','paid','closed')),0) AS avg_per_mile,
          COALESCE(AVG((record->'economics'->>'variance')::numeric) FILTER (WHERE status IN ('reconciled','paid','closed')),0) AS avg_variance
        FROM ixi_freight_orders
        WHERE entity_id=$1 AND record->'execution'->>'mode'='external-carrier'
        GROUP BY carrier_key ORDER BY loads DESC
      `,[entity]);
      res.json({ok:true,carriers:result.rows.map(row=>({carrierKey:row.carrier_key,carrierName:row.carrier_name,loads:Number(row.loads||0),routeMiles:Number(row.route_miles||0),actualSpend:Number(row.actual_spend||0),averagePerMile:Number(row.avg_per_mile||0),averageVariance:Number(row.avg_variance||0)}))});
    }catch(error){res.status(500).json({ok:false,error:{code:"FREIGHT_ANALYTICS_FAILED",message:error.message}})}
  });

  router.get("/internal-fleet", async (req,res)=>{
    try{
      const entity=await entityId(req);if(!entity)return res.status(400).json({ok:false,error:{code:"FREIGHT_ENTITY_REQUIRED",message:"Entity is required."}});
      const result=await pool.query(`
        SELECT
          record->'execution'->>'truckPassportId' AS truck_passport_id,
          COUNT(*)::int AS loads,
          COALESCE(SUM((record->'route'->>'routeMiles')::numeric),0) AS route_miles,
          COALESCE(SUM((record->'economics'->>'actualTotal')::numeric),0) AS actual_cost,
          COALESCE(AVG(NULLIF((record->'economics'->>'actualPerMile')::numeric,0)),0) AS avg_per_mile
        FROM ixi_freight_orders
        WHERE entity_id=$1 AND record->'execution'->>'mode'='internal-fleet'
        GROUP BY truck_passport_id ORDER BY loads DESC
      `,[entity]);
      res.json({ok:true,trucks:result.rows.map(row=>({truckPassportId:row.truck_passport_id,loads:Number(row.loads||0),routeMiles:Number(row.route_miles||0),actualCost:Number(row.actual_cost||0),averagePerMile:Number(row.avg_per_mile||0)}))});
    }catch(error){res.status(500).json({ok:false,error:{code:"FREIGHT_ANALYTICS_FAILED",message:error.message}})}
  });

  return router;
}
module.exports={createFreightAnalyticsRouter};
