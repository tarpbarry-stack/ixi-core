#!/usr/bin/env node
"use strict";

const { migrateLegacyJson } = require("./legacyJsonMigration");

const args = new Set(process.argv.slice(2));
const mode = args.has("--apply")
  ? "apply"
  : args.has("--verify")
    ? "verify"
    : "dry-run";

try {
  const report = migrateLegacyJson({ mode });
  process.stdout.write(`${JSON.stringify({ ok: true, ...report }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    mode,
    code: error?.code || "MOS_MIGRATION_FAILED",
    error: error?.message || String(error)
  }, null, 2)}\n`);
  process.exitCode = 1;
}
