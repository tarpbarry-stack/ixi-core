#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const {
  reconcileEquipmentInventory
} = require("../mos/migrations/equipmentInventoryReconciliationService");

function argument(name) {
  const prefix = `--${name}=`;
  const entry = process.argv.slice(2).find(value => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : "";
}

try {
  const manifestPath = argument("manifest");
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifestSha256 = crypto.createHash("sha256").update(manifestBytes).digest("hex");
  const approvedSha256 = argument("manifest-sha256").trim().toLowerCase();
  if (!approvedSha256 || manifestSha256 !== approvedSha256) {
    const error = new Error("The Equipment manifest does not match the explicitly approved SHA-256 digest.");
    error.code = "AOS_EQUIPMENT_MANIFEST_DIGEST_MISMATCH";
    error.details = { approvedSha256: approvedSha256 || null, manifestSha256 };
    throw error;
  }
  const result = reconcileEquipmentInventory({
    entityId: argument("entity"),
    actorId: argument("actor"),
    expectedListingCount: Number(argument("expected-listings")),
    inventory: JSON.parse(manifestBytes.toString("utf8")),
    apply: process.argv.slice(2).includes("--apply")
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code || "AOS_EQUIPMENT_RECONCILIATION_FAILED",
    message: error?.message || String(error),
    details: error?.details || null
  }, null, 2)}\n`);
  process.exitCode = 1;
}
