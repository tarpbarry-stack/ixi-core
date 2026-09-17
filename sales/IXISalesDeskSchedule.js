"use strict";
const { MosError } = require("../mos/errors/MosError");
const TYPES = ["follow-up","call","appointment","inspection","demonstration","pickup","delivery"];
const fail = (message) => { throw new MosError("SALES_SCHEDULE_INVALID",message,null,400); };
const formatters = new Map();
function zone(value="UTC") {
  const name=String(value || "UTC");
  if(name.length>80)fail("Choose a valid time zone.");
  try { new Intl.DateTimeFormat("en-US",{timeZone:name}).format(); } catch { fail("Choose a valid time zone."); }
  return name;
}
function parts(instant,timeZone) {
  let f=formatters.get(timeZone);
  if(!f){f=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});if(formatters.size>100)formatters.clear();formatters.set(timeZone,f);}
  const p=Object.fromEntries(f.formatToParts(new Date(instant)).map(p=>[p.type,p.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
}
function day(value,required=false) {
  const s=String(value || ""),d=new Date(`${s}T12:00:00Z`);
  if(!s && !required)return "";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(d.getTime()) || d.toISOString().slice(0,10)!==s)fail("Choose a valid calendar date.");
  return s;
}
function addDays(value,count) { const d=new Date(`${day(value,true)}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10); }
function wallInstant(date,time,timeZone,disambiguation="earlier") {
  day(date,true);zone(timeZone);
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))fail("Choose a valid start time.");
  const naive=Date.parse(`${date}T${time}:00Z`),offsets=new Set();
  for(const hours of [-36,-12,0,12,36]){const sample=naive+hours*3600000,p=parts(sample,timeZone);offsets.add(Date.parse(`${p.date}T${p.time}:00Z`)-sample);}
  const candidates=[...offsets].map(offset=>naive-offset).filter(n=>{const p=parts(n,timeZone);return p.date===date && p.time===time;}).sort((a,b)=>a-b);
  if(!candidates.length)fail("That local time does not exist because the clocks change. Choose another time.");
  return new Date(disambiguation==="later" ? candidates.at(-1) : candidates[0]).toISOString();
}
function normalize(value,old={}) {
  const get=(key,fallback)=>value[key]===undefined ? old[key] ?? fallback : value[key];
  const dueDate=day(get("dueDate","")),timeZone=zone(get("timeZone","UTC")),allDay=get("allDay",true)!==false;
  const activityType=String(get("activityType","follow-up"));
  if(!TYPES.includes(activityType))fail("Choose a supported appointment type.");
  const startTime=allDay ? "" : String(get("startTime","09:00")),durationMinutes=Number(get("durationMinutes",30));
  const disambiguation=get("disambiguation","earlier");
  if(!["earlier","later"].includes(disambiguation))fail("Choose which occurrence to use when clocks move back.");
  if(!Number.isInteger(durationMinutes) || durationMinutes<5 || durationMinutes>1440)fail("Choose a duration between 5 minutes and 24 hours.");
  const reminderMinutes=Number(get("reminderMinutes",15));
  if(![-1,0,5,15,30,60,1440].includes(reminderMinutes))fail("Choose a supported reminder.");
  const location=String(get("location","")),details=String(get("details",""));
  if(location.length>500 || details.length>3000)fail("The location or appointment details are too long.");
  if(!allDay && !dueDate)fail("A timed appointment needs a date.");
  const startAt=dueDate && !allDay ? wallInstant(dueDate,startTime,timeZone,disambiguation) : null;
  const endAt=startAt ? new Date(Date.parse(startAt)+durationMinutes*60000).toISOString() : null;
  const reminderAt=dueDate && reminderMinutes>=0 ? new Date(Date.parse(startAt || wallInstant(dueDate,"09:00",timeZone))-reminderMinutes*60000).toISOString() : null;
  return {dueDate,timeZone,allDay,startTime,durationMinutes,disambiguation,activityType,reminderMinutes,reminderAt,startAt,endAt,location,details};
}
function event(kind,record,timeZone="UTC") {
  const timed=!!record.startAt && record.allDay===false;
  const local=timed ? parts(record.startAt,timeZone) : {date:record.dueDate || "",time:""};
  return {key:`${kind}:${record.id}`,kind,id:record.id,revision:record.revision,title:kind==="deals" ? record.nextAction || record.title : record.title,dealTitle:kind==="deals" ? record.title : "",contactId:record.contactId,customerName:record.customerName || "",dealId:kind==="deals" ? record.id : record.dealId || "",assignedTo:record.assignedTo || "",date:local.date,time:local.time,allDay:!timed,startAt:record.startAt || null,endAt:record.endAt || null,timeZone:record.timeZone || "UTC",activityType:record.activityType || "follow-up",completed:kind==="deals" ? record.actionCompleted===true : record.completed===true,canceled:record.canceled===true || (kind==="deals" && ["lost","archived"].includes(record.stage)),reminderAt:record.reminderAt || null,location:record.location || "",record};
}
module.exports={TYPES,zone,parts,day,addDays,wallInstant,normalize,event};
