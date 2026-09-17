"use strict";
const repo=require("./IXISalesDeskRepository");
const schedule=require("./IXISalesDeskSchedule");
const {MosError}=require("../mos/errors/MosError");
const fail=(message,status=400)=>{throw new MosError("SALES_WORK_INVALID",message,null,status);};
const open=`((r.kind='tasks' AND coalesce(json_extract(r.payload,'$.canceled'),0)=0 AND coalesce(json_extract(r.payload,'$.completed'),0)=0) OR (r.kind='deals' AND coalesce(json_extract(r.payload,'$.stage'),'') NOT IN ('lost','archived')))`;
const appointmentOpen=`${open} AND coalesce(json_extract(r.payload,'$.canceled'),0)=0 AND (r.kind<>'deals' OR coalesce(json_extract(r.payload,'$.actionCompleted'),0)=0)`;
function scope(actor,value="mine") {
  if(!["mine","team"].includes(value))fail("Choose My calendar or Team calendar.");
  if(value==="team" && !actor.canReadAll)fail("Your seat is limited to assigned work.",403);
  const access=repo.visibility(actor);
  return {sql:`r.entity_id=? AND r.kind IN ('deals','tasks') AND ${access.sql}${value==="mine" ? " AND json_extract(r.payload,'$.assignedTo')=?" : ""}`,args:[actor.entityId,...access.args,...(value==="mine" ? [actor.actorId] : [])]};
}
function page(query) { return {offset:Math.min(1000000,Math.max(0,parseInt(query.offset,10)||0)),limit:Math.min(200,Math.max(1,parseInt(query.limit,10)||100))}; }
function read(where,args,query,timeZone) {
  const db=repo.database(),{offset,limit}=page(query);
  const total=db.prepare(`SELECT count(*) AS n FROM sales_desk_records r WHERE ${where}`).get(...args).n;
  const items=db.prepare(`SELECT kind,payload FROM sales_desk_records r WHERE ${where} ORDER BY coalesce(nullif(json_extract(r.payload,'$.startAt'),''),nullif(json_extract(r.payload,'$.dueDate'),''),'9999'),r.updated_at,r.id LIMIT ? OFFSET ?`).all(...args,limit,offset).map(row=>schedule.event(row.kind,JSON.parse(row.payload),timeZone));
  return {items,total,offset,limit};
}
function calendar(actor,query={}) {
  const from=schedule.day(query.from,true),to=schedule.day(query.to,true),timeZone=schedule.zone(query.zone),s=scope(actor,query.scope);
  if(to<from || to>schedule.addDays(from,366))fail("Choose a calendar range of up to one year.");
  const start=schedule.wallInstant(from,"00:00",timeZone),end=schedule.wallInstant(schedule.addDays(to,1),"00:00",timeZone);
  const where=`${s.sql} AND ${query.includeCompleted==="true" ? "1=1" : appointmentOpen} AND ((json_extract(r.payload,'$.startAt') IS NOT NULL AND json_extract(r.payload,'$.startAt')<? AND json_extract(r.payload,'$.endAt')>?) OR (json_extract(r.payload,'$.startAt') IS NULL AND json_extract(r.payload,'$.dueDate') BETWEEN ? AND ?))`;
  return {...read(where,[...s.args,end,start,from,to],query,timeZone),from,to,timeZone};
}
function work(actor,query={}) {
  const timeZone=schedule.zone(query.zone),today=schedule.day(query.today || schedule.parts(Date.now(),timeZone).date,true),s=scope(actor,query.scope);
  const dayStart=schedule.wallInstant(today,"00:00",timeZone),tomorrow=schedule.wallInstant(schedule.addDays(today,1),"00:00",timeZone),weekEnd=schedule.wallInstant(schedule.addDays(today,8),"00:00",timeZone);
  const due="json_extract(r.payload,'$.dueDate')",start="json_extract(r.payload,'$.startAt')",hasAction="(coalesce(json_extract(r.payload,'$.canceled'),0)=0 AND (r.kind='tasks' OR coalesce(json_extract(r.payload,'$.actionCompleted'),0)=0))";
  const filters={
    today:{sql:`${hasAction} AND ((${start} IS NOT NULL AND ${start}>=? AND ${start}<?) OR (${start} IS NULL AND ${due}=?))`,args:[dayStart,tomorrow,today]},
    overdue:{sql:`${hasAction} AND ((${start} IS NOT NULL AND ${start}<?) OR (${start} IS NULL AND ${due}<>'' AND ${due}<?))`,args:[dayStart,today]},
    upcoming:{sql:`${hasAction} AND ((${start} IS NOT NULL AND ${start}>=? AND ${start}<?) OR (${start} IS NULL AND ${due}>? AND ${due}<=?))`,args:[tomorrow,weekEnd,today,schedule.addDays(today,7)]},
    unassigned:{sql:"coalesce(json_extract(r.payload,'$.assignedTo'),'')=''",args:[]},
    new:{sql:"r.kind='deals' AND json_extract(r.payload,'$.stage')='inquiry'",args:[]},
    waiting:{sql:"r.kind='deals' AND json_extract(r.payload,'$.waitingOn')='customer'",args:[]},
    approval:{sql:"r.kind='deals' AND json_extract(r.payload,'$.waitingOn')='approval'",args:[]},
    quiet:{sql:"r.kind='deals' AND r.updated_at<?",args:[`${schedule.addDays(today,-7)}T00:00:00.000Z`]},
    reminders:{sql:`${hasAction} AND json_extract(r.payload,'$.reminderAt')<=? AND json_extract(r.payload,'$.reminderAt')>=?`,args:[new Date().toISOString(),dayStart]},
    all:{sql:"1=1",args:[]}
  };
  const selected=filters[query.bucket || "today"];if(!selected)fail("Choose a supported work queue.");
  const db=repo.database(),where=`${s.sql} AND ${open}`;
  const counts=Object.fromEntries(Object.entries(filters).map(([key,f])=>[key,db.prepare(`SELECT count(*) AS n FROM sales_desk_records r WHERE ${where} AND ${f.sql}`).get(...s.args,...f.args).n]));
  return {...read(`${where} AND ${selected.sql}`,[...s.args,...selected.args],query,timeZone),counts,today,timeZone,generatedAt:new Date().toISOString()};
}
function conflicts(actor,kind,record) {
  if(!record.startAt || !record.assignedTo || record.completed || record.actionCompleted || record.canceled || ['lost','archived'].includes(record.stage))return [];
  const rows=repo.database().prepare(`SELECT r.kind,r.id,r.payload FROM sales_desk_records r WHERE r.entity_id=? AND r.kind IN ('tasks','deals') AND ${appointmentOpen} AND json_extract(r.payload,'$.assignedTo')=? AND NOT(r.kind=? AND r.id=?) AND json_extract(r.payload,'$.startAt')<? AND json_extract(r.payload,'$.endAt')>? ORDER BY json_extract(r.payload,'$.startAt') LIMIT 20`).all(actor.entityId,record.assignedTo,kind,record.id || "",record.endAt,record.startAt);
  return rows.map(r=>repo.visible(actor,r.kind,r.id) ? {kind:r.kind,id:r.id,title:schedule.event(r.kind,JSON.parse(r.payload)).title,startAt:JSON.parse(r.payload).startAt} : {title:"Another scheduled commitment",startAt:JSON.parse(r.payload).startAt});
}
function preview(actor,input) {
  if(!actor.canWrite)fail("Your seat is read-only.",403);
  const service=require("./IXISalesDeskService"),kind=input.kind;
  if(!["tasks","deals"].includes(kind))fail("Choose a follow-up or deal action.");
  const value=input.record || {},old=value.id ? service.getRecord(actor,kind,value.id) : {};
  const assignedTo=service.assignee(actor,value,old),normalized={...old,...schedule.normalize(value,old),id:old.id,assignedTo,completed:value.completed ?? old.completed,actionCompleted:value.actionCompleted ?? old.actionCompleted,canceled:value.canceled ?? old.canceled};
  return {schedule:normalized,conflicts:conflicts(actor,kind,normalized)};
}
module.exports={calendar,work,conflicts,preview};
