"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");
const scope = new AsyncLocalStorage();

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// Explicit read boundaries only. Never share snapshots across HTTP requests,
// tenants or commands. Nested identity/authority readers join the same scope.
function withCanonicalReadScope(callback) {
  return scope.getStore() ? callback() : scope.run(new Map(), callback);
}

function readCanonicalSnapshot(key, read) {
  const records = scope.getStore();
  if (!records) return read();
  if (!records.has(key)) records.set(key, freeze(read()));
  return records.get(key);
}

function assertCanonicalWriteAllowed() {
  if (scope.getStore()) {
    const error = new Error("Canonical writes cannot run inside a read snapshot.");
    error.code = "CANONICAL_READ_SCOPE_WRITE_DENIED";
    throw error;
  }
}

module.exports = { withCanonicalReadScope, readCanonicalSnapshot, assertCanonicalWriteAllowed };
