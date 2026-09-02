const fs = require("fs");
const path = require("path");

const AUDIT_FILE = path.join(
  __dirname,
  "identity-audit-events.json"
);

function readAuditEvents() {
  try {
    return JSON.parse(fs.readFileSync(AUDIT_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeAuditEvents(events) {
  fs.writeFileSync(
    AUDIT_FILE,
    JSON.stringify(events, null, 2)
  );
}

function recordIdentityAuditEvent(event = {}) {
  const events = readAuditEvents();

  const auditEvent = {
    id: `identity_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    status: "active",
    createdAt: new Date().toISOString(),
    ...event
  };

  events.unshift(auditEvent);
  writeAuditEvents(events.slice(0, 5000));

  return auditEvent;
}

module.exports = {
  readAuditEvents,
  recordIdentityAuditEvent
};
