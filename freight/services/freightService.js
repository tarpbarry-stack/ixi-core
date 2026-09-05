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
  actualEconomics,
  expectedEconomics,
  hasExpectedAmount
} = require(
  "./freightEconomics"
);

const {
  createOrder,
  replaceOrder,
  transactAmendOrder,
  getAmendmentCommand,
  getOrder,
  listOrdersForAsset,
  listOrdersByStatus
} = require(
  "../storage/freightDynamoStore"
);

const {
  appendFreightEvent,
  buildFreightEvent,
  freightEventItem,
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
  resolveOrProvisionAosObjectForPassport
} = require(
  "../../mos/provisioning/aosObjectIdentityResolver"
);

const {
  clean,
  nowIso,
  money,
  safeObject
} = require("../util");

const crypto = require("crypto");

const {
  FreightError
} = require("../FreightError");

async function create(args = {}) {
  const object =
    resolveOrProvisionAosObjectForPassport({
      passportId:
        args?.asset?.passportId,
      objectId:
        args?.asset?.objectId,
      entityId:
        args.entityId,
      actorId:
        args.actorId,
      source:
        args?.asset?.source,
      asset:
        args?.asset,
      provisionIfMissing:
        args?.asset?.source?.verified === true
    });

  const record =
    createFreightOrder({
      ...args,

      asset: {
        ...(args.asset || {}),
        objectId:
          object.objectId
      },

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

const AMENDABLE_ORDER_STATUSES = new Set([
  "draft",
  "requested"
]);

const AMENDMENT_FIELDS = [
  "asset.weight",
  "purpose.type",
  "route.origin.objectId",
  "route.origin.label",
  "route.origin.address",
  "route.destination.containerId",
  "route.destination.objectId",
  "route.destination.label",
  "route.destination.address",
  "route.routeMiles",
  "execution.mode",
  "execution.carrierPassportId",
  "execution.carrierName",
  "execution.requestedPickupAt",
  "execution.scheduledPickupAt",
  "execution.expectedDeliveryAt",
  "economics.quotedAmount",
  "economics.agreedAmount",
  "economics.permitEstimate",
  "economics.escortEstimate",
  "economics.fuelSurchargeEstimate",
  "economics.otherEstimate",
  "economics.expectedProvided",
  "metadata.payer",
  "metadata.customerRebill",
  "metadata.acquisitionCost",
  "metadata.notes"
];

function pick(source, keys) {
  const value = safeObject(source);
  return Object.fromEntries(
    keys
      .filter(key => Object.prototype.hasOwnProperty.call(value, key))
      .map(key => [key, value[key]])
  );
}

function valueAt(source, path) {
  return path.split(".").reduce((value, key) => value?.[key], source);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stableValue(value[key])])
  );
}

