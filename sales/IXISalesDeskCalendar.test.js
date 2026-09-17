'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'sales-calendar-'));
process.env.IXI_MOS_STORAGE_PROVIDER='sqlite';process.env.IXI_MOS_DATA_ROOT=path.join(root,'mos');process.env.IXI_PASSPORT_DATA_FILE=path.join(root,'passports.json');
const {ensureAosAccount,bindOwnerMembershipIdentity}=require('../mos/accounts/aosAccountService'),{provisionAosObject}=require('../mos/provisioning/aosObjectProvisioningService'),{listObjects}=require('../mos/objects/objectService');
const access=require('./IXISalesDeskAccess'),service=require('./IXISalesDeskService'),repo=require('./IXISalesDeskRepository'),work=require('./IXISalesDeskWork'),schedule=require('./IXISalesDeskSchedule'),intake=require('./IXISalesDeskIntake');
const account=ensureAosAccount({ownerUserId:'calendar-owner',displayName:'Calendar Company'}),entityId=account.entity.entityId;
const person=name=>provisionAosObject({commandId:crypto.randomUUID(),entityId,objectType:'person',displayName:name,actorId:'calendar-owner'}).identity;
const identity=person('Owner');bindOwnerMembershipIdentity({accountId:account.account.accountId,ownerUserId:'calendar-owner',personObjectId:identity.objectId,personPassportId:identity.passportId});
const context=principalId=>({authenticated:true,principalId,entityId}),owner=access.authorize(context('calendar-owner'));
const member=person('Salesperson'),inv=access.invitation(owner,{personObjectId:member.objectId,email:'rep@example.test',role:'sales',scope:'assigned'});
access.acceptInvitation(context('calendar-rep'),{entityId,id:inv.id,token:inv.token,email:'rep@example.test',verifiedEmail:true});const rep=access.authorize(context('calendar-rep'));
const cmd=(kind,record,revision)=>({kind,record,revision,commandId:crypto.randomUUID()});
const contact=service.save(owner,cmd('contacts',{name:'Calendar Buyer',email:'buyer@example.test'})).record;
let deal=service.save(owner,cmd('deals',{title:'Loader opportunity',contactId:contact.id,stage:'qualified',nextAction:'Call the buyer',dueDate:'2026-09-18',machines:[{key:'passport:TEST-MACHINE',passportId:'TEST-MACHINE',listingId:'test-listing',title:'Loader'}]})).record;
const timed={dueDate:'2026-09-18',allDay:false,startTime:'10:00',timeZone:'America/Chicago',durationMinutes:60,reminderMinutes:15,activityType:'inspection'};
let task;
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('calendar reads the original records; rescheduling and completion do not create shadow commitments or identities',()=>{
  const before=listObjects({entityId}).length;
  task=service.save(owner,cmd('tasks',{title:'Inspect loader',dealId:deal.id,...timed})).record;
  assert.equal(task.startAt,'2026-09-18T15:00:00.000Z');assert.equal(task.endAt,'2026-09-18T16:00:00.000Z');assert.equal(task.reminderAt,'2026-09-18T14:45:00.000Z');
  const query={from:'2026-09-18',to:'2026-09-18',zone:'America/Chicago',scope:'team'};
  const calendar=work.calendar(owner,query);assert.equal(calendar.total,2);assert.equal(calendar.items.find(e=>e.id===task.id).time,'10:00');
  const original=task;task=service.save(owner,cmd('tasks',{...task,dueDate:'2026-09-19'},task.revision)).record;
  assert.equal(work.calendar(owner,query).total,1);assert.equal(work.calendar(owner,{...query,from:'2026-09-19',to:'2026-09-19'}).items[0].id,task.id);
  assert.throws(()=>service.save(owner,cmd('tasks',{...original,title:'Stale edit'},original.revision)),e=>e.code==='SALES_REVISION_CONFLICT');
  task=service.save(owner,cmd('tasks',{...task,completed:true,outcome:'Inspection approved'},task.revision)).record;
  assert.equal(work.calendar(owner,{...query,from:'2026-09-19',to:'2026-09-19'}).total,0);
  assert.equal(work.calendar(owner,{...query,from:'2026-09-19',to:'2026-09-19',includeCompleted:'true'}).items[0].record.outcome,'Inspection approved');
  assert.equal(repo.list(entityId,'tasks').total,1);assert.equal(listObjects({entityId}).length,before);
});
test('DST gaps, repeated times, date validation, half-hour zones and midnight-spanning appointments are explicit',()=>{
  assert.throws(()=>schedule.normalize({...timed,dueDate:'2026-03-08',startTime:'02:30'}),e=>e.code==='SALES_SCHEDULE_INVALID');
  const a=schedule.normalize({...timed,dueDate:'2026-11-01',startTime:'01:30',disambiguation:'earlier'}),b=schedule.normalize({...timed,dueDate:'2026-11-01',startTime:'01:30',disambiguation:'later'});
  assert.equal(Date.parse(b.startAt)-Date.parse(a.startAt),3600000);
  assert.equal(schedule.normalize({...timed,timeZone:'Asia/Kolkata'}).startAt,'2026-09-18T04:30:00.000Z');
  for(const fields of [{timeZone:'Invented/Zone'},{dueDate:'2026-02-30'},{durationMinutes:0},{durationMinutes:1441},{startTime:'25:30'}])assert.throws(()=>schedule.normalize({...timed,...fields}));
  const overnight=service.save(owner,cmd('tasks',{title:'Overnight delivery',...timed,startTime:'23:30',durationMinutes:120})).record;
  assert.ok(work.calendar(owner,{from:'2026-09-19',to:'2026-09-19',zone:'America/Chicago',scope:'mine'}).items.some(e=>e.id===overnight.id));
});
test('conflict checks use real UTC overlap, warn only about the assigned person, and preserve boundary adjacency',()=>{
  const one=service.save(owner,cmd('tasks',{title:'Existing appointment',...timed,assignedTo:'calendar-rep'})).record;
  const two=work.preview(owner,{kind:'tasks',record:{title:'Overlapping',...timed,startTime:'10:30',assignedTo:'calendar-rep'}});
  assert.equal(two.conflicts.length,1);assert.equal(two.conflicts[0].id,one.id);
  assert.equal(work.preview(owner,{kind:'tasks',record:{...timed,startTime:'11:00',assignedTo:'calendar-rep'}}).conflicts.length,0);
  assert.equal(work.preview(owner,{kind:'tasks',record:{...timed,startTime:'10:30'}}).conflicts.length,0);
});
test('team calendars, queues, direct records and inquiry originals respect the current assignment',()=>{
  assert.throws(()=>work.calendar(rep,{from:'2026-09-01',to:'2026-09-30',scope:'team'}),e=>e.statusCode===403);
  assert.throws(()=>work.work(rep,{scope:'team'}),e=>e.statusCode===403);
  assert.ok(work.calendar(rep,{from:'2026-09-01',to:'2026-09-30',scope:'mine'}).items.every(e=>e.assignedTo===rep.actorId));
  assert.throws(()=>work.preview(rep,{kind:'tasks',record:{id:task.id,...timed}}),e=>e.statusCode===404);
  assert.throws(()=>work.preview({...rep,canWrite:false},{kind:'tasks',record:timed}),e=>e.statusCode===403);
  assert.throws(()=>work.preview(rep,{kind:'invoices',record:timed}));
});
test('completing a deal action removes that commitment while preserving the opportunity and its financial references',()=>{
  deal=service.save(owner,cmd('deals',{...deal,actionCompleted:true,actionOutcome:'Buyer requested a quote',financialDocumentIds:['existing-quote']},deal.revision)).record;
  assert.equal(work.calendar(owner,{from:'2026-09-18',to:'2026-09-18',scope:'team'}).items.some(e=>e.id===deal.id),false);
  assert.ok(work.work(owner,{today:'2026-09-18',scope:'team',bucket:'all'}).items.some(e=>e.id===deal.id));
  assert.deepEqual(service.getRecord(owner,'deals',deal.id).financialDocumentIds,['existing-quote']);assert.equal(deal.stage,'qualified');
  deal=service.save(owner,cmd('deals',{...deal,actionCompleted:false,canceled:true},deal.revision)).record;
  assert.ok(work.work(owner,{today:'2026-09-18',scope:'team',bucket:'all'}).items.some(e=>e.id===deal.id));
});
const source=(id='source-inquiry-one')=>({sourceId:id,customerSourceId:'marketplace-buyer',providerUserId:owner.ownerUserId,receivedAt:'2026-09-17T12:00:00.000Z',buyer:{name:'Intake Buyer',email:'intake@example.test',phone:'555-111-2222'},machine:{key:'listing:inquiry-listing',listingId:'inquiry-listing',title:'Dozer'},message:'Can I inspect this machine Friday?'});
let intakeDeal;
test('inquiry sync connects the source once, reuses buyer and active opportunity, and preserves original messages',()=>{
  const before=listObjects({entityId}).length,first=intake.capture(owner,{rows:[source()]}).results[0];assert.equal(first.status,'saved');intakeDeal=service.getRecord(owner,'deals',first.dealId);assert.equal(intakeDeal.assignedTo,'');
  assert.equal(intake.capture(owner,{rows:[source()]}).results[0].status,'existing');
  const repeated=intake.capture(owner,{rows:[{...source('source-repeat'),message:'Please call me instead.'}]}).results[0];assert.equal(repeated.dealId,first.dealId);assert.equal(listObjects({entityId}).length,before+1);
  assert.equal(service.related(owner,'deals',first.dealId).inquiries.total,2);
  assert.equal(service.getRecord(owner,'inquiries',first.id).message,source().message);
  assert.throws(()=>service.save(owner,cmd('inquiries',{id:first.id,message:'Overwrite'})),e=>e.code==='SALES_INQUIRY_IMMUTABLE');
  assert.equal(work.work(owner,{scope:'team',bucket:'unassigned'}).counts.unassigned,1);
  assert.equal(service.listRecords(rep,'inquiries',{}).total,0);
  intakeDeal=service.save(owner,cmd('deals',{...intakeDeal,assignedTo:rep.actorId},intakeDeal.revision)).record;
  assert.equal(service.listRecords(rep,'inquiries',{}).total,2);
  assert.equal(intake.capture(owner,{rows:[{...source('foreign'),providerUserId:'another-owner'}]}).results[0].code,'SALES_INQUIRY_OWNER');
  assert.throws(()=>intake.capture(rep,{rows:[source()]}),e=>e.statusCode===403);
});
test('interrupted intake recovers its customer and rolls back an uncommitted opportunity before retry',()=>{
  const row={...source('interrupted'),customerSourceId:'second-buyer',buyer:{name:'Another customer',email:'another@example.test'}};
  const original=repo.command;let failed=false;
  repo.command=(input,prepare)=>{if(input.input.sourceId===row.sourceId && !failed){failed=true;throw new Error('Simulated interrupted source commit');}return original(input,prepare);};
  let result;try{result=intake.capture(owner,{rows:[row]});}finally{repo.command=original;}
  assert.equal(result.results[0].status,'error');
  const before=listObjects({entityId}).length,retry=intake.capture(owner,{rows:[row]}).results[0];assert.equal(retry.status,'saved');assert.equal(listObjects({entityId}).length,before);
  assert.equal(service.listRecords(owner,'deals',{contactId:retry.contactId}).total,1);
});
test('calendar pagination is explicit and does not omit records at a date boundary',()=>{
  const query={from:'2026-09-01',to:'2026-09-30',scope:'team',zone:'America/Chicago',limit:1};
  const first=work.calendar(owner,query),ids=[];for(let offset=0;offset<first.total;offset++)ids.push(...work.calendar(owner,{...query,offset}).items.map(e=>e.key));
  assert.equal(new Set(ids).size,first.total);assert.throws(()=>work.calendar(owner,{...query,to:'2028-01-01'}));
});

