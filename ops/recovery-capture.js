"use strict";
const PASSPORT_CHANGED = "ValueError: Passport registry changed during capture; retry the recovery set";

function captureStableRecovery(capture, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = capture(attempt);
    if (result.status === 0) return result;
    const message = [result.error?.message, result.stderr].filter(Boolean).join("\n") || "Recovery capture failed";
    if (!message.includes(PASSPORT_CHANGED) || attempt === maxAttempts) throw new Error(message);
  }
  throw new Error("Recovery capture did not complete");
}
// Recovery reads the full database for snapshotting and two independent
// integrity passes. Bound the budget by size, with a hard ten-minute ceiling.
function recoveryCaptureTimeoutMs(databaseBytes) {
  if (!Number.isSafeInteger(databaseBytes) || databaseBytes < 0) throw new Error("Invalid recovery database size");
  return Math.min(600000, Math.max(180000, Math.ceil(databaseBytes / (8 * 1024 * 1024)) * 3000));
}
module.exports = { captureStableRecovery, recoveryCaptureTimeoutMs };
