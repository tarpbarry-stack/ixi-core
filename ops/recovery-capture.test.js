"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { captureStableRecovery } = require("./recovery-capture");
const collision = { status: 1, stderr: "ValueError: Passport registry changed during capture; retry the recovery set" };
test("a Passport snapshot collision retries a fresh capture and returns only the stable result", () => {
  const attempts = [];
  const result = captureStableRecovery(attempt => { attempts.push(attempt); return attempt === 1 ? collision : { status: 0, stdout: "stable snapshot" }; });
  assert.deepEqual(attempts, [1, 2]);
  assert.equal(result.stdout, "stable snapshot");
});
test("recovery retries are bounded and never suppress integrity or permission failures", () => {
  let attempts = 0;
  assert.throws(() => captureStableRecovery(() => { attempts++; return collision; }), /Passport registry changed/);
  assert.equal(attempts, 3);
  for (const message of ["SQLite integrity verification failed", "Permission denied", "Recovery checksum failed"]) {
    attempts = 0;
    assert.throws(() => captureStableRecovery(() => { attempts++; return { status: 1, stderr: message }; }), { message });
    assert.equal(attempts, 1);
  }
});

test("recovery budget scales for a large snapshot while remaining bounded", () => {
  const { recoveryCaptureTimeoutMs } = require("./recovery-capture");
  assert.equal(recoveryCaptureTimeoutMs(16 * 1024 * 1024), 180000);
  assert.ok(recoveryCaptureTimeoutMs(1467871232) > 500000);
  assert.equal(recoveryCaptureTimeoutMs(100 * 1024 * 1024 * 1024), 600000);
  assert.throws(() => recoveryCaptureTimeoutMs(-1), /Invalid/);
});
test("capture timeout retains the last completed diagnostic phase", () => {
  assert.throws(() => captureStableRecovery(() => ({ status: null, error: new Error("ETIMEDOUT"), stderr: '{"recoveryPhase":"independent-restore-verification"}' })), /ETIMEDOUT[\s\S]*independent-restore-verification/);
});
