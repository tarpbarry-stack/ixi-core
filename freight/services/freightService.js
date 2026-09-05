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
  hasExpectedAmount
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
  resolveOrProvisionAosObjectForPassport
} = require(
  "../../mos/provisioning/aosObjectIdentityResolver"
);

const {
  clean,
  nowIso,
  money
} = require("../util");

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
  statusAfterInvoice
};
