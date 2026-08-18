"use strict";

const express = require("express");
const crypto = require("crypto");
const { createAdapters } = require("./integrationAdapters");

const clean = value => String(value ?? "").trim();
const makeId = prefix => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

async function ensureAssetMoveSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ixi_asset_moves (
      entity_id TEXT NOT NULL,
      asset_move_id TEXT NOT NULL,
      asset_passport_id TEXT NOT NULL,
      asset_object_id TEXT NOT NULL,
      movement_id TEXT,
      move_type TEXT NOT NULL,
      from_object_id TEXT,
      from_passport_id TEXT,
      to_object_id TEXT NOT NULL,
      to_passport_id TEXT,
      status TEXT NOT NULL,
      record JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      PRIMARY KEY(entity_id, asset_move_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS ixi_asset_moves_asset_idx ON ixi_asset_moves(entity_id, asset_passport_id, created_at DESC);`);
}

function createAssetMoveRouter({ pool, adapters = createAdapters(), resolveActor = null } = {}) {
  if (!pool) throw new Error("Asset Move router requires a PostgreSQL pool.");
  const router = express.Router();

  async function context(req) {
    const resolved = typeof resolveActor === "function" ? await resolveActor(req) : {};
    const entityId = clean(resolved?.entityId || req.body?.entityId || req.query?.entityId || req.headers["x-ixi-entity-id"]);
    const actorId = clean(resolved?.actorId || req.body?.actorId || req.headers["x-ixi-actor-id"]);
    if (!entityId) { const error = new Error("Entity is required."); error.status = 400; error.code = "ASSET_MOVE_ENTITY_REQUIRED"; throw error; }
    return { entityId, actorId };
  }

  function sendError(res, error) {
    res.status(Number(error?.status || 500)).json({ ok: false, error: { code: error?.code || "ASSET_MOVE_FAILED", message: error?.message || "Asset Move failed." } });
  }

  router.post("/setup", async (req, res) => {
    try { await ensureAssetMoveSchema(pool); res.json({ ok: true, schema: "ixi-asset-move-v1" }); }
    catch (error) { sendError(res, error); }
  });

  router.post("/orders", async (req, res) => {
    const client = await pool.connect();
    try {
      const { entityId, actorId } = await context(req);
      const asset = req.body?.asset || {};
      const from = req.body?.from || {};
      const to = req.body?.to || {};
      if (!clean(asset.objectId) || !clean(asset.passportId)) { const e = new Error("Asset identity is required."); e.code="ASSET_MOVE_ASSET_REQUIRED"; e.status=400; throw e; }
      if (!clean(to.objectId || to.containerId)) { const e = new Error("Destination is required."); e.code="ASSET_MOVE_DESTINATION_REQUIRED"; e.status=400; throw e; }
      const commandId = clean(req.body?.commandId) || makeId("asset-move");
      const assetMoveId = clean(req.body?.assetMoveId) || `AMO-${Date.now()}`;
      await client.query("BEGIN");
      const existing = await client.query(`SELECT record FROM ixi_asset_moves WHERE entity_id=$1 AND asset_move_id=$2 FOR UPDATE`, [entityId, assetMoveId]);
      if (existing.rowCount) { await client.query("COMMIT"); return res.json({ ok: true, assetMove: existing.rows[0].record, idempotentReplay: true }); }
      const movementResult = await adapters.moveAssetImmediately({
        commandId: `${commandId}:mos`, entityId, objectId: clean(asset.objectId),
        destinationContainerId: clean(to.containerId || to.objectId), actorId,
        reason: clean(req.body?.reason), metadata: { assetMoveId, moveType: clean(req.body?.moveType || "location"), assetPassportId: clean(asset.passportId) }
      });
      const timestamp = new Date().toISOString();
      const record = {
        schema: "ixi-asset-move-v1",
        identity: { assetMoveId, commandId, movementId: clean(movementResult?.movementId || movementResult?.movement?.movementId || movementResult?.movement?.id) },
        entity: { entityId },
        asset: { objectId: clean(asset.objectId), passportId: clean(asset.passportId), label: clean(asset.label), objectType: clean(asset.objectType) },
        move: { type: clean(req.body?.moveType || "location"), from, to, effectiveAt: clean(req.body?.effectiveAt) || timestamp, reason: clean(req.body?.reason), notes: clean(req.body?.notes) },
        status: "completed",
        audit: { requestedBy: actorId, requestedAt: timestamp, completedBy: actorId, completedAt: timestamp }
      };
      await client.query(`
        INSERT INTO ixi_asset_moves(entity_id, asset_move_id, asset_passport_id, asset_object_id, movement_id, move_type, from_object_id, from_passport_id, to_object_id, to_passport_id, status, record, completed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'completed',$11::jsonb,NOW())
      `, [entityId, assetMoveId, asset.passportId, asset.objectId, record.identity.movementId, record.move.type, clean(from.objectId), clean(from.passportId), clean(to.objectId || to.containerId), clean(to.passportId), JSON.stringify(record)]);
      await client.query("COMMIT");
      res.json({ ok: true, assetMove: record, movement: movementResult });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      sendError(res, error);
    } finally { client.release(); }
  });

  router.get("/assets/:passportId", async (req, res) => {
    try {
      const { entityId } = await context(req);
      const result = await pool.query(`SELECT record FROM ixi_asset_moves WHERE entity_id=$1 AND asset_passport_id=$2 ORDER BY created_at DESC LIMIT 100`, [entityId, req.params.passportId]);
      res.json({ ok: true, moves: result.rows.map(row => row.record) });
    } catch (error) { sendError(res, error); }
  });

  return router;
}

module.exports = { createAssetMoveRouter, ensureAssetMoveSchema };
