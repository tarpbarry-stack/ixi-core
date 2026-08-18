"use strict";

const express = require("express");
const crypto = require("crypto");
const { createFreightOrder, calculateActualEconomics, validateFreightOrder } = require("./freightContract");
const { transitionFreightOrder } = require("./freightLifecycle");
const repository = require("./freightRepository");
const { beginCommand, completeCommand, failCommand } = require("./commandGuard");
const { createAdapters } = require("./integrationAdapters");

const clean = value => String(value ?? "").trim();
const now = () => new Date().toISOString();
const id = prefix => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

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

  function sendError(res, error) {
    const status = Number(error?.status || 500);
    res.status(status).json({ ok: false, error: { code: error?.code || "FREIGHT_COMMAND_FAILED", message: error?.message || "Freight command failed.", details: error?.details || null } });
  }

  async function getContext(req) {
    const resolved = await actor(req);
    const entityId = clean(resolved?.entityId || req.body?.entityId || req.query?.entityId);
    const actorId = clean(resolved?.actorId || req.body?.actorId);
    if (!entityId) {
      const error = new Error("Entity is required."); error.code = "FREIGHT_ENTITY_REQUIRED"; error.status = 400; throw error;
    }
    return { entityId, actorId };
  }

  async function withCommand(req, res, operation, work) {
    const { entityId, actorId } = await getContext(req);
    const commandId = clean(req.body?.commandId) || id(operation.replace(/[^a-z0-9]+/gi, "-"));
    const client = await pool.connect();
    try {
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
    try { await repository.ensureFreightSchema(pool); res.json({ ok: true, schema: "ixi-freight-order-v1" }); }
    catch (error) { sendError(res, error); }
  });

  router.post("/orders", (req, res) => withCommand(req, res, "freight.create", async ({ client, entityId, actorId, commandId }) => {
    const freightOrderId = clean(req.body?.freightOrderId) || `FO-${Date.now()}`;
    const record = createFreightOrder({
      id: freightOrderId, entityId, actorId, asset: req.body?.asset, route: req.body?.route,
      execution: req.body?.execution, economics: req.body?.economics, purpose: req.body?.purpose, metadata: req.body?.metadata
    });
    const validation = validateFreightOrder(record);
    if (!validation.valid) {
      const error = new Error("Freight Order is incomplete."); error.code = "FREIGHT_VALIDATION_FAILED"; error.status = 400; error.details = validation.errors; throw error;
    }
    await repository.insertOrder(client, record);
    await repository.appendEvent(client, { entityId, freightOrderId, eventType: "created", commandId, actorId, resultingRevision: 1, payload: { status: record.status } });
    return { ok: true, commandId, freightOrder: record, created: true };
  }));

  router.get("/orders/:id", async (req, res) => {
    try {
      const { entityId } = await getContext(req);
      const record = await repository.getOrder(pool, entityId, req.params.id);
      if (!record) return res.status(404).json({ ok: false, error: { code: "FREIGHT_ORDER_NOT_FOUND", message: "Freight Order not found." } });
      res.json({ ok: true, freightOrder: record });
    } catch (error) { sendError(res, error); }
  });

  router.get("/assets/:passportId/orders", async (req, res) => {
    try {
      const { entityId } = await getContext(req);
      const orders = await repository.listForAsset(pool, entityId, req.params.passportId, req.query.limit);
      res.json({ ok: true, orders });
    } catch (error) { sendError(res, error); }
  });

  router.get("/queues/open", async (req, res) => {
    try {
      const { entityId } = await getContext(req);
      const orders = await repository.listQueue(pool, entityId, ["requested","quoting","awarded","scheduled","picked-up","in-transit","delivered","billed"], req.query.limit);
      res.json({ ok: true, orders });
    } catch (error) { sendError(res, error); }
  });

  router.get("/queues/reconciliation", async (req, res) => {
    try {
      const { entityId } = await getContext(req);
      const orders = await repository.listQueue(pool, entityId, ["delivered","billed"], req.query.limit);
      res.json({ ok: true, orders });
    } catch (error) { sendError(res, error); }
  });

  router.post("/orders/:id/request", (req, res) => withCommand(req, res, "freight.request", async ({ client, entityId, actorId, commandId }) => {
    const current = await repository.getOrder(client, entityId, req.params.id);
    if (!current) { const error = new Error("Freight Order not found."); error.code = "FREIGHT_ORDER_NOT_FOUND"; error.status = 404; throw error; }
    const expectedRevision = Number(req.body?.expectedRevision || current.identity?.revision);
    const next = transitionFreightOrder(current, "requested", { actorId });
    await repository.updateOrder(client, next, expectedRevision);
    await repository.appendEvent(client, { entityId, freightOrderId: req.params.id, eventType: "requested", commandId, actorId, priorRevision: expectedRevision, resultingRevision: next.identity.revision });
    return { ok: true, commandId, freightOrder: next };
  }));

  router.post("/orders/:id/award", (req, res) => withCommand(req, res, "freight.award", async ({ client, entityId, actorId, commandId }) => {
    const current = await repository.getOrder(client, entityId, req.params.id);
    if (!current) { const error = new Error("Freight Order not found."); error.code = "FREIGHT_ORDER_NOT_FOUND"; error.status = 404; throw error; }
    const expectedRevision = Number(req.body?.expectedRevision || current.identity?.revision);
    const merged = {
      ...current,
      execution: { ...current.execution, ...(req.body?.execution || {}) },
      economics: { ...current.economics, ...(req.body?.economics || {}) }
    };
    const validation = validateFreightOrder(merged, { forAction: "award" });
    if (!validation.valid) { const error = new Error("Freight Order cannot be awarded."); error.code = "FREIGHT_VALIDATION_FAILED"; error.status = 400; error.details = validation.errors; throw error; }
    const next = transitionFreightOrder(merged, "awarded", { actorId });
    await repository.updateOrder(client, next, expectedRevision);
    await repository.appendEvent(client, { entityId, freightOrderId: req.params.id, eventType: "awarded", commandId, actorId, priorRevision: expectedRevision, resultingRevision: next.identity.revision });
    return { ok: true, commandId, freightOrder: next };
  }));

  router.post("/orders/:id/dispatch", (req, res) => withCommand(req, res, "freight.dispatch", async ({ client, entityId, actorId, commandId }) => {
    const current = await repository.getOrder(client, entityId, req.params.id);
    if (!current) { const error = new Error("Freight Order not found."); error.code = "FREIGHT_ORDER_NOT_FOUND"; error.status = 404; throw error; }
    const expectedRevision = Number(req.body?.expectedRevision || current.identity?.revision);
    const targetStatus = current.status === "awarded" ? "scheduled" : current.status;
    let next = targetStatus === current.status ? current : transitionFreightOrder(current, targetStatus, { actorId });
    const destinationContainerId = clean(next.route?.destination?.containerId || next.route?.destination?.objectId);
    const movementResult = await adapters.requestFreightMove({
      commandId: `${commandId}:mos`, entityId, objectId: next.asset.objectId, destinationContainerId, actorId,
      reason: next.purpose?.type, metadata: { freightOrderId: next.identity.freightOrderId, assetPassportId: next.asset.passportId }
    });
    next = {
      ...next,
      identity: { ...next.identity, revision: Number(next.identity.revision || expectedRevision) + 1 },
      movement: { movementId: clean(movementResult?.movementId || movementResult?.movement?.movementId || movementResult?.movement?.id), state: "scheduled" },
      audit: { ...next.audit, updatedAt: now(), updatedBy: actorId }
    };
    await repository.updateOrder(client, next, expectedRevision);
    await repository.appendEvent(client, { entityId, freightOrderId: req.params.id, eventType: "dispatched", commandId, actorId, priorRevision: expectedRevision, resultingRevision: next.identity.revision, payload: { movementId: next.movement.movementId } });
    return { ok: true, commandId, freightOrder: next, movement: movementResult };
  }));

  router.post("/orders/:id/pickup", (req, res) => withCommand(req, res, "freight.pickup", async ({ client, entityId, actorId, commandId }) => {
    const current = await repository.getOrder(client, entityId, req.params.id);
    if (!current) { const error = new Error("Freight Order not found."); error.code = "FREIGHT_ORDER_NOT_FOUND"; error.status = 404; throw error; }
    const expectedRevision = Number(req.body?.expectedRevision || current.identity?.revision);
    const validation = validateFreightOrder(current, { forAction: "pickup" });
    if (!validation.valid) { const error = new Error("Freight movement is not ready for pickup."); error.code = "FREIGHT_VALIDATION_FAILED"; error.status = 400; error.details = validation.errors; throw error; }
    const base = current.status === "scheduled" ? transitionFreightOrder(current, "picked-up", { actorId }) : current;
    const next = base.status === "picked-up" ? transitionFreightOrder(base, "in-transit", { actorId, patch: { execution: { ...base.execution, actualPickupAt: clean(req.body?.actualPickupAt) || now() }, movement: { ...base.movement, state: "in-transit" } } }) : base;
    await repository.updateOrder(client, next, expectedRevision);
    await repository.appendEvent(client, { entityId, freightOrderId: req.params.id, eventType: "picked-up", commandId, actorId, priorRevision: expectedRevision, resultingRevision: next.identity.revision, payload: { actualPickupAt: next.execution.actualPickupAt } });
    return { ok: true, commandId, freightOrder: next };
  }));

  router.post("/orders/:id/deliver", (req, res) => withCommand(req, res, "freight.deliver", async ({ client, entityId, actorId, commandId }) => {
    const current = await repository.getOrder(client, entityId, req.params.id);
    if (!current) { const error = new Error("Freight Order not found."); error.code = "FREIGHT_ORDER_NOT_FOUND"; error.status = 404; throw error; }
    const expectedRevision = Number(req.body?.expectedRevision || current.identity?.revision);
    const validation = validateFreightOrder(current, { forAction: "deliver" });
    if (!validation.valid) { const error = new Error("Freight movement is not ready for delivery."); error.code = "FREIGHT_VALIDATION_FAILED"; error.status = 400; error.details = validation.errors; throw error; }
    const movementResult = await adapters.completeFreightMove({ movementId: current.movement.movementId, commandId: `${commandId}:mos`, actorId });
    const next = transitionFreightOrder(current, "delivered", {
      actorId,
      patch: {
        execution: { ...current.execution, actualDeliveryAt: clean(req.body?.actualDeliveryAt) || now() },
        movement: { ...current.movement, state: "complete" }
      }
    });
    await repository.updateOrder(client, next, expectedRevision);
    await repository.appendEvent(client, { entityId, freightOrderId: req.params.id, eventType: "delivered", commandId, actorId, priorRevision: expectedRevision, resultingRevision: next.identity.revision, payload: { movementId: current.movement.movementId, actualDeliveryAt: next.execution.actualDeliveryAt } });
    return { ok: true, commandId, freightOrder: next, movement: movementResult };
  }));

  router.post("/orders/:id/reconcile", (req, res) => withCommand(req, res, "freight.reconcile", async ({ client, entityId, actorId, commandId }) => {
    const current = await repository.getOrder(client, entityId, req.params.id);
    if (!current) { const error = new Error("Freight Order not found."); error.code = "FREIGHT_ORDER_NOT_FOUND"; error.status = 404; throw error; }
    if (!["delivered","billed"].includes(current.status)) { const error = new Error("Freight must be delivered before reconciliation."); error.code = "FREIGHT_INVALID_STATE"; error.status = 409; throw error; }
    const expectedRevision = Number(req.body?.expectedRevision || current.identity?.revision);
    const economics = calculateActualEconomics(current, req.body?.economics || {});
    const withActuals = { ...current, economics, route: { ...current.route, actualMiles: req.body?.actualMiles == null ? current.route?.actualMiles : Number(req.body.actualMiles) } };
    const next = transitionFreightOrder(withActuals, "reconciled", { actorId });
    await repository.updateOrder(client, next, expectedRevision);
    await repository.appendEvent(client, { entityId, freightOrderId: req.params.id, eventType: "reconciled", commandId, actorId, priorRevision: expectedRevision, resultingRevision: next.identity.revision, payload: { actualTotal: economics.actualTotal, variance: economics.variance, actualPerMile: economics.actualPerMile } });
    return { ok: true, commandId, freightOrder: next };
  }));

  return router;
}

module.exports = { createFreightRouter };