function amendmentFingerprint(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function freightAmendmentDiff(before, after) {
  return AMENDMENT_FIELDS.flatMap(field => {
    const prior = valueAt(before, field);
    const next = valueAt(after, field);
    return JSON.stringify(stableValue(prior)) === JSON.stringify(stableValue(next))
      ? []
      : [{ field, before: prior ?? null, after: next ?? null }];
  });
}

function canAmendOrderAtStatus(status = "") {
  return AMENDABLE_ORDER_STATUSES.has(clean(status));
}

function buildAmendedFreightOrder({
  current = {},
  amendment = {},
  actorId = "",
  expectedRevision,
  changeReason = ""
} = {}) {
  const currentRevision = Number(current?.identity?.revision || 0);
  const requestedRevision = Number(expectedRevision);

  if (!canAmendOrderAtStatus(current.status)) {
    throw new FreightError(
      "FREIGHT_AMENDMENT_STATE_INVALID",
      "Freight Order terms may be edited only while the order is draft or requested.",
      { status: current.status },
      409
    );
  }

  if (!Number.isInteger(requestedRevision) || requestedRevision !== currentRevision) {
    throw new FreightError(
      "FREIGHT_REVISION_CONFLICT",
      "Freight Order changed before this amendment was saved.",
      { expectedRevision: requestedRevision, currentRevision },
      409
    );
  }

  const reason = clean(changeReason);
  if (clean(current.status) === "requested" && !reason) {
    throw new FreightError(
      "FREIGHT_AMENDMENT_REASON_REQUIRED",
      "A change reason is required after Freight has been requested.",
      {},
      400
    );
  }

  const patch = safeObject(amendment);
  const assetPatch = safeObject(patch.asset);
  const routePatch = safeObject(patch.route);
  const executionPatch = safeObject(patch.execution);
  const economicsPatch = safeObject(patch.economics);
  const metadataPatch = safeObject(patch.metadata);
  const route = {
    ...(current.route || {}),
    ...pick(routePatch, ["routeMiles"]),
    origin: {
      ...(current.route?.origin || {}),
      ...pick(routePatch.origin, ["objectId", "label", "address"])
    },
    destination: {
      ...(current.route?.destination || {}),
      ...pick(routePatch.destination, ["containerId", "objectId", "label", "address"])
    }
  };
  const normalized = createFreightOrder({
    entityId: current?.entity?.entityId,
    actorId,
    asset: {
      ...(current.asset || {}),
      weight: assetPatch.weight ?? current?.asset?.weight
    },
    purpose: clean(patch?.purpose?.type || patch.purpose || current?.purpose?.type),
    route,
    execution: {
      ...(current.execution || {}),
      ...pick(executionPatch, [
        "mode",
        "carrierPassportId",
        "carrierName",
        "requestedPickupAt",
        "scheduledPickupAt",
        "expectedDeliveryAt"
      ])
    },
    economics: {
      ...(current.economics || {}),
      ...pick(economicsPatch, [
        "quotedAmount",
        "agreedAmount",
        "permitEstimate",
        "escortEstimate",
        "fuelSurchargeEstimate",
        "otherEstimate",
        "expectedProvided"
      ])
    },
    metadata: {
      ...(current.metadata || {}),
      ...pick(metadataPatch, ["payer", "customerRebill", "acquisitionCost", "notes"])
    }
  });
  const timestamp = nowIso();

  const next = {
    ...current,
    identity: {
      ...current.identity,
      revision: currentRevision + 1
    },
    asset: {
      ...current.asset,
      weight: normalized.asset.weight
    },
    purpose: normalized.purpose,
    route: normalized.route,
    execution: {
      ...normalized.execution,
      actualPickupAt: clean(current?.execution?.actualPickupAt),
      actualDeliveryAt: clean(current?.execution?.actualDeliveryAt)
    },
    economics: {
      ...current.economics,
      ...expectedEconomics(normalized.economics, normalized.route.routeMiles)
    },
    metadata: {
      ...normalized.metadata,
      lastAmendmentReason: reason,
      lastAmendedAt: timestamp,
      lastAmendedBy: clean(actorId)
    },
    audit: {
      ...(current.audit || {}),
      updatedAt: timestamp,
      updatedBy: clean(actorId)
    }
  };

  if (!freightAmendmentDiff(current, next).length) {
    throw new FreightError(
      "FREIGHT_AMENDMENT_NO_CHANGES",
      "Freight amendment did not change any editable order terms.",
      {},
      400
    );
  }

  return next;
}

async function amend({
  entityId,
  freightOrderId,
  actorId,
  commandId,
  expectedRevision,
  amendment = {},
  changeReason = ""
}) {
  const resolvedCommandId = clean(commandId);
  if (!resolvedCommandId) {
    throw new FreightError(
      "FREIGHT_COMMAND_ID_REQUIRED",
      "A unique command ID is required to amend a Freight Order.",
      {},
      400
    );
  }
  const fingerprint = amendmentFingerprint({
    operation: "freight.amend",
    entityId: clean(entityId),
    freightOrderId: clean(freightOrderId),
    expectedRevision: Number(expectedRevision),
    changeReason: clean(changeReason),
    amendment: stableValue(amendment)
  });
  const priorCommand = await getAmendmentCommand({
    entityId,
    commandId: resolvedCommandId
  });
  if (priorCommand) {
    if (clean(priorCommand.fingerprint) !== fingerprint) {
      throw new FreightError(
        "FREIGHT_COMMAND_CONFLICT",
        "Command ID was already used for a different Freight amendment.",
        { commandId: resolvedCommandId },
        409
      );
    }
    return priorCommand.result;
  }

  const current = await load(entityId, freightOrderId);
  const next = buildAmendedFreightOrder({
    current,
    amendment,
    actorId,
    expectedRevision,
    changeReason
  });

  const changes = freightAmendmentDiff(current, next);
  const event = buildFreightEvent({
    entityId,
    freightOrderId,
    eventType: "freight.amended",
    actorId,
    commandId: resolvedCommandId,
    payload: {
      priorRevision: current.identity.revision,
      revision: next.identity.revision,
      status: next.status,
      changeReason: clean(changeReason),
      changes
    }
  });
  const result = await transactAmendOrder({
    record: next,
    expectedRevision: current.identity.revision,
    eventItem: freightEventItem(event),
    commandId: resolvedCommandId,
    fingerprint
  });

  return result.record;
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

function invoiceFingerprint({
  carrierPassportId = "",
  carrierName = "",
  invoiceNumber = ""
} = {}) {
  const part = value => clean(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return [
    part(carrierPassportId || carrierName),
    part(invoiceNumber)
  ].join("|");
}

function actualFromInvoices(invoices = []) {
  const totals = {
    actualFreight: 0,
    actualPermits: 0,
    actualEscort: 0,
    actualDetention: 0,
    actualFuelSurcharge: 0,
    actualOther: 0
  };

  for (const invoice of invoices) {
    if (clean(invoice.status) === "void") continue;
    const sign = clean(invoice.documentType) === "carrier-credit" ? -1 : 1;
    const charges = invoice.charges || {};
    totals.actualFreight += sign * Number(charges.freight || 0);
    totals.actualPermits += sign * Number(charges.permits || 0);
    totals.actualEscort += sign * Number(charges.escort || 0);
    totals.actualDetention += sign * Number(charges.detention || 0);
    totals.actualFuelSurcharge += sign * Number(charges.fuelSurcharge || 0);
    totals.actualOther += sign * Number(charges.other || 0);
  }

  return Object.fromEntries(
    Object.entries(totals).map(([key, value]) => [key, money(value)])
  );
}

const INVOICE_EDITABLE_STATUSES = new Set([
  "draft",
  "requested",
  "awarded",
  "dispatched",
  "picked-up",
  "in-transit",
  "delivered",
  "billed"
]);

function canAttachInvoiceAtStatus(status = "") {
  return INVOICE_EDITABLE_STATUSES.has(clean(status));
}

function statusAfterInvoice(status = "") {
  const current = clean(status);
  return ["delivered", "billed"].includes(current)
    ? "billed"
    : current;
}

async function attachInvoice({
  entityId,
  freightOrderId,
  actorId,
  commandId,
  invoice = {}
}) {
  const current = await load(entityId, freightOrderId);

  if (!canAttachInvoiceAtStatus(current.status)) {
    throw new FreightError(
      "FREIGHT_INVOICE_STATE_INVALID",
      "Carrier invoices may be attached only while the Freight Order is active and unreconciled.",
      { status: current.status },
      409
    );
  }

  const documentType = clean(invoice.documentType) === "carrier-credit"
    ? "carrier-credit"
    : "carrier-invoice";
  const invoiceNumber = clean(invoice.invoiceNumber);
  const invoiceDate = clean(invoice.invoiceDate);
  const billDocumentId = clean(invoice.billDocumentId);
  const charges = {
    freight: money(invoice?.charges?.freight),
    permits: money(invoice?.charges?.permits),
    escort: money(invoice?.charges?.escort),
    detention: money(invoice?.charges?.detention),
    fuelSurcharge: money(invoice?.charges?.fuelSurcharge),
    other: money(invoice?.charges?.other)
  };
  const amount = money(Object.values(charges).reduce((sum, value) => sum + Number(value || 0), 0));
  const fingerprint = invoiceFingerprint({
    carrierPassportId: current.execution?.carrierPassportId,
    carrierName: current.execution?.carrierName,
    invoiceNumber
  });

  if (!invoiceNumber || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) || !(amount > 0) || !billDocumentId) {
    throw new FreightError(
      "FREIGHT_INVOICE_INVALID",
      "Invoice number, invoice date, positive charges, and canonical Bill identity are required.",
      {},
      400
    );
  }

  const invoices = Array.isArray(current.invoices) ? current.invoices : [];
  if (invoices.some(item => clean(item.fingerprint) === fingerprint || clean(item.billDocumentId) === billDocumentId)) {
    throw new FreightError(
      "FREIGHT_DUPLICATE_INVOICE",
      "This carrier invoice is already attached to the Freight Order.",
      { invoiceNumber, billDocumentId },
      409
    );
  }

  const timestamp = nowIso();
  const attached = {
    invoiceId: clean(invoice.invoiceId) || `FINV-${Date.now()}`,
    documentType,
    invoiceNumber,
    invoiceDate,
    dueDate: clean(invoice.dueDate),
    billDocumentId,
    payableId: clean(invoice.payableId || billDocumentId),
    fingerprint,
    charges,
    amount,
    status: "matched",
    document: invoice.document && typeof invoice.document === "object" ? invoice.document : null,
    notes: clean(invoice.notes),
    attachedAt: timestamp,
    attachedBy: clean(actorId)
  };
  const nextInvoices = [...invoices, attached];
  const actual = actualEconomics(
    current.economics,
    actualFromInvoices(nextInvoices),
    Number(current.route?.actualMiles || current.route?.routeMiles || 0)
  );
  const invoiceTotal = money(nextInvoices
    .filter(item => clean(item.status) !== "void" && clean(item.documentType) !== "carrier-credit")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const creditTotal = money(nextInvoices
    .filter(item => clean(item.status) !== "void" && clean(item.documentType) === "carrier-credit")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const next = {
    ...current,
    identity: {
      ...current.identity,
      revision: Number(current.identity?.revision || 0) + 1
    },
    status: statusAfterInvoice(current.status),
    invoices: nextInvoices,
    economics: { ...current.economics, ...actual },
    financial: {
      ...(current.financial || {}),
      billId: billDocumentId,
      payableId: attached.payableId,
      invoiceCount: nextInvoices.length,
      invoicedTotal: invoiceTotal,
      creditTotal,
      openPayableTotal: money(invoiceTotal - creditTotal)
    },
    reconciliation: {
      ...(current.reconciliation || {}),
      status: !hasExpectedAmount(current.economics)
        ? "unbudgeted"
        : Math.abs(Number(actual.variance || 0)) < 0.01
          ? "matched"
          : "variance"
    },
    audit: {
      ...(current.audit || {}),
      updatedAt: timestamp,
      updatedBy: clean(actorId)
    }
  };

  await replaceOrder({ record: next, expectedRevision: current.identity.revision });
  await appendFreightEvent({
    entityId,
    freightOrderId,
    eventType: "freight.invoice-attached",
    actorId,
    commandId,
    payload: { invoiceNumber, billDocumentId, documentType, amount, variance: actual.variance }
  });

  return next;
}

async function reconcile({
  entityId,
  freightOrderId,
  actorId,
  commandId,
  actual = {},
  varianceApproved = false,
  varianceNote = ""
}) {
  return changeState({
    entityId,
    freightOrderId,
    actorId,
    commandId,

    nextStatus:
      "reconciled",

    mutate:
      async (next, current) => {
        const invoices = Array.isArray(current.invoices) ? current.invoices : [];
        if (!invoices.length) {
          throw new FreightError(
            "FREIGHT_INVOICE_REQUIRED",
            "At least one canonical carrier invoice is required before reconciliation.",
            {},
            409
          );
        }
        const miles =
          Number(
            actual.actualMiles ||
            next.route.actualMiles ||
            next.route.routeMiles ||
            0
          );

        const resolvedActual = actualFromInvoices(invoices);
        const economics = actualEconomics(
          next.economics,
          resolvedActual,
          miles
        );
        const expectedProvided = hasExpectedAmount(next.economics);
        const tolerance = expectedProvided
          ? Math.max(50, Math.abs(Number(next.economics?.expectedTotal || 0)) * 0.05)
          : 0;
        if (expectedProvided && Math.abs(Number(economics.variance || 0)) > tolerance && !varianceApproved) {
          throw new FreightError(
            "FREIGHT_VARIANCE_APPROVAL_REQUIRED",
            "Freight variance exceeds tolerance and requires explicit approval.",
            { variance: economics.variance, tolerance },
            409
          );
        }
        const timestamp = nowIso();

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
            ...economics
          },
          reconciliation: {
            ...(next.reconciliation || {}),
            status: "reconciled",
            varianceApproved: Boolean(varianceApproved),
            varianceApprovedBy: varianceApproved ? clean(actorId) : "",
            varianceApprovedAt: varianceApproved ? timestamp : "",
            varianceNote: clean(varianceNote),
            reconciledAt: timestamp,
            reconciledBy: clean(actorId)
          },
          financial: {
            ...(next.financial || {}),
            reconciliationId: clean(commandId) || `FREC-${Date.now()}`
          }
        };
      }
  });
}

module.exports = {
  create,
  load,
  amend,
  request,
  award,
  dispatch,
  pickup,
  deliver,
  attachInvoice,
  reconcile,
  listOrdersForAsset,
  listOrdersByStatus,
  listFreightEvents,
  invoiceFingerprint,
  actualFromInvoices,
  canAttachInvoiceAtStatus,
  statusAfterInvoice,
  canAmendOrderAtStatus,
  buildAmendedFreightOrder,
  freightAmendmentDiff,
  amendmentFingerprint
};
