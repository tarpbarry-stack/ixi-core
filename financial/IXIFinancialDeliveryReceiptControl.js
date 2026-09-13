"use strict";

function assertPurchaseOrderDelivery({ existing = {}, merged = {}, accessContext = {}, getDelivery }) {
  if (merged.documentType !== "purchase-order" || merged.purchaseOrderRecord?.status !== "sent" || existing.purchaseOrderRecord?.status === "sent") return;
  const receipt = merged.purchaseOrderRecord.deliveryReceipt;
  const saved = receipt?.deliveryId ? getDelivery(receipt.deliveryId) : null;
  const valid = saved?.status === "succeeded" &&
    saved.passport_id === accessContext.entityPassportId &&
    saved.principal_id === accessContext.actorPassportId &&
    saved.listing_id.split(",").includes(merged.financialDocumentId) &&
    JSON.parse(saved.recipients_json || "[]").includes(receipt.recipient) &&
    JSON.parse(saved.provider_message_ids_json || "[]").length > 0;
  if (!valid) throw new Error("Send the Purchase Order PDF before marking it sent. Its provider receipt could not be verified.");
}
module.exports = { assertPurchaseOrderDelivery };
