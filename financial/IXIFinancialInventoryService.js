"use strict";
const provider = require("./IXIFinancialProviderService");
const { projectInventory } = require("./IXIFinancialInventoryLifecycle");

async function readInventory(entityPassportId, service = provider) {
  const result = await service.listDocumentsByPassport({ passportId: entityPassportId });
  if (!result?.ok) throw Object.assign(new Error("Inventory sale status could not be verified. Retry without recording another sale."), { status: 503 });
  return projectInventory({ records: result.data?.documents || [], entityPassportId });
}

const pending = new Map();
async function loadInventory(entityPassportId, service = provider) {
  // Coalesce simultaneous reads only. Completed reads are never reused after
  // a sale or return, so another server cannot publish stale availability.
  if (service !== provider) return readInventory(entityPassportId, service);
  if (pending.has(entityPassportId)) return pending.get(entityPassportId);
  const request = readInventory(entityPassportId, service).finally(() => {
    if (pending.get(entityPassportId) === request) pending.delete(entityPassportId);
  });
  pending.set(entityPassportId, request);
  return request;
}
function invalidateInventory(entityPassportId) { pending.delete(entityPassportId); }
module.exports = { loadInventory, invalidateInventory };
