"use strict";

const express = require("express");
const crypto = require("crypto");
const { createFreightOrder, calculateActualEconomics, validateFreightOrder } = require("./freightContract");
const { transitionFreightOrder } = require("./freightLifecycle");
const repository = require("./freightRepository");
const { beginCommand, completeCommand, failCommand } = require("./commandGuard");
const { createAdapters } = require("./integrationAdapters");

const clean = value => String(value ?? "").trim();
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const now = () => new Date().toISOString();
const makeId = prefix => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

function financialRecordId(result) {
  return clean(
    result?.financialDocument?.financialDocumentId ||
    result?.financialDocument?.identity?.financialDocumentId ||
    result?.financialDocument?.identity?.documentId ||
    result?.financialDocument?.id ||
    result?.record?.identity?.financialDocumentId ||
    result?.record?.identity?.documentId ||
    result?.record?.id
  );
}

function buildFreightFinancialInput(record, { state = "committed", amount = null } = {}) {
  return {
    state,
    amount: amount == null ? num(record?.economics?.expectedTotal) : num(amount),
    currency: "USD",
    description: `Freight Order ${record?.identity?.freightOrderId || ""}`.trim(),
    source: { type: "freight-order", id: clean(record?.identity?.freightOrderId) },
    references: [
      { passportId: clean(record?.asset?.passportId), role: "asset", label: clean(record?.asset?.label) },
      clean(record?.execution?.carrierPassportId)
        ? { passportId: clean(record.execution.carrierPassportId), role: "vendor", label: clean(record.execution.carrierName) }
        : null,
      clean(record?.route?.origin?.passportId)
        ? { passportId: clean(record.route.origin.passportId), role: "source", label: clean(record.route.origin.label) }
        : null,
      clean(record?.route?.destination?.passportId)
        ? { passportId: clean(record.route.destination.passportId), role: "destination", label: clean(record.route.destination.label) }
        : null
    ].filter(Boolean),
    metadata: {
      purpose: clean(record?.purpose?.type),
      routeMiles: num(record?.route?.routeMiles),
      mode: clean(record?.execution?.mode)
    }
  };
}