test('signed HTTP requests preserve retry identity and reject simultaneous conflicting edits',async()=>{
  process.env.IXI_MOS_INTERNAL_AUTH_ENFORCE='true';process.env.IXI_MOS_INTERNAL_SECRET=crypto.randomUUID();
  const express=require('express'),{createInternalAuthMiddleware,buildCanonicalRequest}=require('../mos/security/internalRequestAuthService'),{createInternalTenantBoundaryMiddleware}=require('../mos/security/internalTenantBoundaryService'),{createMosMembershipAuthorityMiddleware}=require('../mos/security/mosMembershipAuthorityService');
  const app=express();app.use(express.json());const router=express.Router();router.use(createInternalAuthMiddleware(),createInternalTenantBoundaryMiddleware(),createMosMembershipAuthorityMiddleware());router.use('/sales-desk',require('./IXISalesDeskRoutes'));app.use('/mos/v1',router);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const request=async(method,suffix,{body,principalId=owner.actorId}={})=>{
    const targetPath='/mos/v1/sales-desk'+suffix,timestamp=String(Date.now()),requestId=crypto.randomUUID(),bodyString=body ? JSON.stringify(body) : '';
    const signature=crypto.createHmac('sha256',process.env.IXI_MOS_INTERNAL_SECRET).update(buildCanonicalRequest({timestamp,requestId,method,targetPath,principalId,entityId,bodyString})).digest('hex');
    return fetch(`http://127.0.0.1:${server.address().port}${targetPath}`,{method,headers:{'Content-Type':'application/json','X-IXI-Internal-Signature-Version':'v1','X-IXI-Internal-Timestamp':timestamp,'X-IXI-Internal-Request-Id':requestId,'X-IXI-Internal-Principal-Id':principalId,'X-IXI-Internal-Entity-Id':entityId,'X-IXI-Internal-Signature':signature},...(body ? {body:bodyString} : {})});
  };
  try{
    const body=cmd('tasks',{title:'Retry-safe appointment',...timed}),responses=await Promise.all(Array.from({length:12},()=>request('POST','/commands',{body}))),saved=await Promise.all(responses.map(r=>r.json()));
    assert.ok(responses.every(r=>r.status===200));assert.equal(new Set(saved.map(r=>r.record.id)).size,1);
    const record=saved[0].record;
    const edits=await Promise.all(Array.from({length:12},(_,i)=>request('POST','/commands',{body:cmd('tasks',{...record,title:`Concurrent edit ${i}`},record.revision)})));
    assert.equal(edits.filter(r=>r.status===200).length,1);assert.equal(edits.filter(r=>r.status===409).length,11);
    assert.equal((await request('GET','/calendar?from=2026-09-01&to=2026-09-30&scope=team',{principalId:rep.actorId})).status,403);
    // A synthetic company schedule stays entirely in this temporary test DB.
    const insert=repo.database().prepare('INSERT INTO sales_desk_records VALUES(?,?,?,?,?,?,?)');
    repo.database().transaction(()=>{for(let i=0;i<10000;i++){const r={id:`load-${i}`,title:`Appointment ${i}`,dueDate:`2027-01-${String(i%28+1).padStart(2,'0')}`,allDay:true,assignedTo:owner.actorId,revision:1,updatedAt:'2026-09-17T00:00:00.000Z'};insert.run(entityId,'tasks',r.id,1,JSON.stringify(r),r.title,r.updatedAt);}})();
    const timings=[];let cursor=0;
    const run=async()=>{while(cursor++<100){const start=performance.now(),response=await request('GET','/calendar?from=2027-01-01&to=2027-01-31&scope=team&limit=100');const result=await response.json();assert.equal(response.status,200);assert.equal(result.total,10000);assert.equal(result.items.length,100);timings.push(performance.now()-start);}};
    const start=performance.now();await Promise.all(Array.from({length:10},run));timings.sort((a,b)=>a-b);
    const metrics={fixtureRecords:10000,httpReads:timings.length,concurrency:10,p50Ms:Math.round(timings[49]),p95Ms:Math.round(timings[94]),maxMs:Math.round(timings.at(-1)),elapsedMs:Math.round(performance.now()-start),errors:0};
    console.log('SALES_CALENDAR_LOCAL_LOAD '+JSON.stringify(metrics));
  }finally{await new Promise(resolve=>server.close(resolve));delete process.env.IXI_MOS_INTERNAL_AUTH_ENFORCE;delete process.env.IXI_MOS_INTERNAL_SECRET;}
});
