"use strict";
const { listObjects } = require("../../mos/objects/objectService");
const { FreightError } = require("../FreightError");
const clean = value => String(value ?? "").trim();

function freightRecipientOptions(entityId) {
  return listObjects({ entityId, status: "active" }).filter(object =>
    object.objectType === "person" && clean(object.passportId)
  ).map(object => ({ passportId: object.passportId, label: clean(object.displayName || object.label || object.title || object.passportId) }));
}

function validateFreightRecipients(entityId, recipients) {
  if (recipients === undefined) return;
  if (!Array.isArray(recipients) || recipients.length > 20)
    throw new FreightError("FREIGHT_RECIPIENTS_INVALID", "Choose up to 20 people for Freight updates.", {}, 400);
  const allowed = new Set(freightRecipientOptions(entityId).map(person => person.passportId));
  if (recipients.some(id => !allowed.has(clean(id))))
    throw new FreightError("FREIGHT_RECIPIENT_SCOPE", "Choose update recipients from this company's workforce.", {}, 403);
}

function freightAlertItems(record, eventItem) {
  const event = eventItem.event;
  return [...new Set(record?.metadata?.notificationRecipients || [])].map(recipientPassportId => ({
    pk: `ENTITY#${record.entity.entityId}#RECIPIENT#${recipientPassportId}`,
    sk: `FREIGHT_ALERT#${event.occurredAt}#${event.eventId}`,
    recordType: "freight-alert", entityId: record.entity.entityId,
    recipientPassportId, freightOrderId: record.identity.freightOrderId,
    assetPassportId: record.asset.passportId, assetLabel: record.asset.label,
    createdAt: event.occurredAt, event
  }));
}

module.exports = { freightRecipientOptions, validateFreightRecipients, freightAlertItems };
