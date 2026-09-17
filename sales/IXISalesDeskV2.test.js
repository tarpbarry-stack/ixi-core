'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'sales-v2-'));
process.env.IXI_MOS_STORAGE_PROVIDER='sqlite';process.env.IXI_MOS_DATA_ROOT=path.join(root,'mos');process.env.IXI_PASSPORT_DATA_FILE=path.join(root,'passports.json');
const {ensureAosAccount,bindOwnerMembershipIdentity}=require('../mos/accounts/aosAccountService');
const {provisionAosObject}=require('../mos/provisioning/aosObjectProvisioningService');
const {listObjects}=require('../mos/objects/objectService');
const {readJsonFile,writeJsonFileAtomic}=require('../mos/storage/jsonStore');
const {MOS_PATHS}=require('../mos/storage/mosPaths');
const access=require('./IXISalesDeskAccess'),service=require('./IXISalesDeskService'),repo=require('./IXISalesDeskRepository'),imports=require('./IXISalesDeskImport');
const account=ensureAosAccount({ownerUserId:'owner-v2',displayName:'Sales Company'}),entityId=account.entity.entityId;
const person=name=>provisionAosObject({commandId:crypto.randomUUID(),entityId,objectType:'person',displayName:name,actorId:'owner-v2'}).identity;
const ownerPerson=person('Owner');bindOwnerMembershipIdentity({accountId:account.account.accountId,ownerUserId:'owner-v2',personObjectId:ownerPerson.objectId,personPassportId:ownerPerson.passportId});
const owner=access.authorize({authenticated:true,principalId:'owner-v2',entityId}),sam=person('Sam'),lee=person('Lee');
const context=principalId=>({authenticated:true,principalId,entityId});
const command=(kind,record,revision)=>({kind,record,revision,commandId:crypto.randomUUID()});
const invite=(who,email,role='sales',scope='assigned')=>access.invitation(owner,{personObjectId:who.objectId,email,role,scope});
const accept=(inv,principalId,email,patch={})=>access.acceptInvitation(context(principalId),{entityId,id:inv.id,token:inv.token,verifiedEmail:true,email,...patch});
let samInvite,leeInvite,sales,viewer,contact,deal,task,originalTaskCommand;
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('invitation binds verified email to the existing person without creating identity',()=>{
  const before=listObjects({entityId}).length;
  samInvite=invite(sam,'sam@example.test');
  assert.throws(()=>accept(samInvite,'sam-user','wrong@example.test'),e=>e.code==='SALES_INVITATION_UNAVAILABLE');
  assert.throws(()=>accept(samInvite,'sam-user','sam@example.test',{verifiedEmail:false}),e=>e.statusCode===401);
  assert.throws(()=>accept(samInvite,'sam-user','sam@example.test',{token:'tampered'}),e=>e.statusCode===403);
  accept(samInvite,'sam-user','sam@example.test');accept(samInvite,'sam-user','sam@example.test');
  const memberships=Object.values(readJsonFile(MOS_PATHS.memberships,{})).filter(m=>m.principalId==='sam-user');assert.equal(memberships.length,1);assert.equal(memberships[0].personObjectId,sam.objectId);
  assert.equal(listObjects({entityId}).length,before);assert.equal(access.invitations(owner)[0].tokenHash,undefined);
  sales=access.authorize(context('sam-user'));assert.equal(sales.canFinancial,false);assert.equal(sales.canEditMachines,false);assert.equal(sales.canReadAll,false);assert.deepEqual(service.people(sales),[]);
  assert.equal(access.companies(context('sam-user'))[0].entityId,entityId);
});
test('revoked and expired invitations cannot grant seats',()=>{
  const revoked=invite(lee,'lee@example.test');access.revokeInvitation(owner,{id:revoked.id});assert.throws(()=>accept(revoked,'lee-user','lee@example.test'),e=>e.statusCode===403);
  const expired=invite(lee,'lee@example.test'),old=repo.get(entityId,'invitations',expired.id);repo.command({...owner,commandId:crypto.randomUUID(),input:{}},()=>({kind:'invitations',record:{...old,expiresAt:'2000-01-01T00:00:00Z'},expectedRevision:old.revision}));assert.throws(()=>accept(expired,'lee-user','lee@example.test'),e=>e.statusCode===403);
  leeInvite=invite(lee,'lee@example.test','viewer');accept(leeInvite,'lee-user','lee@example.test');viewer=access.authorize(context('lee-user'));assert.equal(viewer.canWrite,false);assert.throws(()=>service.save(viewer,command('contacts',{name:'Denied'})),e=>e.statusCode===403);
  assert.throws(()=>access.updateSeat(sales,{}),e=>e.statusCode===403);
});
test('assigned scope protects lists, direct URLs, notes, summaries, related work and edits',()=>{
  contact=service.save(owner,command('contacts',{name:'Buyer A',email:'buyer-a@example.test'})).record;
  deal=service.save(owner,command('deals',{title:'Loader',contactId:contact.id,stage:'qualified',machines:[{key:'passport:M1',passportId:'M1',title:'Loader'}],dueDate:'2026-09-17',nextAction:'Call'})).record;
  service.save(owner,command('notes',{parentKind:'deals',parentId:deal.id,title:'Owner-only note'}));
  assert.equal(service.listRecords(sales,'deals',{}).total,0);assert.equal(service.listRecords(sales,'notes',{}).total,0);assert.equal(repo.summary(entityId,'2026-09-17',sales).contacts,0);
  for(const fn of [()=>service.getRecord(sales,'deals',deal.id),()=>service.related(sales,'deals',deal.id),()=>service.save(sales,command('deals',{...deal,title:'Stolen'},deal.revision))])assert.throws(fn,e=>e.statusCode===404);
  deal=service.save(owner,command('deals',{...deal,assignedTo:'sam-user'},deal.revision)).record;
  assert.equal(service.getRecord(sales,'contacts',contact.id).id,contact.id);assert.equal(service.listRecords(sales,'notes',{parentId:deal.id}).total,1);assert.equal(service.related(sales,'deals',deal.id).customer.id,contact.id);assert.equal(repo.summary(entityId,'2026-09-17',sales).dueDeals,1);
  assert.throws(()=>service.save(sales,command('deals',{...deal,assignedTo:'lee-user'},deal.revision)),e=>e.code==='SALES_ASSIGNMENT_DENIED');
  assert.throws(()=>service.save(sales,command('deals',{...deal,financialDocumentIds:['ifd_test']},deal.revision)),e=>e.code==='SALES_FINANCIAL_LINK_DENIED');
});
test('follow-ups retain customer linkage, outcomes and business dates; mismatches are rejected',()=>{
  originalTaskCommand=command('tasks',{title:'Call buyer',dueDate:'2026-09-17',dealId:deal.id});task=service.save(sales,originalTaskCommand).record;
  assert.equal(task.contactId,contact.id);assert.equal(task.assignedTo,'sam-user');
  task=service.save(sales,command('tasks',{...task,completed:true,outcome:'Inspection requested'},task.revision)).record;
  assert.ok(task.completedAt);assert.equal(service.listRecords(sales,'tasks',{dueBefore:'2026-09-17',openOnly:'true'}).total,0);
  const another=service.save(owner,command('contacts',{name:'Different buyer'})).record;
  assert.throws(()=>service.save(owner,command('tasks',{title:'Wrong',dueDate:'2026-09-17',dealId:deal.id,contactId:another.id})),e=>e.code==='SALES_TASK_CONTACT_MISMATCH');
});
test('revoking access takes effect on next request and accepting the old link cannot re-enable it',()=>{
  let member=access.team(owner).find(m=>m.principalId==='sam-user');access.updateSeat(owner,{...member,enabled:false});assert.throws(()=>access.authorize(context('sam-user')),e=>e.statusCode===403);
  accept(samInvite,'sam-user','sam@example.test');assert.throws(()=>access.authorize(context('sam-user')),e=>e.statusCode===403);
  member=access.team(owner,true).find(m=>m.principalId==='sam-user');assert.equal(member.enabled,false);access.updateSeat(owner,{...member,enabled:true});sales=access.authorize(context('sam-user'));
  assert.throws(()=>access.updateSeat(owner,{...member,enabled:true}),e=>e.code==='SALES_REVISION_CONFLICT');
});
test('replayed commands cannot expose records after assignment is removed',()=>{
  task=service.save(owner,command('tasks',{...task,assignedTo:'owner-v2'},task.revision)).record;
  assert.throws(()=>service.save(sales,originalTaskCommand),e=>e.statusCode===404);
});
test('import review finds duplicates and invalid rows, commits partially and retries without extra people',()=>{
  const rows=[{name:'Imported',email:'import@example.test'},{name:'Duplicate',email:'IMPORT@example.test'},{name:'Existing',email:contact.email},{name:''}];const preview=imports.preview(owner,{rows});assert.deepEqual(preview.rows.map(r=>r.status),['ready','duplicate','existing','invalid']);
  assert.throws(()=>imports.preview(sales,{rows}),e=>e.statusCode===403);
  const before=listObjects({entityId}).length,body={batchId:crypto.randomUUID(),rows:[{index:0,value:preview.rows[0].value},{index:2,value:preview.rows[2].value}]};
  const result=imports.commit(owner,body);assert.deepEqual(result.results.map(r=>r.status),['saved','error']);assert.equal(imports.commit(owner,body).results[0].id,result.results[0].id);assert.equal(listObjects({entityId}).length,before+1);
});
test('buyer packages allow only deal machines and buyer-facing fields, with durable replay',()=>{
  const input=command('packages',{dealId:deal.id,title:'Buyer selection',message:'Inspection welcome',machines:[{key:'passport:M1',title:'Loader',price:'$80,000',hours:'4000',internalNotes:'SECRET',cost:'50000',image:'https://images.example.test/loader.jpg'}]});
  const record=service.save(sales,input).record;assert.equal(record.machines[0].internalNotes,undefined);assert.equal(record.machines[0].cost,undefined);assert.equal(record.assignedTo,'sam-user');assert.deepEqual(service.save(sales,input).record,record);
  assert.throws(()=>service.save(sales,command('packages',{...input.record,machines:[{key:'passport:OTHER',title:'Other'}]})),e=>e.code==='SALES_PACKAGE_MACHINE');assert.throws(()=>service.getRecord(viewer,'packages',record.id),e=>e.statusCode===404);
});

