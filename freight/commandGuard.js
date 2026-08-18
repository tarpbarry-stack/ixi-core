"use strict";

const crypto = require("crypto");

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value || {})).digest("hex");
}

async function beginCommand(client, { entityId, commandId, operation, payload }) {
  if (!commandId) {
    const error = new Error("commandId is required.");
    error.code = "COMMAND_ID_REQUIRED";
    error.status = 400;
    throw error;
  }
  const requestHash = stableHash(payload);
  const existing = await client.query(
    `SELECT request_hash, status, result FROM ixi_command_executions WHERE entity_id=$1 AND command_id=$2 FOR UPDATE`,
    [entityId, commandId]
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (row.request_hash !== requestHash) {
      const error = new Error("commandId was already used with a different request.");
      error.code = "IDEMPOTENCY_CONFLICT";
      error.status = 409;
      throw error;
    }
    if (row.status === "succeeded") return { replay: true, result: row.result, requestHash };
    if (row.status === "processing") {
      const error = new Error("Command is already processing.");
      error.code = "COMMAND_IN_PROGRESS";
      error.status = 409;
      throw error;
    }
    await client.query(`UPDATE ixi_command_executions SET status='processing', updated_at=NOW() WHERE entity_id=$1 AND command_id=$2`, [entityId, commandId]);
    return { replay: false, requestHash };
  }
  await client.query(`
    INSERT INTO ixi_command_executions(entity_id, command_id, operation, request_hash, status)
    VALUES($1,$2,$3,$4,'processing')
  `, [entityId, commandId, operation, requestHash]);
  return { replay: false, requestHash };
}

async function completeCommand(client, { entityId, commandId, result }) {
  await client.query(`
    UPDATE ixi_command_executions SET status='succeeded', result=$3::jsonb, updated_at=NOW()
    WHERE entity_id=$1 AND command_id=$2
  `, [entityId, commandId, JSON.stringify(result || {})]);
}

async function failCommand(client, { entityId, commandId, error }) {
  if (!entityId || !commandId) return;
  await client.query(`
    UPDATE ixi_command_executions SET status='failed', result=$3::jsonb, updated_at=NOW()
    WHERE entity_id=$1 AND command_id=$2
  `, [entityId, commandId, JSON.stringify({ ok: false, error: { code: error?.code || "COMMAND_FAILED", message: error?.message || "Command failed." } })]);
}

module.exports = { stableHash, beginCommand, completeCommand, failCommand };