function createFreightRouter({ pool, adapters = createAdapters(), resolveActor = null } = {}) {
  if (!pool) throw new Error("Freight router requires a PostgreSQL pool.");
  const router = express.Router();

  async function actor(req) {
    if (typeof resolveActor === "function") return resolveActor(req);
    return {
      actorId: clean(req.user?.id || req.headers["x-ixi-actor-id"]),
      entityId: clean(req.user?.entityId || req.headers["x-ixi-entity-id"])
    };
  }

  async function getContext(req) {
    const resolved = await actor(req);
    const entityId = clean(resolved?.entityId || req.body?.entityId || req.query?.entityId);
    const actorId = clean(resolved?.actorId || req.body?.actorId);
    if (!entityId) {
      const error = new Error("Entity is required.");
      error.code = "FREIGHT_ENTITY_REQUIRED";
      error.status = 400;
      throw error;
    }
    return { entityId, actorId };
  }

  function sendError(res, error) {
    return res.status(Number(error?.status || 500)).json({
      ok: false,
      error: {
        code: error?.code || "FREIGHT_COMMAND_FAILED",
        message: error?.message || "Freight command failed.",
        details: error?.details || null
      }
    });
  }

  async function requireOrder(store, entityId, freightOrderId) {
    const record = await repository.getOrder(store, entityId, freightOrderId);
    if (!record) {
      const error = new Error("Freight Order not found.");
      error.code = "FREIGHT_ORDER_NOT_FOUND";
      error.status = 404;
      throw error;
    }
    return record;
  }

  async function withCommand(req, res, operation, work) {
    let entityId = "";
    let actorId = "";
    let commandId = "";
    const client = await pool.connect();
    try {
      ({ entityId, actorId } = await getContext(req));
      commandId = clean(req.body?.commandId) || makeId(operation.replace(/[^a-z0-9]+/gi, "-"));
      await client.query("BEGIN");
      const guard = await beginCommand(client, { entityId, commandId, operation, payload: req.body });
      if (guard.replay) {
        await client.query("COMMIT");
        return res.json({ ...guard.result, idempotentReplay: true });
      }
      const result = await work({ client, entityId, actorId, commandId });
      await completeCommand(client, { entityId, commandId, result });
      await client.query("COMMIT");
      return res.json(result);
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      try { await failCommand(pool, { entityId, commandId, error }); } catch {}
      return sendError(res, error);
    } finally {
      client.release();
    }
  }

  router.post("/setup", async (req, res) => {
    try {
      await repository.ensureFreightSchema(pool);
      return res.json({ ok: true, schema: "ixi-freight-order-v1" });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post("/orders", (req, res) => withCommand(req, res, "freight.create", async ({ client, entityId, actorId, commandId }) => {
    const freightOrderId = clean(req.body?.freightOrderId) || `FO-${Date.now()}`;
    const record = createFreightOrder({
      id: freightOrderId,
      entityId,
      actorId,
      asset: req.body?.asset,
      route: req.body?.route,
      execution: req.body?.execution,
      economics: req.body?.economics,
      purpose: req.body?.purpose,
      metadata: req.body?.metadata
    });
    const validation = validateFreightOrder(record);
    if (!validation.valid) {
      const error = new Error("Freight Order is incomplete.");
      error.code = "FREIGHT_VALIDATION_FAILED";
      error.status = 400;
      error.details = validation.errors;
      throw error;
    }
    await repository.insertOrder(client, record);
    await repository.appendEvent(client, {
      entityId, freightOrderId, eventType: "created", commandId, actorId,
      resultingRevision: record.identity.revision, payload: { status: record.status }
    });
    return { ok: true, commandId, freightOrder: record, created: true };
  }));

  router.get("/orders/:id", async (req, res) => {
    try {
      const { entityId } = await getContext(req);
      const freightOrder = await requireOrder(pool, entityId, req.params.id);
      return res.json({ ok: true, freightOrder });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/assets/:passportId/orders", async (req, res) => {
    try {
      const { entityId } = await getContext(req);
      const orders = await repository.listForAsset(pool, entityId, req.params.passportId, req.query.limit);
      return res.json({ ok: true, orders });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/queues/open", async (req, res) => {
    try {
      const { entityId } = await getContext(req);
      const orders = await repository.listQueue(
        pool,
        entityId,
        ["requested","quoting","awarded","scheduled","picked-up","in-transit","delivered","billed"],
        req.query.limit
      );
      return res.json({ ok: true, orders });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/queues/reconciliation", async (req, res) => {
    try {
      const { entityId } = await getContext(req);
      const orders = await repository.listQueue(pool, entityId, ["delivered","billed"], req.query.limit);
      return res.json({ ok: true, orders });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post("/orders/:id/request", (req, res) => withCommand(req, res, "freight.request", async ({ client, entityId, actorId, commandId }) => {
    const current = await requireOrder(client, entityId, req.params.id);
    const expectedRevision = Number(req.body?.expectedRevision || current.identity?.revision);
    const next = transitionFreightOrder(current, "requested", { actorId });
    await repository.updateOrder(client, next, expectedRevision);
    await repository.appendEvent(client, {
      entityId, freightOrderId: req.params.id, eventType: "requested", commandId, actorId,
      priorRevision: expectedRevision, resultingRevision: next.identity.revision
    });
    return { ok: true, commandId, freightOrder: next };
  }));

  router.post("/orders/:id/award", (req, res) => withCommand(req, res, "freight.award", async ({ client, entityId, actorId, commandId }) => {
    const current = await requireOrder(client, entityId, req.params.id);
    const expectedRevision = Number(req.body?.expectedRevision || current.identity?.revision);
    const merged = {
      ...current,
      execution: { ...current.execution, ...(req.body?.execution || {}) },
      economics: { ...current.economics, ...(req.body?.economics || {}) }
    };
    const validation = validateFreightOrder(merged, { forAction: "award" });
    if (!validation.valid) {
      const error = new Error("Freight Order cannot be awarded.");
      error.code = "FREIGHT_VALIDATION_FAILED";
      error.status = 400;
      error.details = validation.errors;
      throw error;
    }

    const financialResult = await adapters.createFinancialDocument({
      documentType: "freight",
      commandId: `${commandId}:financial`,
      idempotencyKey: `freight:${merged.identity.freightOrderId}:commitment`,
      input: buildFreightFinancialInput(merged, { state: "committed" }),
      metadata: { source: "ixi-freight", operation: "award", entityId }
    });

    const next = transitionFreightOrder(merged, "awarded", {
      actorId,
      patch: {
        financial: {
          ...merged.financial,
          financialDocumentId: financialRecordId(financialResult) || merged.financial?.financialDocumentId || ""
        }
      }
    });
    await repository.updateOrder(client, next, expectedRevision);
    await repository.appendEvent(client, {
      entityId, freightOrderId: req.params.id, eventType: "awarded", commandId, actorId,
      priorRevision: expectedRevision, resultingRevision: next.identity.revision,
      payload: { financialDocumentId: next.financial.financialDocumentId, expectedTotal: next.economics.expectedTotal }
    });
    return { ok: true, commandId, freightOrder: next, financial: financialResult };
  }));

  router.post("/orders/:id/dispatch", (req, res) => withCommand(req, res, "freight.dispatch", async ({ client, entityId, actorId, commandId }) => {
    const current = await requireOrder(client, entityId, req.params.id);
    if (current.status !== "awarded") {
      const error = new Error("Only an awarded Freight Order can be dispatched.");
      error.code = "FREIGHT_INVALID_STATE";
      error.status = 409;
      throw error;
    }
    const expectedRevision = Number(req.body?.expectedRevision || current.identity?.revision);
    const destinationContainerId = clean(current.route?.destination?.containerId || current.route?.destination?.objectId);
    const movementResult = await adapters.requestFreightMove({
      commandId: `${commandId}:mos`,
      entityId,
      objectId: current.asset.objectId,
      destinationContainerId,
      actorId,
      reason: current.purpose?.type,
      metadata: {
        freightOrderId: current.identity.freightOrderId,
        assetPassportId: current.asset.passportId,
        expectedDeliveryAt: current.execution?.expectedDeliveryAt || ""
      }
    });
    const movementId = clean(movementResult?.movementId || movementResult?.movement?.movementId || movementResult?.movement?.id);
    if (!movementId) {
      const error = new Error("MOS did not return a movementId.");
      error.code = "FREIGHT_MOVEMENT_FAILED";
      error.status = 502;
      throw error;
    }
    const next = transitionFreightOrder(current, "scheduled", {
      actorId,
      patch: { movement: { movementId, state: "scheduled" } }
    });
    await repository.updateOrder(client, next, expectedRevision);
    await repository.appendEvent(client, {
      entityId, freightOrderId: req.params.id, eventType: "dispatched", commandId, actorId,
      priorRevision: expectedRevision, resultingRevision: next.identity.revision, payload: { movementId }
    });
    return { ok: true, commandId, freightOrder: next, movement: movementResult };
  }));

  router.post("/orders/:id/pickup", (req, res) => withCommand(req, res, "freight.pickup", async ({ client, entityId, actorId, commandId }) => {
    const current = await requireOrder(client, entityId, req.params.id);
    if (current.status !== "scheduled") {
      const error = new Error("Only a scheduled Freight Order can be picked up.");
      error.code = "FREIGHT_INVALID_STATE";
      error.status = 409;
      throw error;
    }
    const expectedRevision = Number(req.body?.expectedRevision || current.identity?.revision);
    const validation = validateFreightOrder(current, { forAction: "pickup" });
    if (!validation.valid) {
      const error = new Error("Freight movement is not ready for pickup.");
      error.code = "FREIGHT_VALIDATION_FAILED";
      error.status = 400;
      error.details = validation.errors;
      throw error;
    }
    const picked = transitionFreightOrder(current, "picked-up", { actorId });
    const next = transitionFreightOrder(picked, "in-transit", {
      actorId,
      patch: {
        execution: { ...picked.execution, actualPickupAt: clean(req.body?.actualPickupAt) || now() },
        movement: { ...picked.movement, state: "in-transit" }
      }
    });
    await repository.updateOrder(client, next, expectedRevision);
    await repository.appendEvent(client, {
      entityId, freightOrderId: req.params.id, eventType: "picked-up", commandId, actorId,
      priorRevision: expectedRevision, resultingRevision: next.identity.revision,
      payload: { actualPickupAt: next.execution.actualPickupAt }
    });
    return { ok: true, commandId, freightOrder: next };
  }));

  router.post("/orders/:id/deliver", (req, res) => withCommand(req, res, "freight.deliver", async ({ client, entityId, actorId, commandId }) => {
    const current = await requireOrder(client, entityId, req.params.id);
    if (!["picked-up","in-transit"].includes(current.status)) {
      const error = new Error("Only freight in transit can be delivered.");
      error.code = "FREIGHT_INVALID_STATE";
      error.status = 409;
      throw error;
    }
    const expectedRevision = Number(req.body?.expectedRevision || current.identity?.revision);
    const validation = validateFreightOrder(current, { forAction: "deliver" });
    if (!validation.valid) {
      const error = new Error("Freight movement is not ready for delivery.");
      error.code = "FREIGHT_VALIDATION_FAILED";
      error.status = 400;
      error.details = validation.errors;
      throw error;
    }
    const movementResult = await adapters.completeFreightMove({
      movementId: current.movement.movementId,
      commandId: `${commandId}:mos`,
      actorId
    });
    const next = transitionFreightOrder(current, "delivered", {
      actorId,
      patch: {
        execution: { ...current.execution, actualDeliveryAt: clean(req.body?.actualDeliveryAt) || now() },
        movement: { ...current.movement, state: "complete" }
      }
    });
    await repository.updateOrder(client, next, expectedRevision);
    await repository.appendEvent(client, {
      entityId, freightOrderId: req.params.id, eventType: "delivered", commandId, actorId,
      priorRevision: expectedRevision, resultingRevision: next.identity.revision,
      payload: { movementId: current.movement.movementId, actualDeliveryAt: next.execution.actualDeliveryAt }
    });
    return { ok: true, commandId, freightOrder: next, movement: movementResult };
  }));

  router.post("/orders/:id/bill", (req, res) => withCommand(req, res, "freight.bill", async ({ client, entityId, actorId, commandId }) => {
    const current = await requireOrder(client, entityId, req.params.id);
    if (current.status !== "delivered") {
      const error = new Error("Carrier Bill can be attached after delivery.");
      error.code = "FREIGHT_INVALID_STATE";
      error.status = 409;
      throw error;
    }
    const expectedRevision = Number(req.body?.expectedRevision || current.identity?.revision);
    const invoiceAmount = num(req.body?.invoiceAmount);
    if (!(invoiceAmount >= 0)) {
      const error = new Error("Carrier invoice amount is required.");
      error.code = "FREIGHT_BILL_REQUIRED";
      error.status = 400;
      throw error;
    }
    const billResult = await adapters.createFinancialDocument({
      documentType: "bill",
      commandId: `${commandId}:financial`,
      idempotencyKey: `freight:${current.identity.freightOrderId}:bill:${clean(req.body?.invoiceNumber) || invoiceAmount}`,
      input: {
        amount: invoiceAmount,
        currency: "USD",
        vendorPassportId: clean(current.execution?.carrierPassportId),
        vendorLabel: clean(current.execution?.carrierName),
        invoiceNumber: clean(req.body?.invoiceNumber),
        invoiceDate: clean(req.body?.invoiceDate),
        description: `Freight ${current.identity.freightOrderId}`,
        source: { type: "freight-order", id: current.identity.freightOrderId },
        references: buildFreightFinancialInput(current, { state: "billed", amount: invoiceAmount }).references,
        metadata: { freightOrderId: current.identity.freightOrderId }
      },
      metadata: { source: "ixi-freight", operation: "carrier-bill", entityId }
    });
    const next = transitionFreightOrder(current, "billed", {
      actorId,
      patch: {
        financial: {
          ...current.financial,
          billId: financialRecordId(billResult) || current.financial?.billId || ""
        },
        economics: {
          ...current.economics,
          carrierInvoiceAmount: invoiceAmount
        }
      }
    });
    await repository.updateOrder(client, next, expectedRevision);
    await repository.appendEvent(client, {
      entityId, freightOrderId: req.params.id, eventType: "bill-attached", commandId, actorId,
      priorRevision: expectedRevision, resultingRevision: next.identity.revision,
      payload: { billId: next.financial.billId, invoiceAmount, invoiceNumber: clean(req.body?.invoiceNumber) }
    });
    return { ok: true, commandId, freightOrder: next, bill: billResult };
  }));

  router.post("/orders/:id/reconcile", (req, res) => withCommand(req, res, "freight.reconcile", async ({ client, entityId, actorId, commandId }) => {
    const current = await requireOrder(client, entityId, req.params.id);
    if (!["delivered","billed"].includes(current.status)) {
      const error = new Error("Freight must be delivered before reconciliation.");
      error.code = "FREIGHT_INVALID_STATE";
      error.status = 409;
      throw error;
    }
    const expectedRevision = Number(req.body?.expectedRevision || current.identity?.revision);
    const withMiles = {
      ...current,
      route: {
        ...current.route,
        actualMiles: req.body?.actualMiles == null || req.body?.actualMiles === ""
          ? current.route?.actualMiles
          : Math.max(0, num(req.body.actualMiles))
      }
    };
    const economics = calculateActualEconomics(withMiles, req.body?.economics || {});
    const next = transitionFreightOrder({ ...withMiles, economics }, "reconciled", {
      actorId,
      patch: {
        financial: {
          ...current.financial,
          reconciliationId: clean(current.financial?.reconciliationId) || `FREC-${Date.now()}`
        }
      }
    });
    await repository.updateOrder(client, next, expectedRevision);
    await repository.appendEvent(client, {
      entityId, freightOrderId: req.params.id, eventType: "reconciled", commandId, actorId,
      priorRevision: expectedRevision, resultingRevision: next.identity.revision,
      payload: {
        actualTotal: economics.actualTotal,
        variance: economics.variance,
        actualPerMile: economics.actualPerMile,
        actualMiles: next.route.actualMiles
      }
    });
    return { ok: true, commandId, freightOrder: next };
  }));

  return router;
}

module.exports = { createFreightRouter, buildFreightFinancialInput };
