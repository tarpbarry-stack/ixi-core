"use strict";
const { MOS_DATA_ROOT } = require("./mosPaths");
const { getMosSqliteStore } = require("./sqliteStore");
const initialized = new WeakSet();
function database() {
  // Use the existing backed-up MOS database, not a second ephemeral journal.
  const db = getMosSqliteStore({ dataRoot: MOS_DATA_ROOT }).database;
  if (!initialized.has(db)) {
    db.exec(`CREATE TABLE IF NOT EXISTS post_free_postings (
      posting_key TEXT PRIMARY KEY, entity_id TEXT NOT NULL, principal_id TEXT NOT NULL,
      operation_id TEXT NOT NULL, object_id TEXT, passport_id TEXT, title TEXT NOT NULL,
      status TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS post_free_object ON post_free_postings(object_id) WHERE object_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS post_free_passport ON post_free_postings(passport_id) WHERE passport_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS post_free_pending ON post_free_postings(entity_id,principal_id,created_at) WHERE status <> 'complete';`);
    initialized.add(db);
  }
  return db;
}
const decode = row => row ? JSON.parse(row.payload) : null;
function readPosting(postingKey) {
  return decode(database().prepare("SELECT payload FROM post_free_postings WHERE posting_key = ?").get(postingKey));
}
function updatePosting(postingKey, mutate) {
  const db = database();
  return db.transaction(() => {
    const previous = decode(db.prepare("SELECT payload FROM post_free_postings WHERE posting_key = ?").get(postingKey));
    const next = mutate(previous);
    db.prepare(`INSERT INTO post_free_postings VALUES (@key,@entity,@principal,@operation,@object,@passport,@title,@status,@created,@payload)
      ON CONFLICT(posting_key) DO UPDATE SET object_id=excluded.object_id,passport_id=excluded.passport_id,
      title=excluded.title,status=excluded.status,payload=excluded.payload`).run({
      key: postingKey, entity: next.entityId, principal: next.principalId, operation: next.operationId,
      object: next.objectId || null, passport: next.passportId || null, title: next.payload.title,
      status: next.status, created: next.createdAt, payload: JSON.stringify(next) });
    return next;
  }).immediate();
}
function pendingPostings(entityId, principalId) {
  return database().prepare(`SELECT operation_id AS operationId,title,status,created_at AS createdAt
    FROM post_free_postings WHERE entity_id=? AND principal_id=? AND status <> 'complete' ORDER BY created_at DESC`).all(entityId, principalId);
}
function postingForMachine(machineKey) {
  return decode(database().prepare("SELECT payload FROM post_free_postings WHERE passport_id=? OR object_id=?").get(machineKey, machineKey));
}
module.exports = { readPosting, updatePosting, pendingPostings, postingForMachine };
