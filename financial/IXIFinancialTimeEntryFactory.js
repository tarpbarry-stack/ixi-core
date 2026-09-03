"use strict";

/*
 * IXI FINANCIAL TIME ENTRY FACTORY
 *
 * PURPOSE
 * -------
 *
 * Create canonical IXI Financial Documents
 * representing labor/time entries.
 *
 *
 * ECONOMIC MEANING
 * ----------------
 *
 * Time Entry represents labor cost incurred
 * as work is performed.
 *
 *
 * A single Time Entry may reference:
 *
 * employee
 * technician
 * machine
 * job
 * location
 * entity
 *
 *
 * IMPORTANT
 * ---------
 *
 * One Time Entry may appear in multiple
 * Passport snapshots.
 *
 * Recursive scope must still count the fact
 * only once.
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
   TIME ENTRY LINE
   ========================================================= */

function createTimeEntryLine({
  financialDocumentId = "",
  financialLineId = "",

  description = "",

  hours = 0,
  hourlyRate = 0,
  amount = null,

  currency = "USD",

  occurredAt = "",

  references = [],

  employeePassportId = "",
  technicianPassportId = "",

  laborClass = "",
  costCode = "",
  shiftCode = "",

  overtime = false,
  overtimeMultiplier = 1,

  metadata = {}
} = {}) {

  const resolvedHours =
    safeNumber(
      hours,
      0
    );


  const resolvedRate =
    roundMoney(
      hourlyRate
    );


  const multiplier =
    overtime
      ? Math.max(
          1,
          safeNumber(
            overtimeMultiplier,
            1
          )
        )
      : 1;


  const resolvedAmount =
    amount === null ||
    amount === undefined
      ? roundMoney(
          resolvedHours *
          resolvedRate *
          multiplier
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
      "time-entry",

    description:
      clean(
        description ||
        "LABOR TIME"
      ),

    laborClass:
      clean(
        laborClass
      ),

    costCode:
      clean(
        costCode
      ),

    shiftCode:
      clean(
        shiftCode
      ),

    overtime:
      Boolean(
        overtime
      ),

    overtimeMultiplier:
      multiplier,

    laborHours:
      resolvedHours,

    quantity:
      resolvedHours,

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
   TIME ENTRY DOCUMENT
   ========================================================= */

function createTimeEntryDocument({
  financialDocumentId = "",

  documentNumber = "",

  financialState = "incurred",

  currency = "USD",

  occurredAt = "",

  startedAt = "",
  endedAt = "",

  description = "",

  memo = "",

  references = [],

  lines = [],

  employeePassportId = "",
  technicianPassportId = "",

  machinePassportId = "",
  jobPassportId = "",
  locationPassportId = "",

  hours = 0,
  hourlyRate = 0,

  laborClass = "",
  costCode = "",
  shiftCode = "",

  overtime = false,
  overtimeMultiplier = 1,

  sourceFinancialDocumentId = "",

  sourceSystem = "",
  sourceDocumentId = "",
  externalReference = "",

  timeEntry = {},

  attachments = [],

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
      occurredAt ||
      endedAt ||
      startedAt
    ) ||
    nowIso();


  const documentReferences =
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
        : null
    ].filter(Boolean));


  let resolvedLines =
    safeArray(
      lines
    ).map(
      line =>
        createTimeEntryLine({
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


  if (
    resolvedLines.length ===
      0
  ) {
    resolvedLines = [
      createTimeEntryLine({
        financialDocumentId:
          resolvedDocumentId,

        description:
          description ||
          "LABOR TIME",

        hours,

        hourlyRate,

        currency:
          resolvedCurrency,

        occurredAt:
          resolvedOccurredAt,

        references:
          documentReferences,

        employeePassportId,

        technicianPassportId,

        laborClass,

        costCode,

        shiftCode,

        overtime,

        overtimeMultiplier
      })
    ];
  }


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


  const totalHours =
    safeArray(
      resolvedLines
    ).reduce(
      (
        sum,
        line
      ) =>
        sum +
        safeNumber(
          line?.laborHours,
          0
        ),
      0
    );


  const sourceId =
    clean(
      sourceFinancialDocumentId
    );

  const resolvedTimeEntry =
    safeObject(
      timeEntry
    );

  const resolvedDocumentNumber =
    clean(
      documentNumber ||
      resolvedTimeEntry?.identity?.number
    ) ||
    `TIME-${resolvedDocumentId
      .replace(/^ifd_/, "")
      .slice(-6)
      .toUpperCase()}`;


  return {
    financialDocumentId:
      resolvedDocumentId,

    documentType:
      "time-entry",

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

    startedAt:
      clean(
        startedAt ||
        resolvedTimeEntry?.time?.startedAt
      ),

    endedAt:
      clean(
        endedAt ||
        resolvedTimeEntry?.time?.endedAt
      ),

    description:
      clean(
        description
      ),

    memo:
      clean(
        memo
      ),

    timeEntry: {
      ...resolvedTimeEntry,
      identity: {
        ...safeObject(resolvedTimeEntry?.identity),
        timeEntryId: resolvedDocumentId,
        number: resolvedDocumentNumber
      }
    },

    attachments:
      safeArray(
        attachments
      ).map(item => ({ ...safeObject(item) })),

    laborClass:
      clean(
        laborClass
      ),

    costCode:
      clean(
        costCode
      ),

    shiftCode:
      clean(
        shiftCode
      ),

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
      laborHours:
        totalHours,

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
   SIMPLE TIME ENTRY
   ========================================================= */

function createSimpleTimeEntry({
  employeePassportId = "",
  technicianPassportId = "",

  machinePassportId = "",
  jobPassportId = "",
  locationPassportId = "",

  hours = 0,
  hourlyRate = 0,

  description = "",

  occurredAt = "",

  currency = "USD",

  laborClass = "",
  costCode = "",

  overtime = false,
  overtimeMultiplier = 1,

  metadata = {}
} = {}) {

  return createTimeEntryDocument({
    employeePassportId,

    technicianPassportId,

    machinePassportId,

    jobPassportId,

    locationPassportId,

    hours,

    hourlyRate,

    description,

    occurredAt,

    currency,

    laborClass,

    costCode,

    overtime,

    overtimeMultiplier,

    metadata
  });
}


/* =========================================================
   EXPORTS
   ========================================================= */

module.exports = {
  normalizeReference,
  normalizeReferences,

  createTimeEntryLine,
  createTimeEntryDocument,
  createSimpleTimeEntry
};
