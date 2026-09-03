"use strict";

/*
 * IXI FINANCIAL WORK ORDER FACTORY
 *
 * PURPOSE
 * -------
 *
 * Create canonical IXI Financial Documents
 * representing WORK ORDERS.
 *
 *
 * ECONOMIC MEANING
 * ----------------
 *
 * A Work Order can represent incurred cost
 * as work is performed.
 *
 * Typical lines:
 *
 * labor
 * parts
 * outside-service
 * technology
 * freight
 * miscellaneous
 *
 *
 * A Work Order may reference:
 *
 * machine
 * job
 * employee
 * technician
 * vendor
 * location
 * entity
 *
 *
 * THIS FACTORY DOES NOT:
 *
 * - persist
 * - authorize
 * - calculate lifecycle
 * - calculate snapshots
 * - discover hierarchy
 */


const crypto =
  require("crypto");


/* =========================================================
   HELPERS
   ========================================================= */

function clean(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


function safeArray(
  value
) {
  return Array.isArray(
    value
  )
    ? value
    : [];
}


function safeObject(
  value
) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}


function safeNumber(
  value,
  fallback = 0
) {
  const number =
    Number(
      value
    );

  return Number.isFinite(
    number
  )
    ? number
    : fallback;
}


function roundMoney(
  value
) {
  return Math.round(
    (
      safeNumber(
        value,
        0
      ) +
      Number.EPSILON
    ) *
    100
  ) / 100;
}


function nowIso() {
  return new Date()
    .toISOString();
}


function randomId(
  prefix
) {
  return `${prefix}_${crypto
    .randomBytes(12)
    .toString("hex")}`;
}


function normalizeCurrency(
  value
) {
  const currency =
    clean(
      value ||
      "USD"
    ).toUpperCase();

  return /^[A-Z]{3}$/.test(
    currency
  )
    ? currency
    : "USD";
}


/* =========================================================
   REFERENCES
   ========================================================= */

function normalizeReference(
  input = {}
) {
  const source =
    safeObject(
      input
    );

  const passportId =
    clean(
      source.passportId
    );

  const role =
    clean(
      source.role
    );

  if (
    !passportId ||
    !role
  ) {
    return null;
  }

  return {
    passportId,

    role,

    label:
      clean(
        source.label
      ),

    objectType:
      clean(
        source.objectType
      ),

    metadata: {
      ...safeObject(
        source.metadata
      )
    }
  };
}


function normalizeReferences(
  references = []
) {
  const map =
    new Map();

  safeArray(
    references
  ).forEach(
    reference => {
      const normalized =
        normalizeReference(
          reference
        );

      if (
        !normalized
      ) {
        return;
      }

      const key =
        `${normalized.passportId}|${normalized.role}`;

      if (
        !map.has(
          key
        )
      ) {
        map.set(
          key,
          normalized
        );
      }
    }
  );

  return Array.from(
    map.values()
  );
}


/* =========================================================
   WORK ORDER LINE
   ========================================================= */

function createWorkOrderLine({
  financialDocumentId = "",
  financialLineId = "",

  lineType = "work-order",

  description = "",

  quantity = 1,
  rate = 0,
  amount = null,

  currency = "USD",

  occurredAt = "",

  references = [],

  category = "",
  costCode = "",

  employeePassportId = "",
  technicianPassportId = "",
  vendorPassportId = "",

  partNumber = "",
  unitOfMeasure = "",

  laborHours = null,

  metadata = {}
} = {}) {

  const resolvedQuantity =
    safeNumber(
      quantity,
      1
    );

  const resolvedRate =
    roundMoney(
      rate
    );

  const resolvedAmount =
    amount === null ||
    amount === undefined
      ? roundMoney(
          resolvedQuantity *
          resolvedRate
        )
      : roundMoney(
          amount
        );


  const lineReferences =
    normalizeReferences([
      ...safeArray(
        references
      ),

      employeePassportId
        ? {
            passportId:
              employeePassportId,

            role:
              "employee"
          }
        : null,

      technicianPassportId
        ? {
            passportId:
              technicianPassportId,

            role:
              "technician"
          }
        : null,

      vendorPassportId
        ? {
            passportId:
              vendorPassportId,

            role:
              "vendor"
          }
        : null
    ].filter(Boolean));


  return {
    financialLineId:
      clean(
        financialLineId
      ) ||
      randomId(
        "ifl"
      ),

    financialDocumentId:
      clean(
        financialDocumentId
      ),

    lineType:
      clean(
        lineType ||
        "work-order"
      ).toLowerCase(),

    description:
      clean(
        description ||
        "WORK ORDER ITEM"
      ),

    category:
      clean(
        category
      ),

    costCode:
      clean(
        costCode
      ),

    partNumber:
      clean(
        partNumber
      ),

    unitOfMeasure:
      clean(
        unitOfMeasure
      ),

    laborHours:
      laborHours ===
        null ||
      laborHours ===
        undefined
        ? null
        : safeNumber(
            laborHours,
            0
          ),

    quantity:
      resolvedQuantity,

    rate:
      resolvedRate,

    amount:
      resolvedAmount,

    currency:
      normalizeCurrency(
        currency
      ),

    direction:
      "outflow",

    occurredAt:
      clean(
        occurredAt
      ) ||
      nowIso(),

    references:
      lineReferences,

    metadata: {
      ...safeObject(
        metadata
      )
    }
  };
}


