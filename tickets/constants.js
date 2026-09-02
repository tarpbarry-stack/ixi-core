"use strict";

const TICKET_SCHEMA = "ixi-ticket-v1";
const TICKET_CONTRACT_VERSION = "1.0.0";

const TICKET_STATUS = Object.freeze({
  DRAFT: "draft",
  READY_FOR_CHAT: "ready-for-chat",
  WORKING: "working",
  PR_OPEN: "pr-open",
  READY_TO_VERIFY: "ready-to-verify",
  REOPENED: "reopened",
  REJECTED: "rejected",
  CLOSED: "closed"
});

const TICKET_SOURCES = Object.freeze([
  "internal-chat",
  "customer-support",
  "customer-feedback",
  "system-generated"
]);

const TICKET_TYPES = Object.freeze([
  "bug",
  "ui",
  "data",
  "integration",
  "build",
  "design",
  "test",
  "research",
  "improvement"
]);

const TICKET_PRIORITIES = Object.freeze([
  "low",
  "normal",
  "high",
  "critical"
]);

const EXECUTION_CLASSES = Object.freeze([
  "auto-safe",
  "review",
  "aws",
  "design",
  "blocked"
]);

const TERMINAL_STATUSES = new Set([
  TICKET_STATUS.CLOSED,
  TICKET_STATUS.REJECTED
]);

const MUTABLE_REQUEST_STATUSES = new Set([
  TICKET_STATUS.DRAFT
]);

module.exports = {
  TICKET_SCHEMA,
  TICKET_CONTRACT_VERSION,
  TICKET_STATUS,
  TICKET_SOURCES,
  TICKET_TYPES,
  TICKET_PRIORITIES,
  EXECUTION_CLASSES,
  TERMINAL_STATUSES,
  MUTABLE_REQUEST_STATUSES
};
