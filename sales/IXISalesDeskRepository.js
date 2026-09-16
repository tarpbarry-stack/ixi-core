"use strict";

// Uses the existing durable MOS database and its verified backup/restore path.
// Sales rows are indexed individually; saving a note never rewrites a tenant's book.
const { getMosSqliteStore } = require("../mos/storage/sqliteStore");
const { MosError } = require("../mos/errors/MosError");
const crypto = require("node:crypto");
const initialized = new WeakSet();

function database() {
  if (process.env.IXI_MOS_STORAGE_PROVIDER !== "sqlite") {
    throw new MosError("SALES_STORAGE_REQUIRED", "Sales Desk requires durable database storage.", null, 503);
  }
  const db = getMosSqliteStore().database;
  if (!initialized.has(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sales_desk_records (
        entity_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
        revision INTEGER NOT NULL, payload TEXT NOT NULL, search_text TEXT NOT NULL,
        updated_at TEXT NOT NULL, PRIMARY KEY(entity_id, kind, id)
      );
      CREATE INDEX IF NOT EXISTS sales_desk_listing ON sales_desk_records(entity_id,kind,updated_at);
      CREATE UNIQUE INDEX IF NOT EXISTS sales_contact_email ON sales_desk_records(entity_id,json_extract(payload,'$.email')) WHERE kind='contacts' AND json_extract(payload,'$.email')<>'';
      CREATE UNIQUE INDEX IF NOT EXISTS sales_contact_object ON sales_desk_records(entity_id,json_extract(payload,'$.objectId')) WHERE kind='contacts';
      CREATE TABLE IF NOT EXISTS sales_desk_commands (
        entity_id TEXT NOT NULL, actor_id TEXT NOT NULL, command_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(entity_id,actor_id,command_id)
      );
      CREATE TABLE IF NOT EXISTS sales_desk_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id TEXT NOT NULL, actor_id TEXT NOT NULL,
        kind TEXT NOT NULL, record_id TEXT NOT NULL, action TEXT NOT NULL,
        before_json TEXT, after_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sales_desk_history ON sales_desk_audit(entity_id,kind,record_id,id);
    `);
    initialized.add(db);
  }
  return db;
}
const parse = row => row ? JSON.parse(row.payload) : null;
function get(entityId, kind, id) {
  return parse(database().prepare("SELECT payload FROM sales_desk_records WHERE entity_id=? AND kind=? AND id=?").get(entityId,kind,id));
}
function list(entityId, kind, { query = "", offset = 0, limit = 100, parentId = "" } = {}) {
  const db = database();
  const q = String(query).toLowerCase();
  const where = "entity_id=? AND kind=? AND instr(search_text,?)>0" + (parentId ? " AND json_extract(payload,'$.parentId')=?" : "");
  const args = [entityId,kind,q,...(parentId ? [parentId] : [])];
  return {
    items: db.prepare(`SELECT payload FROM sales_desk_records WHERE ${where} ORDER BY updated_at DESC,id LIMIT ? OFFSET ?`).all(...args,limit,offset).map(parse),
    total: db.prepare(`SELECT count(*) AS total FROM sales_desk_records WHERE ${where}`).get(...args).total,
    offset, limit
  };
}
function summary(entityId,today) {
  const db=database();
  const count=(where,args=[])=>db.prepare(`SELECT count(*) AS total FROM sales_desk_records WHERE entity_id=? AND ${where}`).get(entityId,...args).total;
  return {contacts:count("kind='contacts'"),activeDeals:count("kind='deals' AND json_extract(payload,'$.stage') NOT IN ('lost','archived')"),dueTasks:count("kind='tasks' AND json_extract(payload,'$.completed')=0 AND json_extract(payload,'$.dueDate')<=?",[today])};
}
function history(entityId,kind,id) {
  return database().prepare("SELECT actor_id AS actorId,action,created_at AS createdAt FROM sales_desk_audit WHERE entity_id=? AND kind=? AND record_id=? ORDER BY id DESC LIMIT 50").all(entityId,kind,id);
}
function command({ entityId, actorId, commandId, input }, prepare) {
  const db = database();
  const hash = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const replay = () => {
    const row = db.prepare("SELECT payload_hash,result FROM sales_desk_commands WHERE entity_id=? AND actor_id=? AND command_id=?").get(entityId,actorId,commandId);
    if (!row) return null;
    if (row.payload_hash !== hash) throw new MosError("SALES_COMMAND_CONFLICT", "This save identifier was already used for different changes.", null, 409);
    return JSON.parse(row.result);
  };
  const previous = replay();
  if (previous) return previous;
  // Canonical provisioning uses its existing recoverable command before the
  // sales transaction. A retry recovers the same Object and Passport.
  const { kind, record, expectedRevision = 0 } = prepare();
  return db.transaction(() => {
    const duplicate = replay();
    if (duplicate) return duplicate;
    const old = get(entityId,kind,record.id);
    if ((old?.revision || 0) !== expectedRevision) throw new MosError("SALES_REVISION_CONFLICT", "This record changed in another session. Reload it before saving.", null, 409);
    const now = new Date().toISOString();
    const saved = { ...record, entityId, revision: expectedRevision + 1, createdAt: old?.createdAt || now, createdBy: old?.createdBy || actorId, updatedAt: now, updatedBy: actorId };
    const payload = JSON.stringify(saved);
    const search = [saved.name,saved.company,saved.email,saved.phone,saved.title,saved.customerName,saved.nextAction,saved.stage,saved.interest].filter(Boolean).join(" ").toLowerCase();
    try {
      db.prepare("INSERT INTO sales_desk_records VALUES(?,?,?,?,?,?,?) ON CONFLICT(entity_id,kind,id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,search_text=excluded.search_text,updated_at=excluded.updated_at").run(entityId,kind,saved.id,saved.revision,payload,search,now);
    } catch(error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") throw new MosError("SALES_DUPLICATE_CONTACT","This contact identity or email already belongs to a saved contact. Open that contact instead.",null,409);
      throw error;
    }
    db.prepare("INSERT INTO sales_desk_audit(entity_id,actor_id,kind,record_id,action,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?)").run(entityId,actorId,kind,saved.id,old ? "updated" : "created",old ? JSON.stringify(old) : null,payload,now);
    const result = { record: saved };
    db.prepare("INSERT INTO sales_desk_commands VALUES(?,?,?,?,?,?)").run(entityId,actorId,commandId,hash,JSON.stringify(result),now);
    return result;
  }).immediate();
}
module.exports = { database,get,list,history,command,summary };
