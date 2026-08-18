"use strict";

const FREIGHT_SCHEMA = "ixi-freight-order-v1";
const FREIGHT_STATUSES = Object.freeze([
  "draft","requested","quoting","awarded","scheduled","picked-up","in-transit",
  "delivered","billed","reconciled","paid","closed","cancelled"
]);
const FREIGHT_MODES = Object.freeze(["external-carrier","internal-fleet"]);
const FREIGHT_PURPOSES = Object.freeze([
  "acquisition-inbound","sale-preparation","customer-delivery","yard-transfer",
  "service-outbound","service-return","auction-move","rental-delivery",
  "rental-return","demo","internal-reposition","other"
]);

const clean = value => String(value ?? "").trim();
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = value => Math.round(num(value) * 100) / 100;
const obj = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};

function createFreightOrder({ id, entityId, actorId, asset = {}, route = {}, execution = {}, economics = {}, purpose = "other", metadata = {} } = {}) {
  const now = new Date().toISOString();
  const mode = FREIGHT_MODES.includes(clean(execution.mode)) ? clean(execution.mode) : "external-carrier";
  const purposeType = FREIGHT_PURPOSES.includes(clean(purpose)) ? clean(purpose) : "other";
  const routeMiles = Math.max(0, num(route.routeMiles));
  const expectedTotal = money(
    economics.expectedTotal ||
    num(economics.agreedAmount) + num(economics.permitEstimate) + num(economics.escortEstimate) + num(economics.fuelSurchargeEstimate) + num(economics.otherEstimate)
  );
  return {
    schema: FREIGHT_SCHEMA,
    identity: { freightOrderId: clean(id), revision: 1 },
    entity: { entityId: clean(entityId) },
    asset: {
      objectId: clean(asset.objectId), passportId: clean(asset.passportId), label: clean(asset.label),
      objectType: clean(asset.objectType), year: clean(asset.year), make: clean(asset.make), model: clean(asset.model),
      serialNumber: clean(asset.serialNumber), weight: num(asset.weight)
    },
    purpose: { type: purposeType },
    movement: { movementId: "", state: "not-requested" },
    route: {
      origin: obj(route.origin), destination: obj(route.destination), routeMiles,
      actualMiles: route.actualMiles == null ? null : Math.max(0, num(route.actualMiles)),
      mileageBasis: clean(route.mileageBasis || "route"), routeProvider: clean(route.routeProvider),
      routeCalculatedAt: clean(route.routeCalculatedAt), manualOverride: Boolean(route.manualOverride)
    },
    execution: {
      mode, carrierPassportId: clean(execution.carrierPassportId), carrierName: clean(execution.carrierName),
      truckPassportId: clean(execution.truckPassportId), trailerPassportId: clean(execution.trailerPassportId),
      driverPassportId: clean(execution.driverPassportId), requestedPickupAt: clean(execution.requestedPickupAt),
      scheduledPickupAt: clean(execution.scheduledPickupAt), actualPickupAt: clean(execution.actualPickupAt),
      expectedDeliveryAt: clean(execution.expectedDeliveryAt), actualDeliveryAt: clean(execution.actualDeliveryAt)
    },
    economics: {
      quotedAmount: money(economics.quotedAmount), agreedAmount: money(economics.agreedAmount),
      permitEstimate: money(economics.permitEstimate), escortEstimate: money(economics.escortEstimate),
      fuelSurchargeEstimate: money(economics.fuelSurchargeEstimate), otherEstimate: money(economics.otherEstimate),
      expectedTotal,
      actualFreight: money(economics.actualFreight), actualPermits: money(economics.actualPermits),
      actualEscort: money(economics.actualEscort), actualDetention: money(economics.actualDetention),
      actualFuelSurcharge: money(economics.actualFuelSurcharge), actualOther: money(economics.actualOther),
      actualTotal: money(economics.actualTotal), expectedPerMile: routeMiles > 0 ? money(expectedTotal / routeMiles) : 0,
      actualPerMile: money(economics.actualPerMile), variance: money(economics.variance),
      economicsEngineVersion: "freight-economics-v1"
    },
    financial: { financialDocumentId: "", billId: "", payableId: "", paymentId: "", reconciliationId: "" },
    status: "draft",
    documents: [],
    metadata: obj(metadata),
    audit: { createdAt: now, createdBy: clean(actorId), updatedAt: now, updatedBy: clean(actorId) }
  };
}

function calculateActualEconomics(record, patch = {}) {
  const current = obj(record.economics);
  const next = { ...current, ...obj(patch) };
  const actualTotal = money(
    num(next.actualFreight) + num(next.actualPermits) + num(next.actualEscort) +
    num(next.actualDetention) + num(next.actualFuelSurcharge) + num(next.actualOther)
  );
  const miles = Math.max(0, num(record.route?.actualMiles || record.route?.routeMiles));
  return {
    ...next,
    actualTotal,
    actualPerMile: miles > 0 ? money(actualTotal / miles) : 0,
    variance: money(actualTotal - num(current.expectedTotal)),
    economicsEngineVersion: "freight-economics-v1"
  };
}

function validateFreightOrder(record, { forAction = "" } = {}) {
  const errors = [];
  if (!clean(record?.entity?.entityId)) errors.push({ code: "FREIGHT_ENTITY_REQUIRED", field: "entityId" });
  if (!clean(record?.asset?.objectId) || !clean(record?.asset?.passportId)) errors.push({ code: "FREIGHT_ASSET_REQUIRED", field: "asset" });
  if (!clean(record?.route?.destination?.objectId || record?.route?.destination?.containerId)) errors.push({ code: "FREIGHT_DESTINATION_REQUIRED", field: "destination" });
  if (forAction === "award" && record.execution?.mode === "external-carrier" && !clean(record.execution?.carrierPassportId || record.execution?.carrierName)) errors.push({ code: "FREIGHT_CARRIER_REQUIRED", field: "carrier" });
  if (["pickup","deliver"].includes(forAction) && !clean(record?.movement?.movementId)) errors.push({ code: "FREIGHT_MOVEMENT_REQUIRED", field: "movementId" });
  return { valid: errors.length === 0, errors };
}

module.exports = { FREIGHT_SCHEMA, FREIGHT_STATUSES, FREIGHT_MODES, FREIGHT_PURPOSES, createFreightOrder, calculateActualEconomics, validateFreightOrder };
