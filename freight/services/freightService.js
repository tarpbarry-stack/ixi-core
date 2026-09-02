"use strict";

const {
  createFreightOrder
} = require(
  "../contracts/freightOrderContract"
);

const {
  transition
} = require(
  "./freightLifecycle"
);

const {
  actualEconomics
} = require(
  "./freightEconomics"
);

const {
  createOrder,
  replaceOrder,
  getOrder,
  listOrdersForAsset,
  listOrdersByStatus
} = require(
  "../storage/freightDynamoStore"
);

const {
  appendFreightEvent,
  listFreightEvents
} = require(
  "../storage/freightEventStore"
);

const {
  requestFreightMove,
  completeFreightMove
} = require(
  "../../mos/movements/movementService"
);

const {
  getObject
} = require(
  "../../mos/objects/objectService"
);

const {
  clean,
  nowIso
} = require("../util");

const {
  FreightError
} = require("../FreightError");

async function create(args = {}) {
  const objectId =
    clean(args?.asset?.objectId);

  const object =
    getObject(objectId);

  if (
    object.entityId !==
    clean(args.entityId)
  ) {
    throw new FreightError(
      "FREIGHT_ASSET_ENTITY_MISMATCH",
      "Asset does not belong to the authenticated Entity.",
      {},
      403
    );
  }

  const record =
    createFreightOrder({
      ...args,

      route: {
        ...(args.route || {}),

        origin:
          args?.route?.origin || {
            objectId:
              object.directContainerId || ""
          }
      }
    });

  await createOrder(record);

  await appendFreightEvent({
    entityId:
      args.entityId,

    freightOrderId:
      record.identity.freightOrderId,

    eventType:
      "freight.created",

    actorId:
      args.actorId,

    commandId:
      args.commandId,

    payload: {
      status:
        record.status
    }
  });

  return record;
}

async function load(
  entityId,
  freightOrderId
) {
  const record =
    await getOrder({
      entityId,
      freightOrderId
    });

  if (!record) {
    throw new FreightError(
      "FREIGHT_NOT_FOUND",
      "Freight Order not found.",
      { freightOrderId },
      404
    );
  }

  return record;
}

async function changeState({
  entityId,
  freightOrderId,
  nextStatus,
  actorId,
  commandId,
  mutate
}) {
  const current =
    await load(
      entityId,
      freightOrderId
    );

  const priorRevision =
    current.identity.revision;

  let next =
    transition(
      current,
      nextStatus,
      actorId
    );

  if (
    typeof mutate === "function"
  ) {
    next =
      await mutate(
        next,
        current
      );
  }

  await replaceOrder({
    record: next,
    expectedRevision:
      priorRevision
  });

  await appendFreightEvent({
    entityId,
    freightOrderId,
    eventType:
      `freight.${nextStatus}`,
    actorId,
    commandId,
    payload: {
      priorStatus:
        current.status,
      status:
        next.status,
      revision:
        next.identity.revision
    }
  });

  return next;
}

async function request(args) {
  return changeState({
    ...args,
    nextStatus:
      "requested"
  });
}

async function award(args) {
  return changeState({
    ...args,
    nextStatus:
      "awarded"
  });
}

async function dispatch({
  entityId,
  freightOrderId,
  actorId,
  commandId
}) {
  return changeState({
    entityId,
    freightOrderId,
    actorId,
    commandId,
    nextStatus:
      "dispatched",

    mutate:
      async next => {
        const destinationContainerId =
          clean(
            next.route
              ?.destination
              ?.containerId ||
            next.route
              ?.destination
              ?.objectId
          );

        const result =
          requestFreightMove({
            commandId:
              `freight-dispatch:${freightOrderId}`,

            entityId,

            objectId:
              next.asset.objectId,

            destinationContainerId,

            actorId,

            reason:
              `Freight Order ${freightOrderId}`,

            metadata: {
              freightOrderId,
              purpose:
                next.purpose?.type
            }
          });

        return {
          ...next,

          movement: {
            movementId:
              result
                ?.movement
                ?.movementId || "",

            state:
              "requested"
          }
        };
      }
  });
}

async function pickup(args) {
  return changeState({
    ...args,

    nextStatus:
      "picked-up",

    mutate:
      async next => ({
        ...next,

        execution: {
          ...next.execution,
          actualPickupAt:
            nowIso()
        },

        movement: {
          ...next.movement,
          state:
            "in-transit"
        }
      })
  });
}

async function deliver({
  entityId,
  freightOrderId,
  actorId,
  commandId
}) {
  return changeState({
    entityId,
    freightOrderId,
    actorId,
    commandId,

    nextStatus:
      "delivered",

    mutate:
      async next => {
        const movementId =
          clean(
            next
              ?.movement
              ?.movementId
          );

        if (!movementId) {
          throw new FreightError(
            "FREIGHT_MOVEMENT_REQUIRED",
            "Freight delivery requires an active MOS movement.",
            {},
            409
          );
        }

        completeFreightMove({
          commandId:
            `freight-deliver:${movementId}`,

          movementId,
          actorId
        });

        return {
          ...next,

          movement: {
            ...next.movement,
            state:
              "completed"
          },

          execution: {
            ...next.execution,
            actualDeliveryAt:
              nowIso()
          }
        };
      }
  });
}

async function reconcile({
  entityId,
  freightOrderId,
  actorId,
  commandId,
  actual = {}
}) {
  return changeState({
    entityId,
    freightOrderId,
    actorId,
    commandId,

    nextStatus:
      "reconciled",

    mutate:
      async next => {
        const miles =
          Number(
            actual.actualMiles ||
            next.route.actualMiles ||
            next.route.routeMiles ||
            0
          );

        return {
          ...next,

          route: {
            ...next.route,

            actualMiles:
              actual.actualMiles == null
                ? next.route.actualMiles
                : Number(
                    actual.actualMiles
                  )
          },

          economics: {
            ...next.economics,

            ...actualEconomics(
              next.economics,
              actual,
              miles
            )
          }
        };
      }
  });
}

module.exports = {
  create,
  load,
  request,
  award,
  dispatch,
  pickup,
  deliver,
  reconcile,
  listOrdersForAsset,
  listOrdersByStatus,
  listFreightEvents
};
