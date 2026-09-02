const {
  MOS_OBJECT_TYPES
} = require("../constants");

const BASE_CAPABILITIES = Object.freeze({
  canContain: false,
  canMove: true,
  canHaveQr: true,
  canHaveMedia: true,
  canHaveDocuments: true,
  canHaveExpenses: true,
  canHaveWorkOrders: true,
  canHaveJobTickets: false
});

function capabilities(overrides = {}) {
  return Object.freeze({
    ...BASE_CAPABILITIES,
    ...overrides
  });
}

const MOS_OBJECT_TEMPLATES = Object.freeze({
  [MOS_OBJECT_TYPES.ENTITY]: {
    objectType: MOS_OBJECT_TYPES.ENTITY,
    label: "Entity",
    capabilities: capabilities({
      canContain: true,
      canMove: false,
      canHaveExpenses: false,
      canHaveWorkOrders: false
    })
  },

  [MOS_OBJECT_TYPES.PERSON]: {
    objectType: MOS_OBJECT_TYPES.PERSON,
    label: "Person",
    capabilities: capabilities({
      canHaveJobTickets: true
    })
  },

  [MOS_OBJECT_TYPES.MACHINE]: {
    objectType: MOS_OBJECT_TYPES.MACHINE,
    label: "Machine",
    capabilities: capabilities()
  },

  [MOS_OBJECT_TYPES.EQUIPMENT]: {
    objectType: MOS_OBJECT_TYPES.EQUIPMENT,
    label: "Equipment",
    capabilities: capabilities()
  },

  [MOS_OBJECT_TYPES.VEHICLE]: {
    objectType: MOS_OBJECT_TYPES.VEHICLE,
    label: "Vehicle",
    capabilities: capabilities({
      canContain: true
    })
  },

  [MOS_OBJECT_TYPES.TRAILER]: {
    objectType: MOS_OBJECT_TYPES.TRAILER,
    label: "Trailer",
    capabilities: capabilities({
      canContain: true
    })
  },

  [MOS_OBJECT_TYPES.TOOL]: {
    objectType: MOS_OBJECT_TYPES.TOOL,
    label: "Tool",
    capabilities: capabilities()
  },

  [MOS_OBJECT_TYPES.REAL_ESTATE]: {
    objectType: MOS_OBJECT_TYPES.REAL_ESTATE,
    label: "Real Estate",
    capabilities: capabilities({
      canContain: true
    })
  },

  [MOS_OBJECT_TYPES.LOCATION]: {
    objectType: MOS_OBJECT_TYPES.LOCATION,
    label: "Location",
    capabilities: capabilities({
      canContain: true
    })
  },

  [MOS_OBJECT_TYPES.JOB]: {
    objectType: MOS_OBJECT_TYPES.JOB,
    label: "Job",
    capabilities: capabilities({
      canContain: true,
      canHaveJobTickets: true
    })
  },

  [MOS_OBJECT_TYPES.BUILDING]: {
    objectType: MOS_OBJECT_TYPES.BUILDING,
    label: "Building",
    capabilities: capabilities({
      canContain: true
    })
  },

  [MOS_OBJECT_TYPES.ROOM]: {
    objectType: MOS_OBJECT_TYPES.ROOM,
    label: "Room",
    capabilities: capabilities({
      canContain: true
    })
  },

  [MOS_OBJECT_TYPES.GENERIC]: {
    objectType: MOS_OBJECT_TYPES.GENERIC,
    label: "Object",
    capabilities: capabilities()
  }
});

function getObjectTemplate(objectType) {
  return (
    MOS_OBJECT_TEMPLATES[objectType] ||
    MOS_OBJECT_TEMPLATES[MOS_OBJECT_TYPES.GENERIC]
  );
}

module.exports = {
  BASE_CAPABILITIES,
  MOS_OBJECT_TEMPLATES,
  getObjectTemplate
};
