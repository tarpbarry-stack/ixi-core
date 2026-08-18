"use strict";

const path = require("path");

const {
  createCreationIntegrityRunner
} = require("./creationIntegrityRunner");

const {
  createFileRuntimeStore
} = require("./creationIntegrityRuntimeStore");

function requireAdapter() {
  const configured = String(process.env.IXI_AOS_CREATION_INTEGRITY_ADAPTER || "").trim();
  if (!configured) {
    throw new Error("IXI_AOS_CREATION_INTEGRITY_ADAPTER is required.");
  }
  const resolved = path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  return require(resolved);
}

async function main() {
  const adapter = requireAdapter();

  for (const name of ["listEntityIds", "loadObjects", "loadPassports", "loadProvisioningRecords"]) {
    if (typeof adapter[name] !== "function") {
      throw new TypeError(`Integrity adapter must export ${name}().`);
    }
  }

  const stateFile = process.env.IXI_AOS_CREATION_INTEGRITY_STATE_FILE || path.resolve(process.cwd(), "data/mos/creation-integrity-state.json");
  const alertFile = process.env.IXI_AOS_CREATION_INTEGRITY_ALERT_FILE || path.resolve(process.cwd(), "data/mos/creation-integrity-alerts.jsonl");
  const runtime = createFileRuntimeStore({ stateFile, alertFile });

  const emitAlert = typeof adapter.emitAlert === "function"
    ? async alert => {
        // Always retain a local durable incident spool first. External alert
        // delivery is additive and may fail independently.
        runtime.emitAlert(alert);
        return adapter.emitAlert(alert);
      }
    : runtime.emitAlert;

  const runner = createCreationIntegrityRunner({
    listEntityIds: adapter.listEntityIds,
    loadObjects: adapter.loadObjects,
    loadPassports: adapter.loadPassports,
    loadProvisioningRecords: adapter.loadProvisioningRecords,
    loadState: runtime.loadState,
    saveState: runtime.saveState,
    emitAlert,
    passportEntityEnforcementAt: process.env.IXI_AOS_PASSPORT_ENTITY_ENFORCEMENT_AT || ""
  });

  const result = await runner.runAll();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  // Operational scheduling must distinguish integrity defects from runner
  // execution defects. Integrity findings use exit 2; infrastructure/runtime
  // failures use exit 1; a fully healthy fleet uses exit 0.
  if (result.failedRuns > 0) {
    process.exitCode = 1;
  } else if (result.unhealthyTenants > 0) {
    process.exitCode = 2;
  }
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code || "INTEGRITY_WORKER_FAILED",
    message: error?.message || String(error)
  }, null, 2)}\n`);
  process.exitCode = 1;
});