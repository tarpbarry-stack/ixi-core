"use strict";

function trimBase(value, fallback) {
  return String(value || fallback || "").replace(/\/+$/, "");
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(options.headers || {}) }
  });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.error?.message || `Integration request failed with HTTP ${response.status}.`);
    error.code = payload?.error?.code || "INTEGRATION_REQUEST_FAILED";
    error.status = response.status || 502;
    error.details = payload?.error?.details || null;
    throw error;
  }
  return payload;
}

function createAdapters({ mosBaseUrl = process.env.IXI_MOS_BASE_URL, financialBaseUrl = process.env.IXI_FINANCIAL_BASE_URL, serviceToken = process.env.IXI_INTERNAL_SERVICE_TOKEN } = {}) {
  const mosBase = trimBase(mosBaseUrl, "http://127.0.0.1:4100/mos/v1");
  const financialBase = trimBase(financialBaseUrl, "http://127.0.0.1:4100/financial");
  const authHeaders = serviceToken ? { Authorization: `Bearer ${serviceToken}`, "X-IXI-Service": "freight" } : { "X-IXI-Service": "freight" };

  return {
    async requestFreightMove({ commandId, entityId, objectId, destinationContainerId, actorId, reason, metadata = {} }) {
      const freightOrderId = String(metadata?.freightOrderId || "").trim();
      const stableCommandId = freightOrderId ? `freight:${freightOrderId}:movement` : commandId;
      return jsonRequest(`${mosBase}/movements/freight`, {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ commandId: stableCommandId, entityId, objectId, destinationContainerId, actorId, reason, metadata })
      });
    },

    async completeFreightMove({ movementId, commandId, actorId }) {
      const stableCommandId = movementId ? `freight-movement:${movementId}:complete` : commandId;
      return jsonRequest(`${mosBase}/movements/${encodeURIComponent(movementId)}/complete`, {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ commandId: stableCommandId, actorId })
      });
    },

    async moveAssetImmediately({ commandId, entityId, objectId, destinationContainerId, actorId, reason, metadata = {} }) {
      const assetMoveId = String(metadata?.assetMoveId || "").trim();
      const stableCommandId = assetMoveId ? `asset-move:${assetMoveId}:movement` : commandId;
      return jsonRequest(`${mosBase}/movements/immediate`, {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ commandId: stableCommandId, entityId, objectId, destinationContainerId, movementType: "asset-move", actorId, reason, metadata })
      });
    },

    async createFinancialDocument({ documentType, commandId, idempotencyKey, input, metadata }) {
      return jsonRequest(`${financialBase}/commands/create`, {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ documentType, commandId, idempotencyKey, input, metadata })
      });
    }
  };
}

module.exports = { createAdapters, jsonRequest };