/* =========================================================
   WORK ORDER DOCUMENT
   ========================================================= */

function createWorkOrderDocument({
  financialDocumentId = "",

  documentNumber = "",

  financialState = "incurred",

  currency = "USD",

  occurredAt = "",

  completedAt = "",

  description = "",

  memo = "",

  references = [],

  lines = [],

  machinePassportId = "",
  jobPassportId = "",
  locationPassportId = "",

  employeePassportId = "",
  technicianPassportId = "",
  vendorPassportId = "",

  sourceFinancialDocumentId = "",

  relatedFinancialDocumentIds = [],

  workOrderType = "",
  priority = "",

  sourceSystem = "",
  sourceDocumentId = "",
  externalReference = "",

  workOrder = {},
  techWorkOrder = {},

  metadata = {}
} = {}) {

  const resolvedDocumentId =
    clean(
      financialDocumentId
    ) ||
    randomId(
      "ifd"
    );


  const resolvedCurrency =
    normalizeCurrency(
      currency
    );


  const resolvedOccurredAt =
    clean(
      occurredAt
    ) ||
    nowIso();


  const documentReferences =
    normalizeReferences([
      ...safeArray(
        references
      ),

      machinePassportId
        ? {
            passportId:
              machinePassportId,

            role:
              "asset"
          }
        : null,

      jobPassportId
        ? {
            passportId:
              jobPassportId,

            role:
              "job"
          }
        : null,

      locationPassportId
        ? {
            passportId:
              locationPassportId,

            role:
              "location"
          }
        : null,

      employeePassportId
        ? {
            passportId:
              employeePassportId,

            role:
              "employee"
          }
        : null,

      technicianPassportId
        ? {
            passportId:
              technicianPassportId,

            role:
              "technician"
          }
        : null,

      vendorPassportId
        ? {
            passportId:
              vendorPassportId,

            role:
              "vendor"
          }
        : null
    ].filter(Boolean));


  const resolvedLines =
    safeArray(
      lines
    ).map(
      line =>
        createWorkOrderLine({
          ...safeObject(
            line
          ),

          financialDocumentId:
            resolvedDocumentId,

          currency:
            line?.currency ||
            resolvedCurrency,

          occurredAt:
            line?.occurredAt ||
            resolvedOccurredAt,

          references:
            line?.references ||
            documentReferences
        })
    );


  const total =
    roundMoney(
      resolvedLines.reduce(
        (
          sum,
          line
        ) =>
          sum +
          safeNumber(
            line?.amount,
            0
          ),
        0
      )
    );


  const sourceId =
    clean(
      sourceFinancialDocumentId
    );


  const relatedIds =
    Array.from(
      new Set(
        [
          ...safeArray(
            relatedFinancialDocumentIds
          ),

          sourceId
        ]
          .map(
            clean
          )
          .filter(
            Boolean
          )
      )
    );


  const resolvedWorkOrder =
    safeObject(
      workOrder
    );

  const resolvedTechWorkOrder =
    safeObject(
      techWorkOrder
    );

  const technologyWorkOrder =
    clean(workOrderType).toLowerCase() === "technology" ||
    clean(resolvedTechWorkOrder.schema) === "ixi-tech-work-order-v1";

  const resolvedOperationalRecord =
    technologyWorkOrder
      ? resolvedTechWorkOrder
      : resolvedWorkOrder;


  const resolvedDocumentNumber =
    clean(
      documentNumber ||
      resolvedOperationalRecord
        ?.identity
        ?.number
    ) ||
    `${technologyWorkOrder ? "TECHWO" : "WO"}-${resolvedDocumentId
      .replace(/^ifd_/, "")
      .slice(technologyWorkOrder ? -6 : -8)
      .toUpperCase()}`;


  return {
    financialDocumentId:
      resolvedDocumentId,

    documentType:
      "work-order",

    documentNumber:
      resolvedDocumentNumber,

    financialState:
      clean(
        financialState ||
        "incurred"
      ).toLowerCase(),

    currency:
      resolvedCurrency,

    occurredAt:
      resolvedOccurredAt,

    completedAt:
      clean(
        completedAt
      ),

    description:
      clean(
        description
      ),

    memo:
      clean(
        memo
      ),

    workOrderType:
      clean(
        workOrderType
      ),

    priority:
      clean(
        priority ||
        resolvedOperationalRecord
          ?.work
          ?.priority
      ),

    ...(technologyWorkOrder
      ? {
          techWorkOrder: {
            ...resolvedTechWorkOrder,
            identity: {
              ...safeObject(resolvedTechWorkOrder?.identity),
              techWorkOrderId: resolvedDocumentId,
              workOrderId: resolvedDocumentId,
              number: resolvedDocumentNumber
            }
          }
        }
      : {
          workOrder: {
            ...resolvedWorkOrder,
            identity: {
              ...safeObject(resolvedWorkOrder?.identity),
              workOrderId:
                clean(resolvedWorkOrder?.identity?.workOrderId) ||
                resolvedDocumentId,
              number: resolvedDocumentNumber
            }
          }
        }),

    sourceSystem:
      clean(
        sourceSystem
      ),

    sourceDocumentId:
      clean(
        sourceDocumentId
      ),

    externalReference:
      clean(
        externalReference
      ),

    sourceFinancialDocumentId:
      sourceId,

    relatedFinancialDocumentIds:
      relatedIds,

    relationships:
      sourceId
        ? [
            {
              financialDocumentId:
                sourceId,

              relationshipType:
                "derived-from"
            }
          ]
        : [],

    references:
      documentReferences,

    lines:
      resolvedLines,

    totals: {
      subtotal:
        total,

      total:
        total
    },

    metadata: {
      ...safeObject(
        metadata
      )
    }
  };
}


