"use strict";
const crypto=require("node:crypto");
const repo=require("./IXISalesDeskRepository"),service=require("./IXISalesDeskService");
const {requireOwner}=require("./IXISalesDeskAccess");
const {MosError}=require("../mos/errors/MosError");
const hash=value=>crypto.createHash("sha256").update(value).digest("hex");
function captureOne(actor,input) {
  if(input.providerUserId!==actor.ownerUserId)throw new MosError("SALES_INQUIRY_OWNER","The inquiry does not belong to this company.",null,403);
  const sourceId=service.text(input.sourceId,100,true),customerSourceId=service.text(input.customerSourceId,100,true);
  const id=`inquiry-${hash(sourceId).slice(0,40)}`,existing=repo.get(actor.entityId,"inquiries",id);
  if(existing)return {status:"existing",id,dealId:existing.dealId};
  const buyer={name:service.text(input.buyer?.name,150,true),email:service.text(input.buyer?.email,254).toLowerCase(),phone:service.text(input.buyer?.phone,60),company:service.text(input.buyer?.company,150)};
  const message=service.text(input.message,10000),receivedAt=service.text(input.receivedAt,40,true),machine=input.machine || {};
  if(!Number.isFinite(Date.parse(receivedAt)))throw new MosError("SALES_INQUIRY_DATE","The source inquiry date is invalid.",null,400);
  const ref={key:service.text(machine.key,180,true),passportId:service.text(machine.passportId,60),listingId:service.text(machine.listingId,100,true),title:service.text(machine.title,200,true)};
  const db=repo.database(),binding=db.prepare("SELECT contact_id FROM sales_desk_source_customers WHERE entity_id=? AND source_id=?").get(actor.entityId,customerSourceId);
  let contact=binding ? service.getRecord(actor,"contacts",binding.contact_id) : null;
  if(!contact) {
    const phone=buyer.phone.replace(/\D/g,"");
    const matches=db.prepare("SELECT payload FROM sales_desk_records WHERE entity_id=? AND kind='contacts'").all(actor.entityId).map(r=>JSON.parse(r.payload)).filter(c=>(buyer.email && c.email===buyer.email) || (phone.length>=7 && String(c.phone || "").replace(/\D/g,"")===phone));
    if(matches.length>1)throw new MosError("SALES_INQUIRY_MATCH_REVIEW","Email and phone match different customers. Resolve the contact details before retrying this inquiry.",null,409);
    contact=matches[0] || service.save(actor,{kind:"contacts",commandId:`intake-contact-${hash(customerSourceId).slice(0,48)}`,record:{...buyer,source:"IronXchange inquiry",assignedTo:""}}).record;
    db.prepare("INSERT INTO sales_desk_source_customers VALUES(?,?,?) ON CONFLICT(entity_id,source_id) DO NOTHING").run(actor.entityId,customerSourceId,contact.id);
    const bound=db.prepare("SELECT contact_id FROM sales_desk_source_customers WHERE entity_id=? AND source_id=?").get(actor.entityId,customerSourceId);
    contact=service.getRecord(actor,"contacts",bound.contact_id);
  }
  // Canonical contact admission has its own recoverable command. The opportunity
  // and original source message are committed together in the durable sales DB.
  return db.transaction(()=>{
    const duplicate=repo.get(actor.entityId,"inquiries",id);if(duplicate)return {status:"existing",id,dealId:duplicate.dealId};
    const candidates=repo.list(actor.entityId,"deals",{contactId:contact.id,openOnly:true,limit:10000}).items.filter(d=>d.machines.some(m=>m.key===ref.key || m.listingId===ref.listingId));
    let deal=candidates.length===1 ? candidates[0] : null;
    if(!deal)deal=service.save(actor,{kind:"deals",commandId:`intake-deal-${hash(sourceId).slice(0,48)}`,record:{title:`${ref.title} · ${contact.name}`.slice(0,150),contactId:contact.id,machines:[ref],stage:"inquiry",assignedTo:"",nextAction:"Respond to buyer inquiry",dueDate:new Date().toISOString().slice(0,10),timeZone:"UTC"}}).record;
    repo.command({...actor,commandId:`source-${hash(sourceId).slice(0,48)}`,input:{sourceId}},()=>({kind:"inquiries",record:{id,sourceId,customerSourceId,providerUserId:actor.ownerUserId,source:"IronXchange marketplace",receivedAt,message,buyer,machine:ref,contactId:contact.id,dealId:deal.id,assignedTo:deal.assignedTo,title:`Inquiry · ${ref.title}`}}));
    return {status:"saved",id,dealId:deal.id,contactId:contact.id};
  }).immediate();
}
function capture(actor,input) {
  requireOwner(actor);
  if(!actor.canWrite)throw new MosError("SALES_WRITE_DENIED","Your seat is read-only.",null,403);
  if(!Array.isArray(input.rows) || input.rows.length>25)throw new MosError("SALES_INQUIRY_LIMIT","Sync up to 25 inquiries at a time.",null,400);
  return {results:input.rows.map(row=>{try{return {sourceId:row.sourceId,...captureOne(actor,row)};}catch(e){return {sourceId:String(row?.sourceId || ""),status:"error",code:e.code || "SALES_INQUIRY_FAILED",message:e.message};}})};
}
module.exports={capture};
