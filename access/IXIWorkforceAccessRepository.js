"use strict";

const { getMosSqliteStore } = require("../mos/storage/sqliteStore");
const { MosError } = require("../mos/errors/MosError");

const initialized = new WeakSet();

function database() {
  if (process.env.IXI_MOS_STORAGE_PROVIDER !== "sqlite") {
    throw new MosError(
      "WORKFORCE_ACCESS_STORAGE_REQUIRED",
      "Workforce access requires the durable MOS database.",
      null,
      503
    );
  }

  const db = getMosSqliteStore().database;
  if (!initialized.has(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workforce_access_profiles (
        entity_id TEXT NOT NULL,
        person_object_id TEXT NOT NULL,
        person_passport_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(entity_id, person_object_id),
        UNIQUE(entity_id, person_passport_id)
      );
      CREATE TABLE IF NOT EXISTS workforce_access_invitations (
        entity_id TEXT NOT NULL,
        invitation_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        person_object_id TEXT NOT NULL,
        email TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        revision INTEGER NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(entity_id, invitation_id),
        UNIQUE(entity_id, command_id)
      );
      CREATE INDEX IF NOT EXISTS workforce_access_invitee
        ON workforce_access_invitations(entity_id, person_object_id, updated_at);
      CREATE TABLE IF NOT EXISTS workforce_access_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        person_object_id TEXT NOT NULL,
        action TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS workforce_access_history
        ON workforce_access_audit(entity_id, person_object_id, id);
    `);
    initialized.add(db);
  }
  return db;
}

function parse(row) {
  return row ? JSON.parse(row.payload) : null;
}

function getProfile(entityId, personObjectId) {
  return parse(database().prepare(
    "SELECT payload FROM workforce_access_profiles WHERE entity_id=? AND person_object_id=?"
  ).get(entityId, personObjectId));
}

function saveProfile({ entityId, personObjectId, personPassportId, actorId, expectedRevision, profile }) {
  const db = database();
  return db.transaction(() => {
    const previous = getProfile(entityId, personObjectId);
    const currentRevision = Number(previous?.revision || 0);
    if (Number(expectedRevision || 0) !== currentRevision) {
      throw new MosError(
        "WORKFORCE_ACCESS_REVISION_CONFLICT",
        "This access profile changed. Reload it before saving.",
        { expectedRevision: Number(expectedRevision || 0), currentRevision },
        409
      );
    }

    const now = new Date().toISOString();
    const saved = {
      ...profile,
      entityId,
      personObjectId,
      personPassportId,
      revision: currentRevision + 1,
      createdAt: previous?.createdAt || now,
      createdBy: previous?.createdBy || actorId,
      updatedAt: now,
      updatedBy: actorId
    };
    const payload = JSON.stringify(saved);
    db.prepare(`
      INSERT INTO workforce_access_profiles
        (entity_id,person_object_id,person_passport_id,revision,payload,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(entity_id,person_object_id) DO UPDATE SET
        person_passport_id=excluded.person_passport_id,
        revision=excluded.revision,
        payload=excluded.payload,
        updated_at=excluded.updated_at
    `).run(entityId, personObjectId, personPassportId, saved.revision, payload, saved.createdAt, now);
    db.prepare(`
      INSERT INTO workforce_access_audit
        (entity_id,actor_id,person_object_id,action,before_json,after_json,created_at)
      VALUES(?,?,?,?,?,?,?)
    `).run(entityId, actorId, personObjectId, previous ? "updated" : "created",
      previous ? JSON.stringify(previous) : null, payload, now);
    return saved;
  }).immediate();
}

function getInvitation(entityId, invitationId) {
  return parse(database().prepare(
    "SELECT payload FROM workforce_access_invitations WHERE entity_id=? AND invitation_id=?"
  ).get(entityId, invitationId));
}

function getInvitationByCommand(entityId, commandId) {
  return parse(database().prepare(
    "SELECT payload FROM workforce_access_invitations WHERE entity_id=? AND command_id=?"
  ).get(entityId, commandId));
}

function listInvitations(entityId, personObjectId) {
  return database().prepare(`
    SELECT payload FROM workforce_access_invitations
    WHERE entity_id=? AND person_object_id=? ORDER BY updated_at DESC
  `).all(entityId, personObjectId).map(parse);
}

function createInvitation({ entityId, actorId, commandId, payloadHash, invitation }) {
  const db = database();
  return db.transaction(() => {
    const replay = getInvitationByCommand(entityId, commandId);
    if (replay) {
      if (replay.payloadHash !== payloadHash) {
        throw new MosError(
          "WORKFORCE_INVITATION_COMMAND_CONFLICT",
          "This invitation save identifier was already used for different details.",
          null,
          409
        );
      }
      return replay;
    }

    const now = new Date().toISOString();
    const saved = {
      ...invitation,
      entityId,
      commandId,
      payloadHash,
      revision: 1,
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId
    };
    db.prepare(`
      INSERT INTO workforce_access_invitations
        (entity_id,invitation_id,command_id,payload_hash,person_object_id,email,token_hash,revision,payload,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).run(entityId, saved.id, commandId, payloadHash, saved.personObjectId, saved.email,
      saved.tokenHash, saved.revision, JSON.stringify(saved), now, now);
    db.prepare(`
      INSERT INTO workforce_access_audit
        (entity_id,actor_id,person_object_id,action,before_json,after_json,created_at)
      VALUES(?,?,?,?,?,?,?)
    `).run(entityId, actorId, saved.personObjectId, "invitation-created", null, JSON.stringify(saved), now);
    return saved;
  }).immediate();
}

function updateInvitation({ entityId, invitationId, actorId, expectedRevision, patch, action }) {
  const db = database();
  return db.transaction(() => {
    const previous = getInvitation(entityId, invitationId);
    if (!previous) return null;
    if (Number(previous.revision || 0) !== Number(expectedRevision || 0)) {
      throw new MosError(
        "WORKFORCE_INVITATION_REVISION_CONFLICT",
        "This invitation changed. Reload it before continuing.",
        null,
        409
      );
    }
    const now = new Date().toISOString();
    const saved = {
      ...previous,
      ...patch,
      revision: previous.revision + 1,
      updatedAt: now,
      updatedBy: actorId
    };
    const result = db.prepare(`
      UPDATE workforce_access_invitations SET revision=?,payload=?,updated_at=?
      WHERE entity_id=? AND invitation_id=? AND revision=?
    `).run(saved.revision, JSON.stringify(saved), now, entityId, invitationId, previous.revision);
    if (Number(result.changes) !== 1) {
      throw new MosError("WORKFORCE_INVITATION_REVISION_CONFLICT", "This invitation changed.", null, 409);
    }
    db.prepare(`
      INSERT INTO workforce_access_audit
        (entity_id,actor_id,person_object_id,action,before_json,after_json,created_at)
      VALUES(?,?,?,?,?,?,?)
    `).run(entityId, actorId, saved.personObjectId, action, JSON.stringify(previous), JSON.stringify(saved), now);
    return saved;
  }).immediate();
}

module.exports = {
  database,
  getProfile,
  saveProfile,
  getInvitation,
  getInvitationByCommand,
  listInvitations,
  createInvitation,
  updateInvitation
};
