#!/usr/bin/env node
"use strict";

try {
  const error = new Error(
    "This operation is retired. Use reconcile-aos-equipment-inventory.js with an exact approved listing manifest and SHA-256 digest."
  );
  error.code = "AOS_EQUIPMENT_ALL_ACTIVE_REPAIR_RETIRED";
  throw error;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code || "AOS_EQUIPMENT_REPAIR_FAILED",
    message: error?.message || String(error),
    details: error?.details || null
  }, null, 2)}\n`);
  process.exitCode = 1;
}
