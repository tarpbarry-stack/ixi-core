"use strict";

const { createFreightRouter } = require("./freightRouter");
const { createAssetMoveRouter, ensureAssetMoveSchema } = require("./assetMoveRouter");
const { ensureFreightSchema } = require("./freightRepository");
const { createAdapters } = require("./integrationAdapters");

async function initializeFreightSubsystem(pool) {
  await ensureFreightSchema(pool);
  await ensureAssetMoveSchema(pool);
}

function registerFreightSubsystem(app, { pool, resolveActor = null, adapters = createAdapters() } = {}) {
  if (!app || !pool) throw new Error("registerFreightSubsystem requires app and pool.");
  app.use("/freight/v1", createFreightRouter({ pool, resolveActor, adapters }));
  app.use("/asset-moves/v1", createAssetMoveRouter({ pool, resolveActor, adapters }));
  return { initialize: () => initializeFreightSubsystem(pool) };
}

module.exports = { registerFreightSubsystem, initializeFreightSubsystem };
