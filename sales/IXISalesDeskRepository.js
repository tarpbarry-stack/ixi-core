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
      CREATE INDEX IF NOT EXISTS sales_desk_due ON sales_desk_records(entity_id,kind,json_extract(payload,'$.dueDate'));
      CREATE INDEX IF NOT EXISTS sales_desk_start ON sales_desk_records(entity_id,kind,json_extract(payload,'$.startAt'));
      CREATE UNIQUE INDEX IF NOT EXISTS sales_desk_inquiry_source ON sales_desk_records(entity_id,json_extract(payload,'$.sourceId')) WHERE kind='inquiries';
      CREATE TABLE IF NOT EXISTS sales_desk_source_customers (entity_id TEXT NOT NULL, source_id TEXT NOT NULL, contact_id TEXT NOT NULL, PRIMARY KEY(entity_id,source_id));
      CREATE INDEX IF NOT EXISTS sales_desk_assignment ON sales_desk_records(entity_id,kind,json_extract(payload,'$.assignedTo'));
      CREATE INDEX IF NOT EXISTS sales_desk_contact_link ON sales_desk_records(entity_id,kind,json_extract(payload,'$.contactId'));
      CREATE INDEX IF NOT EXISTS sales_desk_deal_link ON sales_desk_records(entity_id,kind,json_extract(payload,'$.dealId'));
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
function visibility(actor, alias="r") {
  if (!actor || actor.canReadAll) return {sql:"1=1",args:[]};
  const own=`((${alias}.kind NOT IN ('packages','inquiries') AND json_extract(${alias}.payload,'$.assignedTo')=?) OR (${alias}.kind='boards' AND json_extract(${alias}.payload,'$.createdBy')=?))`;
  const contact=`(${alias}.kind='contacts' AND EXISTS(SELECT 1 FROM sales_desk_records d WHERE d.entity_id=${alias}.entity_id AND d.kind IN ('deals','tasks') AND json_extract(d.payload,'$.contactId')=${alias}.id AND json_extract(d.payload,'$.assignedTo')=?))`;
  const note=`(${alias}.kind='notes' AND EXISTS(SELECT 1 FROM sales_desk_records p WHERE p.entity_id=${alias}.entity_id AND p.id=json_extract(${alias}.payload,'$.parentId') AND p.kind=json_extract(${alias}.payload,'$.parentKind') AND (json_extract(p.payload,'$.assignedTo')=? OR (p.kind='contacts' AND EXISTS(SELECT 1 FROM sales_desk_records d WHERE d.entity_id=p.entity_id AND d.kind IN ('deals','tasks') AND json_extract(d.payload,'$.contactId')=p.id AND json_extract(d.payload,'$.assignedTo')=?)))))`;
  const packet=`(${alias}.kind IN ('packages','inquiries') AND EXISTS(SELECT 1 FROM sales_desk_records d WHERE d.entity_id=${alias}.entity_id AND d.kind='deals' AND d.id=json_extract(${alias}.payload,'$.dealId') AND json_extract(d.payload,'$.assignedTo')=?))`;
  return {sql:`(${own} OR ${contact} OR ${note} OR ${packet})`,args:Array(6).fill(actor.actorId)};
}
function visible(actor,kind,id) {
  const access=visibility(actor);
  return !!database().prepare(`SELECT 1 FROM sales_desk_records r WHERE r.entity_id=? AND r.kind=? AND r.id=? AND ${access.sql}`).get(actor.entityId,kind,id,...access.args);
}
function list(entityId, kind, { query="",offset=0,limit=100,parentId="",contactId="",dealId="",dueBefore="",openOnly=false,actor=null }={}) {
  const db=database(),access=visibility(actor),args=[entityId,kind,String(query).toLowerCase(),...access.args];
  let where=`r.entity_id=? AND r.kind=? AND instr(r.search_text,?)>0 AND ${access.sql}`;
  for(const [field,value] of [["parentId",parentId],["contactId",contactId],["dealId",dealId]]) if(value){where+=` AND json_extract(r.payload,'$.${field}')=?`;args.push(value);}
  if(dueBefore){where+=" AND json_extract(r.payload,'$.dueDate')<>'' AND json_extract(r.payload,'$.dueDate')<=?";args.push(dueBefore);}
  if(openOnly && kind==="tasks")where+=" AND coalesce(json_extract(r.payload,'$.canceled'),0)=0";
  if(dueBefore && kind==="deals")where+=" AND coalesce(json_extract(r.payload,'$.actionCompleted'),0)=0 AND coalesce(json_extract(r.payload,'$.canceled'),0)=0";
  if(openOnly)where+=" AND coalesce(json_extract(r.payload,'$.completed'),0)=0 AND coalesce(json_extract(r.payload,'$.stage'),'') NOT IN ('lost','archived')";
  return {items:db.prepare(`SELECT r.payload FROM sales_desk_records r WHERE ${where} ORDER BY r.updated_at DESC,r.id LIMIT ? OFFSET ?`).all(...args,limit,offset).map(parse),total:db.prepare(`SELECT count(*) AS total FROM sales_desk_records r WHERE ${where}`).get(...args).total,offset,limit};
}
function summary(entityId,today,actor=null) {
  return {contacts:list(entityId,"contacts",{actor,limit:1}).total,activeDeals:list(entityId,"deals",{actor,openOnly:true,limit:1}).total,dueTasks:list(entityId,"tasks",{actor,openOnly:true,dueBefore:today,limit:1}).total,dueDeals:list(entityId,"deals",{actor,openOnly:true,dueBefore:today,limit:1}).total};
}
function history(entityId,kind,id) {
  return database().prepare("SELECT actor_id AS actorId,action,created_at AS createdAt FROM sales_desk_audit WHERE entity_id=? AND kind=? AND record_id=? ORDER BY id DESC LIMIT 50").all(entityId,kind,id);
}
function replayCommand({ entityId, actorId, commandId, input, canReadAll }) {
  const row=database().prepare("SELECT payload_hash,result FROM sales_desk_commands WHERE entity_id=? AND actor_id=? AND command_id=?").get(entityId,actorId,commandId);
  if(!row)return null;
  const hash=crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
  if(row.payload_hash!==hash)throw new MosError("SALES_COMMAND_CONFLICT","This save identifier was already used for different changes.",null,409);
  const saved=JSON.parse(row.result);
  if(input.kind && !visible({entityId,actorId,canReadAll},input.kind,saved.record.id))throw new MosError("SALES_NOT_FOUND","This sales record is no longer assigned to you.",null,404);
  return saved;
}
function command({ entityId, actorId, commandId, input, canReadAll }, prepare) {
  const db = database();
  const hash = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const replay = () => replayCommand({entityId,actorId,commandId,input,canReadAll});
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
module.exports = { database,get,list,history,command,replayCommand,summary,visible,visibility };
