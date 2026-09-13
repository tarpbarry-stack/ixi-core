"use strict";
const PASSPORT_CHANGED = "ValueError: Passport registry changed during capture; retry the recovery set";

function captureStableRecovery(capture, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = capture(attempt);
    if (result.status === 0) return result;
    const message = String(result.stderr || result.error?.message || "Recovery capture failed");
    if (!message.includes(PASSPORT_CHANGED) || attempt === maxAttempts) throw new Error(message);
  }
  throw new Error("Recovery capture did not complete");
}
module.exports = { captureStableRecovery };
