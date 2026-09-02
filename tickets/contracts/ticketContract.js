"use strict";

const {
  TICKET_SCHEMA,
  TICKET_STATUS,
  TICKET_SOURCES,
  TICKET_TYPES,
  TICKET_PRIORITIES,
  EXECUTION_CLASSES,
  MUTABLE_REQUEST_STATUSES
} = require("../constants");

const {
  TicketError
} = require("../TicketError");

const {
  clean,
  lower,
  safeObject,
  safeArray,
  nowIso,
  createId,
  uniqueStrings,
  deepClone
} = require("../util");

function requireEnum(
  value,
  allowed,
  field,
  fallback = ""
) {
  const resolved =
    lower(value || fallback);

  if (!allowed.includes(resolved)) {
    throw new TicketError(
      "TICKET_ENUM_INVALID",
      `Invalid Ticket ${field}.`,
      {
        field,
        value: resolved,
        allowed
      },
      400
    );
  }

  return resolved;
}

function normalizeEditSection(
  source = {},
  index = 0
) {
  const value = safeObject(source);

  return {
    editId:
      clean(value.editId) ||
      createId("edit"),

    ordinal:
      Number.isInteger(value.ordinal)
        ? value.ordinal
        : index + 1,

    description:
      clean(value.description),

    result:
      clean(value.result),

    status:
      clean(value.status)
  };
}

function normalizeAttachments(
  values = []
) {
  return safeArray(values).map(item => {
    const value = safeObject(item);

    return {
      attachmentId:
        clean(value.attachmentId) ||
        createId("attachment"),

      name:
        clean(value.name),

      contentType:
        clean(
          value.contentType ||
          value.type
        ),

      size:
        Number(value.size || 0),

      state:
        clean(value.state),

      storageKey:
        clean(value.storageKey),

      checksum:
        clean(value.checksum),

      createdAt:
        clean(value.createdAt)
    };
  });
}

function normalizeContext(
  source = {}
) {
  const value = safeObject(source);

  return {
    route:
      clean(value.route),

    environment:
      clean(value.environment),

    objectId:
      clean(value.objectId),

    passportId:
      clean(value.passportId),

    cardFamily:
      clean(value.cardFamily),

    cardContext:
      clean(value.cardContext),

    face:
      clean(value.face),

    scaleMode:
      clean(value.scaleMode),

    transactModule:
      clean(value.transactModule),

    recordIds:
      safeObject(value.recordIds),

    viewport:
      safeObject(value.viewport),

    userAgent:
      clean(value.userAgent),

    buildVersion:
      clean(value.buildVersion),

    diagnostic:
      safeObject(value.diagnostic)
  };
}

function normalizeGithub(
  source = {}
) {
  const value = safeObject(source);

  return {
    repository:
      clean(value.repository),

    issueNumber:
      Number(value.issueNumber || 0) || 0,

    issueUrl:
      clean(value.issueUrl),

    issueNodeId:
      clean(value.issueNodeId),

    state:
      clean(value.state),

    labels:
      uniqueStrings(value.labels),

    publishedAt:
      clean(value.publishedAt),

    syncedAt:
      clean(value.syncedAt)
  };
}

function normalizeCloseout(
  source = {}
) {
  const value = safeObject(source);

  return {
    summary:
      clean(value.summary),

    editResults:
      safeArray(value.editResults),

    filesChanged:
      uniqueStrings(value.filesChanged),

    tests:
      safeArray(value.tests),

    before:
      clean(value.before),

    after:
      clean(value.after),

    risks:
      safeArray(value.risks),

    notes:
      safeArray(value.notes),

    prs:
      safeArray(value.prs),

    completedAt:
      clean(value.completedAt),

    completedBy:
      clean(value.completedBy)
  };
}

function normalizeVerification(
  values = []
) {
  return safeArray(values).map(item => {
    const value = safeObject(item);

    return {
      verificationId:
        clean(value.verificationId) ||
        createId("verification"),

      decision:
        clean(value.decision),

      note:
        clean(value.note),

      actorPassportId:
        clean(value.actorPassportId),

      createdAt:
        clean(value.createdAt)
    };
  });
}

