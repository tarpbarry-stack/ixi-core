"use strict";

const {
  FREIGHT_SCHEMA,
  FREIGHT_STATUS,
  FREIGHT_MODE,
  FREIGHT_PURPOSE
} = require("../constants");

const {
  FreightError
} = require("../FreightError");

const {
  clean,
  safeObject,
  number,
  nowIso,
  createFreightId
} = require("../util");

const {
  expectedEconomics
} = require(
  "../services/freightEconomics"
);

function createFreightOrder({
  entityId = "",
  actorId = "",
  asset = {},
  route = {},
  execution = {},
  economics = {},
  purpose = "other",
  metadata = {}
} = {}) {
  asset = safeObject(asset);
  route = safeObject(route);
  execution = safeObject(execution);

  const resolvedEntityId =
    clean(entityId);

  const objectId =
    clean(asset.objectId);

  const passportId =
    clean(asset.passportId);

  const destination =
    safeObject(route.destination);

  const destinationId =
    clean(
      destination.containerId ||
      destination.objectId
    );

  if (!resolvedEntityId) {
    throw new FreightError(
      "FREIGHT_ENTITY_REQUIRED",
      "Entity is required."
    );
  }

  if (!objectId || !passportId) {
    throw new FreightError(
      "FREIGHT_ASSET_REQUIRED",
      "Canonical asset Object and Passport identity are required."
    );
  }

  if (!destinationId) {
    throw new FreightError(
      "FREIGHT_DESTINATION_REQUIRED",
      "Destination AOS object is required."
    );
  }

  const mode =
    Object.values(FREIGHT_MODE)
      .includes(clean(execution.mode))
        ? clean(execution.mode)
        : FREIGHT_MODE.EXTERNAL_CARRIER;

  const resolvedPurpose =
    Object.values(FREIGHT_PURPOSE)
      .includes(clean(purpose))
        ? clean(purpose)
        : FREIGHT_PURPOSE.OTHER;

  const routeMiles =
    Math.max(
      0,
      number(route.routeMiles)
    );

  const timestamp = nowIso();

  return {
    schema: FREIGHT_SCHEMA,

    identity: {
      freightOrderId:
        createFreightId(),
      revision: 1
    },

    entity: {
      entityId: resolvedEntityId
    },

    asset: {
      objectId,
      passportId,
      label: clean(asset.label),
      objectType:
        clean(asset.objectType),
      year: clean(asset.year),
      make: clean(asset.make),
      model: clean(asset.model),
      serialNumber:
        clean(asset.serialNumber),
      weight: number(asset.weight)
    },

    purpose: {
      type: resolvedPurpose
    },

    movement: {
      movementId: "",
      state: "not-requested"
    },

    route: {
      origin:
        safeObject(route.origin),

      destination,

      routeMiles,

      actualMiles:
        route.actualMiles == null
          ? null
          : Math.max(
              0,
              number(route.actualMiles)
            ),

      mileageBasis:
        clean(route.mileageBasis) ||
        "route",

      routeProvider:
        clean(route.routeProvider),

      routeCalculatedAt:
        clean(route.routeCalculatedAt),

      manualOverride:
        Boolean(route.manualOverride)
    },

    execution: {
      mode,

      carrierPassportId:
        clean(
          execution.carrierPassportId
        ),

      carrierName:
        clean(execution.carrierName),

      truckPassportId:
        clean(
          execution.truckPassportId
        ),

      trailerPassportId:
        clean(
          execution.trailerPassportId
        ),

      driverPassportId:
        clean(
          execution.driverPassportId
        ),

      requestedPickupAt:
        clean(
          execution.requestedPickupAt
        ),

      scheduledPickupAt:
        clean(
          execution.scheduledPickupAt
        ),

      actualPickupAt: "",

      expectedDeliveryAt:
        clean(
          execution.expectedDeliveryAt
        ),

      actualDeliveryAt: ""
    },

    economics: {
      ...expectedEconomics(
        economics,
        routeMiles
      ),

      actualFreight: 0,
      actualPermits: 0,
      actualEscort: 0,
      actualDetention: 0,
      actualFuelSurcharge: 0,
      actualOther: 0,
      actualTotal: 0,
      actualPerMile: 0,
      variance: 0
    },

    financial: {
      billId: "",
      payableId: "",
      paymentId: "",
      reconciliationId: ""
    },

    status:
      FREIGHT_STATUS.DRAFT,

    documents: [],

    metadata:
      safeObject(metadata),

    audit: {
      createdAt: timestamp,
      createdBy: clean(actorId),
      updatedAt: timestamp,
      updatedBy: clean(actorId)
    }
  };
}

module.exports = {
  createFreightOrder
};
