const fs = require("fs");
const path = require("path");

const QUEUE_FILE = path.join(
  __dirname,
  "identity-change-queue.json"
);

function readQueue() {
  try {
    return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
  } catch {
    return {
      version: 1,
      changes: []
    };
  }
}

function writeQueue(queue) {
  fs.writeFileSync(
    QUEUE_FILE,
    JSON.stringify(queue, null, 2)
  );
}

function createChangeId() {
  return `identity_change_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function queueIdentityChange(input = {}) {
  const queue = readQueue();

  const type = input.type || "unknown";
  const category = input.category || "";
  const make = input.make || "";
  const model = input.model || "";

  const duplicate = (queue.changes || []).find(change =>
    change.status === "pending" &&
    change.type === type &&
    change.category === category &&
    change.make === make &&
    change.model === model
  );

  if (duplicate) {
    return {
      ok: true,
      action: "already-queued",
      change: duplicate
    };
  }

  const change = {
    id: createChangeId(),
    status: "pending",
    type,
    category,
    make,
    model,
    rawModel: input.rawModel || "",
    matchedModel: input.matchedModel || "",
    source: input.source || "",
    reason: input.reason || "",
    confidence: input.confidence || "medium",
    taxonomyCommit: input.taxonomyCommit || null,
    adminOptions: input.adminOptions || [
      "keep",
      "map-to-existing-model",
      "move-category",
      "delete-new-model",
      "reassign"
    ],
    createdAt: new Date().toISOString()
  };

  queue.changes = queue.changes || [];
  queue.changes.push(change);

  writeQueue(queue);

  return {
    ok: true,
    action: "queued",
    change
  };
}

module.exports = {
  readQueue,
  writeQueue,
  queueIdentityChange
};