function createTicket({
  ticketId = "",
  displayNumber = "",
  source = "internal-chat",
  status = TICKET_STATUS.DRAFT,
  type = "bug",
  priority = "normal",
  executionClass = "review",
  repository = "ironxchange-homepage",
  headline = "",
  originalRequest = "",
  editSections = [],
  attachments = [],
  context = {},
  entityId = "",
  entityPassportId = "",
  actorPassportId = "",
  createdBy = "",
  metadata = {}
} = {}) {
  const createdAt =
    nowIso();

  return normalizeTicket({
    schema:
      TICKET_SCHEMA,

    ticketId:
      clean(ticketId) ||
      createId("ticket"),

    displayNumber:
      clean(displayNumber),

    source,
    status,
    type,
    priority,
    executionClass,

    repository:
      clean(repository),

    headline:
      clean(headline),

    originalRequest:
      clean(originalRequest),

    editSections:
      safeArray(editSections),

    attachments:
      safeArray(attachments),

    context:
      safeObject(context),

    authority: {
      entityId:
        clean(entityId),

      entityPassportId:
        clean(entityPassportId),

      actorPassportId:
        clean(actorPassportId),

      createdBy:
        clean(createdBy)
    },

    github: {},
    closeout: {},
    verificationHistory: [],

    audit: {
      createdAt,
      updatedAt:
        createdAt,
      requestLockedAt:
        ""
    },

    metadata:
      safeObject(metadata)
  });
}

function normalizeTicket(
  source = {}
) {
  const value =
    safeObject(source);

  const status =
    requireEnum(
      value.status,
      Object.values(TICKET_STATUS),
      "status",
      TICKET_STATUS.DRAFT
    );

  const ticket = {
    schema:
      TICKET_SCHEMA,

    ticketId:
      clean(value.ticketId) ||
      createId("ticket"),

    displayNumber:
      clean(value.displayNumber),

    source:
      requireEnum(
        value.source,
        TICKET_SOURCES,
        "source",
        "internal-chat"
      ),

    status,

    type:
      requireEnum(
        value.type,
        TICKET_TYPES,
        "type",
        "bug"
      ),

    priority:
      requireEnum(
        value.priority,
        TICKET_PRIORITIES,
        "priority",
        "normal"
      ),

    executionClass:
      requireEnum(
        value.executionClass,
        EXECUTION_CLASSES,
        "executionClass",
        "review"
      ),

    repository:
      clean(value.repository) ||
      "ironxchange-homepage",

    headline:
      clean(value.headline),

    originalRequest:
      clean(value.originalRequest),

    editSections:
      safeArray(
        value.editSections
      ).map(normalizeEditSection),

    attachments:
      normalizeAttachments(
        value.attachments
      ),

    context:
      normalizeContext(
        value.context
      ),

    authority: {
      entityId:
        clean(
          value.authority?.entityId
        ),

      entityPassportId:
        clean(
          value.authority?.entityPassportId
        ),

      actorPassportId:
        clean(
          value.authority?.actorPassportId
        ),

      createdBy:
        clean(
          value.authority?.createdBy
        )
    },

    github:
      normalizeGithub(
        value.github
      ),

    closeout:
      normalizeCloseout(
        value.closeout
      ),

    verificationHistory:
      normalizeVerification(
        value.verificationHistory
      ),

    audit: {
      createdAt:
        clean(
          value.audit?.createdAt
        ) || nowIso(),

      updatedAt:
        clean(
          value.audit?.updatedAt
        ) || nowIso(),

      requestLockedAt:
        clean(
          value.audit?.requestLockedAt
        ),

      closedAt:
        clean(
          value.audit?.closedAt
        ),

      closedBy:
        clean(
          value.audit?.closedBy
        )
    },

    metadata:
      safeObject(
        value.metadata
      )
  };

  return ticket;
}

function validateReadyRequest(
  ticket
) {
  const request =
    clean(ticket.originalRequest);

  const edits =
    ticket.editSections.filter(
      edit =>
        clean(edit.description)
    );

  if (
    !request &&
    !edits.length
  ) {
    throw new TicketError(
      "TICKET_REQUEST_REQUIRED",
      "Ticket requires an original request or at least one edit section.",
      {},
      400
    );
  }
}

function lockOriginalRequest(
  ticket,
  at = nowIso()
) {
  const next =
    normalizeTicket(ticket);

  validateReadyRequest(next);

  if (!next.audit.requestLockedAt) {
    next.audit.requestLockedAt =
      at;
  }

  next.audit.updatedAt =
    at;

  return next;
}

function assertRequestMutationAllowed(
  existing
) {
  const ticket =
    normalizeTicket(existing);

  if (
    !MUTABLE_REQUEST_STATUSES.has(
      ticket.status
    ) ||
    ticket.audit.requestLockedAt
  ) {
    throw new TicketError(
      "TICKET_REQUEST_LOCKED",
      "Original Ticket request evidence is immutable after the Ticket leaves draft.",
      {
        status:
          ticket.status,

        requestLockedAt:
          ticket.audit.requestLockedAt
      },
      409
    );
  }
}

function publicTicket(
  ticket
) {
  return deepClone(
    normalizeTicket(ticket)
  );
}

module.exports = {
  createTicket,
  normalizeTicket,
  normalizeEditSection,
  validateReadyRequest,
  lockOriginalRequest,
  assertRequestMutationAllowed,
  publicTicket
};
