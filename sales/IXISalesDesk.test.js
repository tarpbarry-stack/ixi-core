"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const root = fs.mkdtempSync(path.join(os.tmpdir(),"sales-desk-"));
process.env.IXI_MOS_STORAGE_PROVIDER = "sqlite";
process.env.IXI_MOS_DATA_ROOT = path.join(root,"mos");
process.env.IXI_PASSPORT_DATA_FILE = path.join(root,"passports.json");
const { ensureAosAccount } = require("../mos/accounts/aosAccountService");
const { MOS_PATHS } = require("../mos/storage/mosPaths");
const { readJsonFile,writeJsonFileAtomic } = require("../mos/storage/jsonStore");
const { listObjects } = require("../mos/objects/objectService");
const { readPassportRecords } = require("../passport/passportRegistry");
const service = require("./IXISalesDeskService");
const repo = require("./IXISalesDeskRepository");
const a = ensureAosAccount({ownerUserId:"owner-a",displayName:"Company A"});
const b = ensureAosAccount({ownerUserId:"owner-b",displayName:"Company B"});
const context = entity => ({authenticated:true,principalId:entity.account.ownerUserId,entityId:entity.entity.entityId});
const actor = service.authorize(context(a)), other = service.authorize(context(b));
const command = (kind,record,revision) => ({kind,record,revision,commandId:crypto.randomUUID()});
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

test("access rejects anonymous, cross-company, inactive and expressly denied owners",()=>{
  assert.throws(()=>service.authorize({}),e=>e.statusCode===401);
  assert.throws(()=>service.authorize({...context(a),entityId:b.entity.entityId}),e=>e.statusCode===403);
  const memberships = readJsonFile(MOS_PATHS.memberships,{});
  const original = {...memberships[a.membership.membershipId]};
  for (const patch of [{status:"inactive"},{role:"viewer"},{directDenies:["sales-desk.access"]}]) {
    memberships[original.membershipId] = {...original,...patch}; writeJsonFileAtomic(MOS_PATHS.memberships,memberships);
    assert.throws(()=>service.authorize(context(a)),e=>e.statusCode===403);
  }
  memberships[original.membershipId]=original;writeJsonFileAtomic(MOS_PATHS.memberships,memberships);
});
let contact;
test("contact save is durable and retry-safe with exactly one canonical identity",()=>{
  const objectsBefore=listObjects({entityId:actor.entityId}).length;
  const input=command("contacts",{name:"Buyer One",email:"buyer@example.test",phone:"555-123-4567"});
  contact=service.save(actor,input).record;
  assert.ok(contact.passportId);assert.ok(contact.objectId);
  assert.deepEqual(service.save(actor,input).record,contact);
  assert.equal(listObjects({entityId:actor.entityId}).length,objectsBefore+1);
  assert.equal(readPassportRecords().filter(p=>p.passportId===contact.passportId).length,1);
  assert.deepEqual(service.getRecord(actor,"contacts",contact.id),contact);
  assert.throws(()=>service.save(actor,{...input,record:{...input.record,name:"Different"}}),e=>e.code==="SALES_COMMAND_CONFLICT");
});
test("company isolation applies to lists, detail, links and saves",()=>{
  assert.equal(service.listRecords(other,"contacts",{}).total,0);
  assert.throws(()=>service.getRecord(other,"contacts",contact.id),e=>e.statusCode===404);
  assert.throws(()=>service.save(other,command("contacts",{...contact,name:"Stolen"},contact.revision)),e=>e.statusCode===404);
  assert.throws(()=>service.save(other,command("deals",{title:"Deal",contactId:contact.id,stage:"inquiry"})),e=>e.statusCode===404);
});
test("duplicates and stale revisions cannot silently fork or overwrite customer history",()=>{
  assert.throws(()=>service.save(actor,command("contacts",{name:"Another",email:contact.email})),e=>e.code==="SALES_DUPLICATE_CONTACT");
  const changed=service.save(actor,command("contacts",{...contact,company:"Buyer Company"},contact.revision)).record;
  assert.equal(changed.revision,2);assert.equal(changed.passportId,contact.passportId);
  assert.throws(()=>service.save(actor,command("contacts",{...contact,company:"Old window"},contact.revision)),e=>e.code==="SALES_REVISION_CONFLICT");
  assert.equal(repo.history(actor.entityId,"contacts",contact.id).length,2);
});
let deal;
test("deals and follow-ups persist without manufacturing sold or payment facts",()=>{
  deal=service.save(actor,command("deals",{title:"Loader enquiry",contactId:contact.id,stage:"inquiry",nextAction:"Call buyer",dueDate:"2026-09-20"})).record;
  assert.equal(deal.customerPassportId,contact.passportId);
  for (const stage of ["paid","sold","settled"]) assert.throws(()=>service.save(actor,command("deals",{...deal,stage},deal.revision)),e=>e.code==="SALES_STAGE_INVALID");
  assert.throws(()=>service.save(actor,command("tasks",{title:"Call",dueDate:"2026-02-30"})),e=>e.code==="SALES_DATE_INVALID");
  const task=service.save(actor,command("tasks",{title:"Call buyer",dueDate:"2026-09-20",dealId:deal.id})).record;
  assert.equal(service.save(actor,command("tasks",{...task,completed:true},task.revision)).record.completed,true);
  const note=service.save(actor,command("notes",{parentKind:"deals",parentId:deal.id,title:"Buyer wants inspection photos."})).record;
  assert.throws(()=>service.save(actor,command("notes",note,note.revision)),e=>e.code==="SALES_NOTE_IMMUTABLE");
});
test("saved board movement creates no objects or passports",()=>{
  const before=[listObjects({entityId:actor.entityId}).length,readPassportRecords().length];
  service.save(actor,command("boards",{title:"Buyer comparison",keys:["passport:EXISTING-REFERENCE"]}));
  assert.deepEqual([listObjects({entityId:actor.entityId}).length,readPassportRecords().length],before);
});
test("SQLite backup restores sales rows and their audit trail",async()=>{
  const backup=path.join(root,"restore.sqlite");
  await repo.database().backup(backup);
  const Database=require("better-sqlite3"); const restored=new Database(backup,{readonly:true});
  assert.equal(restored.prepare("SELECT count(*) AS count FROM sales_desk_records WHERE entity_id=?").get(actor.entityId).count,5);
  assert.ok(restored.prepare("SELECT count(*) AS count FROM sales_desk_audit").get().count>=7);
  restored.close();
});