test('complete signed gateway admits company discovery and invitation acceptance before selection only',async()=>{
  process.env.IXI_MOS_INTERNAL_AUTH_ENFORCE='true';process.env.IXI_MOS_INTERNAL_SECRET=crypto.randomUUID();
  const express=require('express'),{createInternalAuthMiddleware,buildCanonicalRequest}=require('../mos/security/internalRequestAuthService'),{createInternalTenantBoundaryMiddleware}=require('../mos/security/internalTenantBoundaryService'),{createMosMembershipAuthorityMiddleware}=require('../mos/security/mosMembershipAuthorityService');
  const app=express();app.use(express.json());const router=express.Router();router.use(createInternalAuthMiddleware(),createInternalTenantBoundaryMiddleware(),createMosMembershipAuthorityMiddleware());router.use('/sales-desk',require('./IXISalesDeskRoutes'));app.use('/mos/v1',router);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const request=async(method,suffix,{principalId='owner-v2',entity='',body,valid=true}={})=>{
    const targetPath='/mos/v1/sales-desk'+suffix,timestamp=String(Date.now()),requestId=crypto.randomUUID(),bodyString=body ? JSON.stringify(body) : '';
    const signature=crypto.createHmac('sha256',process.env.IXI_MOS_INTERNAL_SECRET).update(buildCanonicalRequest({timestamp,requestId,method,targetPath,principalId,entityId:entity,bodyString})).digest('hex');
    return fetch(`http://127.0.0.1:${server.address().port}${targetPath}`,{method,headers:{'Content-Type':'application/json','X-IXI-Internal-Signature-Version':'v1','X-IXI-Internal-Timestamp':timestamp,'X-IXI-Internal-Request-Id':requestId,'X-IXI-Internal-Principal-Id':principalId,'X-IXI-Internal-Entity-Id':entity,'X-IXI-Internal-Signature':valid ? signature : 'invalid'},...(body ? {body:bodyString} : {})});
  };
  try{
    const response=await request('GET','/companies');assert.equal(response.status,200);assert.equal((await response.json()).companies[0].entityId,entityId);
    assert.equal((await request('GET','/companies',{valid:false})).status,401);
    assert.equal((await request('GET','/records/contacts')).status,401);
    assert.equal((await request('POST','/commands',{body:{}})).status,401);
    assert.equal((await request('GET','/invitations/accept')).status,401);
    assert.equal((await request('GET','/bootstrap',{entity:entityId})).status,200);
    const invitedPerson=person('Gateway user'),inv=invite(invitedPerson,'gateway@example.test');
    const accepted=await request('POST','/invitations/accept',{principalId:'gateway-user',body:{entityId,id:inv.id,token:inv.token,email:'gateway@example.test',verifiedEmail:true}});assert.equal(accepted.status,200);assert.equal(access.authorize(context('gateway-user')).canFinancial,false);
  }finally{await new Promise(resolve=>server.close(resolve));delete process.env.IXI_MOS_INTERNAL_AUTH_ENFORCE;delete process.env.IXI_MOS_INTERNAL_SECRET;}
});
