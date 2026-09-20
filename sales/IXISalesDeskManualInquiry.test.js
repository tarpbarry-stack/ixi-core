'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'manual-inquiry-'));
process.env.IXI_MOS_STORAGE_PROVIDER='sqlite';process.env.IXI_MOS_DATA_ROOT=path.join(root,'mos');process.env.IXI_PASSPORT_DATA_FILE=path.join(root,'passports.json');
const {ensureAosAccount,bindOwnerMembershipIdentity}=require('../mos/accounts/aosAccountService'),{provisionAosObject}=require('../mos/provisioning/aosObjectProvisioningService'),{listObjects}=require('../mos/objects/objectService');
const access=require('./IXISalesDeskAccess'),service=require('./IXISalesDeskService'),repo=require('./IXISalesDeskRepository'),work=require('./IXISalesDeskWork'),schedule=require('./IXISalesDeskSchedule'),intake=require('./IXISalesDeskIntake');
const account=ensureAosAccount({ownerUserId:'calendar-owner',displayName:'Calendar Company'}),entityId=account.entity.entityId;
const person=name=>provisionAosObject({commandId:crypto.randomUUID(),entityId,objectType:'person',displayName:name,actorId:'calendar-owner'}).identity;
const identity=person('Owner');bindOwnerMembershipIdentity({accountId:account.account.accountId,ownerUserId:'calendar-owner',personObjectId:identity.objectId,personPassportId:identity.passportId});
const context=principalId=>({authenticated:true,principalId,entityId}),owner=access.authorize(context('calendar-owner'));
const member=person('Salesperson'),inv=access.invitation(owner,{personObjectId:member.objectId,email:'rep@example.test',role:'sales',scope:'assigned'});
access.acceptInvitation(context('calendar-rep'),{entityId,id:inv.id,token:inv.token,email:'rep@example.test',verifiedEmail:true});const rep=access.authorize(context('calendar-rep'));
const manual=require('./IXISalesDeskManualInquiry');
const cmd=(kind,record,revision)=>({kind,record,revision,commandId:crypto.randomUUID()});
const input=(extra={})=>({commandId:crypto.randomUUID(),source:'Phone call',title:'Needs a loader',receivedAt:'2026-09-20T10:00:00.000Z',message:'Buyer called about an inspection.',contact:{name:'Phone Buyer',email:'phone@example.test',phone:'555-987-6543'},machines:[],schedule:{nextAction:'Call about loader',dueDate:'2026-10-12',allDay:false,startTime:'10:30',timeZone:'America/Chicago',durationMinutes:30,activityType:'call'},...extra});
const count=kind=>repo.list(entityId,kind).total;
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('manual inquiry creates one connected customer, original, deal and calendar action; retries preserve identity',()=>{
  const payload=input(),before=listObjects({entityId}).length,first=manual.capture(owner,payload),again=manual.capture(owner,payload);
  assert.equal(first.record.id,again.record.id);assert.equal(first.contact.id,again.contact.id);assert.equal(first.deal.id,again.deal.id);
  assert.equal(count('contacts'),1);assert.equal(count('deals'),1);assert.equal(count('inquiries'),1);assert.equal(count('tasks'),0);assert.equal(listObjects({entityId}).length,before+1);
  assert.equal(first.record.source,'Phone call');assert.equal(first.record.message,payload.message);assert.deepEqual(first.deal.financialDocumentIds,[]);
  const event=work.calendar(owner,{from:'2026-10-12',to:'2026-10-12',zone:'America/Chicago',scope:'mine'}).items[0];assert.equal(event.dealId,first.deal.id);assert.equal(event.time,'10:30');assert.equal(event.title,'Call about loader');
  assert.equal(service.related(owner,'contacts',first.contact.id).inquiries.items[0].id,first.record.id);
  assert.throws(()=>manual.capture(owner,{...payload,message:'Changed retry'}),e=>e.code==='SALES_COMMAND_CONFLICT');
  assert.throws(()=>service.save(owner,cmd('inquiries',{...first.record,message:'Edited'})),e=>e.code==='SALES_INQUIRY_IMMUTABLE');
});
test('an outside inquiry reuses a matching or chosen customer and supports no machine and no calendar',()=>{
  const before=listObjects({entityId}).length,first=manual.capture(owner,input({source:'Outside website',sourceDetail:'Equipment listing site',schedule:null}));
  assert.equal(count('contacts'),1);assert.equal(listObjects({entityId}).length,before);assert.equal(first.deal.dueDate,'');assert.equal(first.record.sourceDetail,'Equipment listing site');
  const second=manual.capture(owner,input({contactId:first.contact.id,contact:null,schedule:null,machines:[{key:'listing:loader',listingId:'loader',title:'Loader'}]}));assert.equal(second.contact.id,first.contact.id);assert.equal(second.deal.machines[0].listingId,'loader');
});
test('invalid schedule, input and assignment are rejected before any customer admission',()=>{
  const before=listObjects({entityId}).length,records=count('contacts');
  for(const payload of [input({source:'IronXchange marketplace'}),input({schedule:{nextAction:'Call',dueDate:'2026-03-08',startTime:'02:30',allDay:false,timeZone:'America/Chicago'}}),input({title:''}),input({receivedAt:'nonsense'}),input({schedule:{nextAction:'',dueDate:'2026-10-12'}}),input({machines:[{key:'bad'}]})])assert.throws(()=>manual.capture(owner,payload));
  assert.throws(()=>manual.capture(rep,input({assignedTo:owner.actorId})),e=>e.statusCode===403);
  assert.throws(()=>manual.capture({...owner,canWrite:false},input()),e=>e.statusCode===403);
  assert.equal(listObjects({entityId}).length,before);assert.equal(count('contacts'),records);
});
test('interrupted commit rolls back the deal and retries the already-admitted canonical customer',()=>{
  const payload=input({contact:{name:'Recoverable Customer'}}),before=count('deals'),original=repo.command;
  repo.command=(args,prepare)=>original(args,()=>{const prepared=prepare();if(prepared.kind==='inquiries')throw new Error('Interrupted before original committed');return prepared;});
  try{assert.throws(()=>manual.capture(owner,payload),/Interrupted/);}finally{repo.command=original;}
  assert.equal(count('deals'),before);const identities=listObjects({entityId}).length;
  assert.throws(()=>manual.capture(owner,{...payload,title:'Different retry'}),e=>e.code==='SALES_COMMAND_CONFLICT');
  const saved=manual.capture(owner,payload);assert.equal(count('deals'),before+1);assert.equal(listObjects({entityId}).length,identities);assert.equal(service.related(owner,'contacts',saved.contact.id).inquiries.total,1);
});
test('representatives can log inquiries; current assignment and company boundaries still govern originals and retries',()=>{
  const payload=input({contact:{name:'Rep Customer',email:'rep-buyer@example.test'}}),saved=manual.capture(rep,payload);
  assert.equal(saved.deal.assignedTo,rep.actorId);assert.equal(service.getRecord(rep,'inquiries',saved.record.id).id,saved.record.id);
  service.save(owner,cmd('deals',{...saved.deal,assignedTo:owner.actorId},saved.deal.revision));
  assert.throws(()=>manual.capture(rep,payload),e=>e.statusCode===404);
  assert.throws(()=>manual.capture({...owner,entityId:'foreign-company'},input({contactId:saved.contact.id})),e=>[400,404].includes(e.statusCode));
  const hidden=repo.list(entityId,'contacts').items.find(c=>c.email==='phone@example.test');
  assert.throws(()=>manual.capture(rep,input({contactId:hidden.id})),e=>e.statusCode===404);
});
test('matching email and phone on different contacts requires explicit customer selection',()=>{
  service.save(owner,cmd('contacts',{name:'Other Buyer',email:'other@example.test',phone:'555-666-7777'}));
  assert.throws(()=>manual.capture(owner,input({contact:{name:'Ambiguous',email:'phone@example.test',phone:'555-666-7777'}})),e=>e.code==='SALES_INQUIRY_MATCH_REVIEW');
});
