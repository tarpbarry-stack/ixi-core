const path = require("path");

const MOS_DATA_ROOT =
  process.env.IXI_MOS_DATA_ROOT ||
  path.join(process.cwd(), "data", "mos");

function mosDataPath(filename) {
  return path.join(MOS_DATA_ROOT, filename);
}

const MOS_PATHS = Object.freeze({
  root: MOS_DATA_ROOT,

  entities: mosDataPath("entities.json"),
  objects: mosDataPath("objects.json"),
  relationships: mosDataPath("relationships.json"),
  events: mosDataPath("events.json"),
  projections: mosDataPath("projections.json"),
  idempotency: mosDataPath("idempotency.json"),
  internalAuthReplay: mosDataPath("internal-auth-replay.json"),
  permissions: mosDataPath("permissions.json"),
  notifications: mosDataPath("notifications.json"),
  imports: mosDataPath("imports.json"),
  importJobs: mosDataPath("import-jobs.json"),
  workOrders: mosDataPath("work-orders.json"),
  jobTickets: mosDataPath("job-tickets.json"),
  expenses: mosDataPath("expenses.json"),
  movements: mosDataPath("movements.json"),
  accounts: mosDataPath("accounts.json"),
  memberships: mosDataPath("memberships.json"),
  customerObjectTypes: mosDataPath("customer-object-types.json"),
  cardTemplates: mosDataPath("card-templates.json"),

  faceLibrary: mosDataPath("face-library.json"),
  faceVersions: mosDataPath("face-versions.json"),
  faceAssignments: mosDataPath("face-assignments.json"),
  faceAudit: mosDataPath("face-audit.json")
});

module.exports = {
  MOS_DATA_ROOT,
  MOS_PATHS,
  mosDataPath
};
