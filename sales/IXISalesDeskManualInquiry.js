"use strict";
const crypto=require("node:crypto");
const repo=require("./IXISalesDeskRepository"),service=require("./IXISalesDeskService"),schedule=require("./IXISalesDeskSchedule");
const {MosError}=require("../mos/errors/MosError");
const SOURCES=["Phone call","Text message","Email","Walk-in","Referral","Outside website","Other"];
const hash=value=>crypto.createHash("sha256").update(value).digest("hex");
const fail=(code,message,status=400)=>{throw new MosError(code,message,null,status);};

function capture(actor,input) {
  if(!actor.canWrite)fail("SALES_WRITE_DENIED","Your seat is read-only.",403);
  if(!input || typeof input!=="object" || Array.isArray(input))fail("SALES_INPUT_INVALID","An inquiry is required.");
  const commandId=service.text(input.commandId,100,true);
  if(!/^[a-zA-Z0-9_-]{8,100}$/.test(commandId))fail("SALES_COMMAND_REQUIRED","A valid save identifier is required.");
  const key=hash(`${actor.entityId}:${actor.actorId}:${commandId}`).slice(0,48);
  const command={...actor,commandId:`manual-inquiry-${key}`,input:{...input,kind:"inquiries"}};
  const result=record=>({record,contact:service.getRecord(actor,"contacts",record.contactId),deal:service.getRecord(actor,"deals",record.dealId)});
  const previous=repo.replayCommand(command);
  if(previous)return result(service.getRecord(actor,"inquiries",previous.record.id));

  // Validate the complete request before explicit canonical customer admission.
  const source=service.text(input.source,100,true),sourceDetail=service.text(input.sourceDetail,150);
  if(!SOURCES.includes(source))fail("SALES_INQUIRY_SOURCE","Choose how this inquiry reached you.");
  const title=service.text(input.title,150,true),message=service.text(input.message,10000);
  const receivedAt=service.text(input.receivedAt,40,true);
  if(!Number.isFinite(Date.parse(receivedAt)))fail("SALES_INQUIRY_DATE","Choose when the inquiry was received.");
  if(!Array.isArray(input.machines) || input.machines.length>100)fail("SALES_MACHINE_LIMIT","Choose up to 100 machines.");
  const machines=input.machines.map(m=>({key:service.text(m?.key,180,true),passportId:service.text(m?.passportId,60),listingId:service.text(m?.listingId,100),title:service.text(m?.title,200,true)}));
  if(new Set(machines.map(m=>m.key)).size!==machines.length)fail("SALES_DUPLICATE_MACHINE","Choose each machine once.");
  const assignedTo=service.assignee(actor,input);
  const scheduled=input.schedule!=null;
  if(scheduled && (typeof input.schedule!=="object" || Array.isArray(input.schedule)))fail("SALES_INPUT_INVALID","Choose a valid follow-up.");
  const nextAction=scheduled ? service.text(input.schedule.nextAction,500,true) : "";
  const timing=schedule.normalize(scheduled ? input.schedule : {dueDate:"",allDay:true});
  if(scheduled && !timing.dueDate)fail("SALES_INQUIRY_DATE","Choose a follow-up date.");
  const contactId=service.text(input.contactId,100);
  let contact=contactId ? service.getRecord(actor,"contacts",contactId) : null;
  if(!contact) {
    const buyer={name:service.text(input.contact?.name,150,true),email:service.text(input.contact?.email,254).toLowerCase(),phone:service.text(input.contact?.phone,60),company:service.text(input.contact?.company,150)};
    if(buyer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email))fail("SALES_EMAIL_INVALID","Enter a valid email address.");
    const contactCommand={kind:"contacts",commandId:`manual-contact-${key}`,record:{...buyer,source,assignedTo},inquiryInput:input};
    const admitted=repo.replayCommand({...actor,commandId:contactCommand.commandId,input:contactCommand});
    if(admitted)contact=service.getRecord(actor,"contacts",admitted.record.id);
    else {
      const phone=buyer.phone.replace(/\D/g,"");
      const matches=repo.database().prepare("SELECT payload FROM sales_desk_records WHERE entity_id=? AND kind='contacts'").all(actor.entityId).map(r=>JSON.parse(r.payload)).filter(c=>(buyer.email && c.email===buyer.email) || (phone.length>=7 && String(c.phone || "").replace(/\D/g,"")===phone));
      if(matches.length>1)fail("SALES_INQUIRY_MATCH_REVIEW","Email and phone match different customers. Choose the correct saved contact.",409);
      contact=matches.length ? service.getRecord(actor,"contacts",matches[0].id) : service.save(actor,contactCommand).record;
    }
  }
  // Identity admission is recoverable independently. The deal, its calendar
  // action and original inquiry commit together, or none of them do.
  return repo.database().transaction(()=>{
    const saved=repo.command(command,()=>{
      const deal=service.save(actor,{kind:"deals",commandId:`manual-deal-${key}`,record:{title,contactId:contact.id,machines,stage:"inquiry",assignedTo,nextAction,...timing}}).record;
      return {kind:"inquiries",record:{id:`inquiry-${key}`,sourceId:`manual:${key}`,source,sourceDetail,receivedAt:new Date(receivedAt).toISOString(),title,message,buyer:{name:contact.name,email:contact.email,phone:contact.phone,company:contact.company},machines,contactId:contact.id,dealId:deal.id,assignedTo}};
    });
    return result(saved.record);
  }).immediate();
}
module.exports={capture,SOURCES};
