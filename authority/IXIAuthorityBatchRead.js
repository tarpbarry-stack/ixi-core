"use strict";
const { createCurrentRecordBatchReader } = require("../storage/IXIDynamoCurrentRead");
function createAuthorityBatchReader(options) {
  return createCurrentRecordBatchReader({ ...options, keyPrefix: "POLICY#",
    valueForItem: item => item,
    errorCode: "AUTHORITY_BATCH_READ_INCOMPLETE",
    errorMessage: "Authority policies could not be read completely; please retry." });
}

// Coalesce concurrent policy inputs within ONE explicit request scope. Drain
// waves serially so the batch reader's two-request limit cannot be multiplied.
// The resolver owns per-scope deduplication; this queue retains no completed data.
function createPolicyReadQueue(readMany) {
  let pending = [], draining = false;
  async function drain() {
    while (pending.length) {
      const wave = pending;
      pending = [];
      try {
        const records = await readMany(wave.map(entry => entry.id));
        if (!Array.isArray(records) || records.length !== wave.length) {
          throw new Error("Authority batch returned an incomplete policy result.");
        }
        wave.forEach((entry, index) => entry.resolve(records[index]));
      } catch (error) {
        wave.forEach(entry => entry.reject(error));
      }
    }
    draining = false;
  }
  return id => new Promise((resolve, reject) => {
    pending.push({ id, resolve, reject });
    if (!draining) {
      draining = true;
      queueMicrotask(drain);
    }
  });
}
module.exports = { createAuthorityBatchReader, createPolicyReadQueue };
