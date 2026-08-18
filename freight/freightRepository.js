"use strict";

async function ensureFreightSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ixi_freight_orders (
      entity_id TEXT NOT NULL,
      freight_order_id TEXT NOT NULL,
      asset_passport_id TEXT NOT NULL,
      asset_object_id TEXT NOT NULL,
      status TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      carrier_passport_id TEXT,
      destination_object_id TEXT,
      required_delivery_at TIMESTAMPTZ,
      record JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (entity_id, freight_order_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS ixi_freight_orders_asset_idx ON ixi_freight_orders(entity_id, asset_passport_id, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ixi_freight_orders_status_idx ON ixi_freight_orders(entity_id, status, required_delivery_at, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ixi_freight_orders_carrier_idx ON ixi_freight_orders(entity_id, carrier_passport_id, created_at DESC);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ixi_freight_events (
      event_id BIGSERIAL PRIMARY KEY,
      entity_id TEXT NOT NULL,
      freight_order_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      command_id TEXT,
      actor_id TEXT,
      prior_revision INTEGER,
      resulting_revision INTEGER,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS ixi_freight_events_order_idx ON ixi_freight_events(entity_id, freight_order_id, occurred_at);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ixi_command_executions (
      entity_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      result JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(entity_id, command_id)
    );
  `);
}

function orderColumns(record) {
  return [
    record.entity.entityId,
    record.identity.freightOrderId,
    record.asset.passportId,
    record.asset.objectId,
    record.status,
    Number(record.identity.revision || 1),
    record.execution?.carrierPassportId || null,
    record.route?.destination?.objectId || record.route?.destination?.containerId || null,
    record.execution?.expectedDeliveryAt || null,
    JSON.stringify(record)
  ];
}

async function insertOrder(client, record) {
  await client.query(`
    INSERT INTO ixi_freight_orders (
      entity_id, freight_order_id, asset_passport_id, asset_object_id, status, revision,
      carrier_passport_id, destination_object_id, required_delivery_at, record
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
  `, orderColumns(record));
  return record;
}

async function getOrder(pool, entityId, freightOrderId) {
  const result = await pool.query(
    `SELECT record FROM ixi_freight_orders WHERE entity_id=$1 AND freight_order_id=$2`,
    [entityId, freightOrderId]
  );
  return result.rows[0]?.record || null;
}

async function updateOrder(client, record, expectedRevision) {
  const values = orderColumns(record);
  const result = await client.query(`
    UPDATE ixi_freight_orders SET
      asset_passport_id=$3, asset_object_id=$4, status=$5, revision=$6,
      carrier_passport_id=$7, destination_object_id=$8, required_delivery_at=$9,
      record=$10::jsonb, updated_at=NOW()
    WHERE entity_id=$1 AND freight_order_id=$2 AND revision=$11
    RETURNING freight_order_id
  `, [...values, Number(expectedRevision)]);
  if (!result.rowCount) {
    const error = new Error("Freight Order changed since it was loaded.");
    error.code = "FREIGHT_VERSION_CONFLICT";
    error.status = 409;
    throw error;
  }
  return record;
}

async function appendEvent(client, { entityId, freightOrderId, eventType, commandId = "", actorId = "", priorRevision = null, resultingRevision = null, payload = {} }) {
  await client.query(`
    INSERT INTO ixi_freight_events(entity_id, freight_order_id, event_type, command_id, actor_id, prior_revision, resulting_revision, payload)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
  `, [entityId, freightOrderId, eventType, commandId, actorId, priorRevision, resultingRevision, JSON.stringify(payload || {})]);
}

async function listForAsset(pool, entityId, passportId, limit = 50) {
  const result = await pool.query(`
    SELECT record FROM ixi_freight_orders
    WHERE entity_id=$1 AND asset_passport_id=$2
    ORDER BY created_at DESC LIMIT $3
  `, [entityId, passportId, Math.min(Math.max(Number(limit) || 50, 1), 200)]);
  return result.rows.map(row => row.record);
}

async function listQueue(pool, entityId, statuses, limit = 100) {
  const result = await pool.query(`
    SELECT record FROM ixi_freight_orders
    WHERE entity_id=$1 AND status = ANY($2::text[])
    ORDER BY required_delivery_at NULLS LAST, updated_at DESC LIMIT $3
  `, [entityId, statuses, Math.min(Math.max(Number(limit) || 100, 1), 500)]);
  return result.rows.map(row => row.record);
}

module.exports = { ensureFreightSchema, insertOrder, getOrder, updateOrder, appendEvent, listForAsset, listQueue };
