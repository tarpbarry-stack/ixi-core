"use strict";
const crypto = require("node:crypto");
const repo = require("./IXISalesDeskRepository");
const { MosError } = require("../mos/errors/MosError");
const { getAosAccountForUser } = require("../mos/accounts/aosAccountService");
const { resolveMosMembershipPrincipal } = require("../mos/security/mosMembershipAuthorityService");
const { provisionAosObject } = require("../mos/provisioning/aosObjectProvisioningService");
const { getObject, listObjects } = require("../mos/objects/objectService");
const { resolveCanonicalObjectIdentity } = require("../mos/identity/canonicalObjectAdmissionService");

const KINDS = new Set(["contacts","deals","tasks","notes","boards"]);
const STAGES = ["inquiry","qualified","quoting","negotiating","handoff","lost","archived"];
const clean = value => String(value ?? "").trim();
function fail(code,message,status = 400) { throw new MosError(code,message,null,status); }
function text(value,max=250,required=false) {
  if (value !== undefined && value !== null && typeof value !== "string") fail("SALES_INPUT_INVALID","Text fields must contain text.");
  const result = clean(value);
  if (result.length > max || (required && !result)) fail("SALES_INPUT_INVALID",`Complete the required fields within ${max} characters.`);
  return result;
}
function authorize(context) {
  if (!context?.authenticated || !context.principalId || !context.entityId) fail("SALES_AUTH_REQUIRED","Sign in to open Sales Desk.",401);
  const { principal, membership } = resolveMosMembershipPrincipal(context);
  const account = getAosAccountForUser(context.principalId);
  const denied = principal.directDenies || [];
  if (membership.role !== "owner" || account.entity?.entityId !== context.entityId || denied.includes("*") || denied.includes("sales-desk.access")) {
    fail("SALES_ACCESS_DENIED","Sales Desk currently requires active company-owner access.",403);
  }
  return { entityId: context.entityId, actorId: context.principalId, company: account.entity.displayName, role: "owner" };
}
function kindOf(kind) { if (!KINDS.has(kind)) fail("SALES_KIND_INVALID","Unknown sales record."); return kind; }
function getRecord(actor,kind,id) {
  kindOf(kind);
  const record = repo.get(actor.entityId,kind,clean(id));
  if (!record) fail("SALES_NOT_FOUND","This sales record is unavailable.",404);
  return record;
}
function date(value) {
  const result = text(value,10);
  const parsed = new Date(`${result}T12:00:00Z`);
  if (result && (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== result)) fail("SALES_DATE_INVALID","Enter a valid date.");
  return result;
}
function listRecords(actor,kind,query) {
  kindOf(kind);
  return repo.list(actor.entityId,kind,{ query:text(query?.q,200),parentId:kind === "notes" ? text(query?.parentId,100) : "",offset:Math.min(1000000,Math.max(0,Number.parseInt(query?.offset,10)||0)),limit:Math.min(200,Math.max(1,Number.parseInt(query?.limit,10)||50)) });
}
function save(actor, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("SALES_INPUT_INVALID","A sales record is required.");
  const kind = kindOf(input.kind);
  const commandId = text(input.commandId,100,true);
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(commandId)) fail("SALES_COMMAND_REQUIRED","A valid save identifier is required.");
  const value = input.record;
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("SALES_INPUT_INVALID","Record fields are required.");
  return repo.command({ ...actor, commandId, input }, () => {
    const old = value.id ? getRecord(actor,kind,value.id) : null;
    const revision = old ? Number(input.revision) : 0;
    if (old && (!Number.isInteger(revision) || revision !== old.revision)) fail("SALES_REVISION_CONFLICT","This record changed in another session. Reload it before saving.",409);
    const id = old?.id || crypto.randomUUID();
    let record;
    if (kind === "contacts") {
      const name = text(value.name,150,true), email = text(value.email,254).toLowerCase(), phone = text(value.phone,60);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("SALES_EMAIL_INVALID","Enter a valid email address.");
      const matching = repo.database().prepare("SELECT payload FROM sales_desk_records WHERE entity_id=? AND kind='contacts'").all(actor.entityId).map(row=>JSON.parse(row.payload));
      if (matching.some(item => item.id !== id && ((email && item.email === email) || (phone.replace(/\D/g,"").length >= 7 && item.phone.replace(/\D/g,"") === phone.replace(/\D/g,""))))) fail("SALES_DUPLICATE_CONTACT","A contact with this email or phone already exists. Open that contact to keep its history together.",409);
      let identity = old ? { objectId: old.objectId, passportId: old.passportId } : null;
      if (!old && value.objectId && matching.some(item=>item.objectId === value.objectId)) fail("SALES_DUPLICATE_CONTACT","This IXI person is already in your contacts. Open the existing contact.",409);
      if (!identity && value.objectId) {
        const object = getObject(text(value.objectId,150));
        if (!object || object.entityId !== actor.entityId || object.objectType !== "person" || object.status !== "active") fail("SALES_CONTACT_IDENTITY_DENIED","Choose an active person belonging to this company.",403);
        identity = resolveCanonicalObjectIdentity({ objectId:object.objectId, entityId:actor.entityId });
      }
      if (!identity) {
        // Saving is the explicit identity-creation boundary. Reading/searching
        // contacts and moving a machine on the board never provision anything.
        const result = provisionAosObject({ commandId:`sales-contact-${actor.entityId}-${commandId}`,entityId:actor.entityId,objectType:"person",displayName:name,fields:{},actorId:actor.actorId });
        identity = result.identity;
      }
      record = { id,name,email,phone,company:text(value.company,150),address:text(value.address,500),source:text(value.source,100),interest:text(value.interest,1000),preference:text(value.preference,40),objectId:identity.objectId,passportId:identity.passportId };
    } else if (kind === "deals") {
      const contact = getRecord(actor,"contacts",text(value.contactId,100,true));
      const stage = text(value.stage,30,true);
      if (!STAGES.includes(stage)) fail("SALES_STAGE_INVALID","Choose a sales stage. Payments and SOLD are governed in TRAN$ACT.");
      const machines = Array.isArray(value.machines) ? value.machines : [];
      if (machines.length > 100) fail("SALES_MACHINE_LIMIT","A deal can include up to 100 machines.");
      const refs = machines.map(machine => ({ key:text(machine.key,180,true),passportId:text(machine.passportId,60),listingId:text(machine.listingId,100),title:text(machine.title,200,true) }));
      if (new Set(refs.map(item=>item.key)).size !== refs.length) fail("SALES_DUPLICATE_MACHINE","A machine can appear only once in a deal.");
      record = { id,title:text(value.title,150,true),contactId:contact.id,customerName:contact.name,customerPassportId:contact.passportId,stage,machines:refs,nextAction:text(value.nextAction,500),dueDate:date(value.dueDate),terms:text(value.terms,3000),lostReason:text(value.lostReason,500),assignedTo:actor.actorId };
      if (stage === "lost" && !record.lostReason) fail("SALES_LOST_REASON","Record why this deal was lost.");
    } else if (kind === "tasks") {
      const dealId = text(value.dealId,100);
      if (dealId) getRecord(actor,"deals",dealId);
      record = { id,title:text(value.title,250,true),dueDate:date(value.dueDate),dealId,completed:value.completed === true,assignedTo:actor.actorId };
      if (!record.dueDate) fail("SALES_TASK_DATE","Choose a follow-up date.");
    } else if (kind === "notes") {
      if (old) fail("SALES_NOTE_IMMUTABLE","Saved notes remain in history. Add a correction as a new note.",409);
      const parentKind = text(value.parentKind,20,true), parentId = text(value.parentId,100,true);
      if (!["contacts","deals"].includes(parentKind)) fail("SALES_NOTE_PARENT","Attach the note to a contact or deal.");
      getRecord(actor,parentKind,parentId);
      record = { id,title:text(value.title,4000,true),parentKind,parentId };
    } else {
      const keys = Array.isArray(value.keys) ? value.keys : [];
      if (keys.length > 100) fail("SALES_BOARD_LIMIT","Save up to 100 machines on one board.");
      record = { id,title:text(value.title,100,true),keys:[...new Set(keys.map(key=>text(key,180,true)))] };
    }
    return { kind,record,expectedRevision:revision };
  });
}
function people(actor) {
  return listObjects({entityId:actor.entityId,status:"active"}).filter(object=>object.objectType === "person").map(object=>({ objectId:object.objectId,name:object.displayName }));
}
module.exports = { authorize,save,listRecords,getRecord,people,STAGES,date };