/* =========================================================
   SIMPLE WORK ORDER
   ========================================================= */

function createSimpleWorkOrder({
  machinePassportId = "",
  jobPassportId = "",

  description = "",

  documentNumber = "",

  occurredAt = "",

  currency = "USD",

  employeePassportId = "",
  technicianPassportId = "",

  laborHours = 0,
  laborRate = 0,

  partsAmount = 0,

  outsideServiceAmount = 0,

  technologyAmount = 0,

  miscellaneousAmount = 0,

  metadata = {}
} = {}) {

  const lines =
    [];


  if (
    safeNumber(
      laborHours,
      0
    ) >
      0 ||
    safeNumber(
      laborRate,
      0
    ) >
      0
  ) {
    lines.push({
      lineType:
        "labor",

      description:
        "LABOR",

      quantity:
        safeNumber(
          laborHours,
          0
        ),

      rate:
        safeNumber(
          laborRate,
          0
        ),

      laborHours:
        safeNumber(
          laborHours,
          0
        ),

      employeePassportId,

      technicianPassportId,

      category:
        "LABOR"
    });
  }


  if (
    safeNumber(
      partsAmount,
      0
    ) >
      0
  ) {
    lines.push({
      lineType:
        "parts",

      description:
        "PARTS",

      quantity:
        1,

      rate:
        safeNumber(
          partsAmount,
          0
        ),

      category:
        "PARTS"
    });
  }


  if (
    safeNumber(
      outsideServiceAmount,
      0
    ) >
      0
  ) {
    lines.push({
      lineType:
        "outside-service",

      description:
        "OUTSIDE SERVICE",

      quantity:
        1,

      rate:
        safeNumber(
          outsideServiceAmount,
          0
        ),

      category:
        "OUTSIDE SERVICE"
    });
  }


  if (
    safeNumber(
      technologyAmount,
      0
    ) >
      0
  ) {
    lines.push({
      lineType:
        "technology",

      description:
        "TECHNOLOGY",

      quantity:
        1,

      rate:
        safeNumber(
          technologyAmount,
          0
        ),

      category:
        "TECHNOLOGY"
    });
  }


  if (
    safeNumber(
      miscellaneousAmount,
      0
    ) >
      0
  ) {
    lines.push({
      lineType:
        "miscellaneous",

      description:
        "MISCELLANEOUS",

      quantity:
        1,

      rate:
        safeNumber(
          miscellaneousAmount,
          0
        ),

      category:
        "MISCELLANEOUS"
    });
  }


  return createWorkOrderDocument({
    documentNumber,

    description,

    occurredAt,

    currency,

    machinePassportId,

    jobPassportId,

    employeePassportId,

    technicianPassportId,

    lines,

    metadata
  });
}


/* =========================================================
   EXPORTS
   ========================================================= */

module.exports = {
  normalizeReference,
  normalizeReferences,

  createWorkOrderLine,
  createWorkOrderDocument,
  createSimpleWorkOrder
};
