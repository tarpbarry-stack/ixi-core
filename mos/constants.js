const MOS_OBJECT_TYPES = Object.freeze({
  ENTITY: "entity",
  PERSON: "person",
  MACHINE: "machine",
  EQUIPMENT: "equipment",
  VEHICLE: "vehicle",
  TRAILER: "trailer",
  TOOL: "tool",
  REAL_ESTATE: "real-estate",
  LOCATION: "location",
  JOB: "job",
  BUILDING: "building",
  ROOM: "room",
  SYSTEM_INDEX: "system-index",
  GENERIC: "generic",
  WORK_ORDER: "work-order",
  JOB_TICKET: "job-ticket",
  EXPENSE: "expense",
  MOVEMENT: "movement",
  FREIGHT: "freight"
});

const MOS_RELATIONSHIP_TYPES = Object.freeze({
  CONTAINED_IN: "contained-in",
  ASSIGNED_TO: "assigned-to",
  OPERATED_BY: "operated-by",
  MANAGED_BY: "managed-by",
  LOCATED_AT: "located-at",
  RESPONSIBLE_FOR: "responsible-for",
  WORK_ORDER_FOR: "work-order-for",
  SERVICE_LOCATION: "service-location",
  JOB_CONTEXT: "job-context"
});

const MOS_OBJECT_STATUS = Object.freeze({
  ACTIVE: "active",
  ARCHIVED: "archived",
  SOFT_DELETED: "soft-deleted"
});

const MOS_MOVEMENT_STATUS = Object.freeze({
  REQUESTED: "requested",
  PLANNED: "planned",
  PICKED_UP: "picked-up",
  IN_TRANSIT: "in-transit",
  COMPLETED: "completed",
  CANCELLED: "cancelled"
});

const MOS_MOVEMENT_TYPES = Object.freeze({
  IMMEDIATE: "immediate",
  PHYSICAL_TRANSFER: "physical-transfer",
  FREIGHT_REQUIRED: "freight-required",
  SELF_PROPELLED: "self-propelled",
  REASSIGNMENT: "reassignment",
  LOAD: "load",
  UNLOAD: "unload",
  CHECKOUT: "checkout",
  CHECKIN: "checkin"
});

module.exports = {
  MOS_OBJECT_TYPES,
  MOS_RELATIONSHIP_TYPES,
  MOS_OBJECT_STATUS,
  MOS_MOVEMENT_STATUS,
  MOS_MOVEMENT_TYPES
};
