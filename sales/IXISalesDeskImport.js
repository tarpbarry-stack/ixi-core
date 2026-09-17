"use strict";
const crypto=require("node:crypto");
const service=require("./IXISalesDeskService");
const repo=require("./IXISalesDeskRepository");
const {requireOwner}=require("./IXISalesDeskAccess");
const {MosError}=require("../mos/errors/MosError");
const fields={name:150,company:150,email:254,phone:60,address:500,source:100,interest:1000,preference:40,category:40,budget:100,timeframe:150};
function normalize(row) {
  const value={};for(const [key,max] of Object.entries(fields))value[key]=service.text(row?.[key],max,key==="name");
  value.email=value.email.toLowerCase();
  if(value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))throw new Error("Enter a valid email address.");
  return value;
}
function matches(a,b){const phone=a.phone.replace(/\D/g,"");return (a.email && a.email===b.email) || (phone.length>=7 && phone===b.phone.replace(/\D/g,""));}
function preview(actor,input) {
  requireOwner(actor);
  if(!Array.isArray(input.rows) || input.rows.length>500)throw new MosError("SALES_IMPORT_LIMIT","Review up to 500 contacts at a time.",null,400);
  const existing=repo.database().prepare("SELECT payload FROM sales_desk_records WHERE entity_id=? AND kind='contacts'").all(actor.entityId).map(r=>JSON.parse(r.payload)),seen=[];
  return {rows:input.rows.map((row,index)=>{try{const value=normalize(row),match=existing.find(item=>matches(value,item)),duplicate=seen.find(item=>matches(value,item));seen.push(value);return {index,value,status:match ? "existing" : duplicate ? "duplicate" : "ready",existingId:match?.id || "",message:match ? `Already saved: ${match.name}` : duplicate ? "Duplicate within this file" : "Ready to create"};}catch(error){return {index,status:"invalid",message:error.message};}})};
}
function commit(actor,input) {
  requireOwner(actor);
  if(!actor.canWrite)throw new MosError("SALES_WRITE_DENIED","Contact imports are restricted.",null,403);
  if(!/^[a-zA-Z0-9_-]{8,80}$/.test(input.batchId || "") || !Array.isArray(input.rows) || input.rows.length>25)throw new MosError("SALES_IMPORT_INVALID","Import up to 25 reviewed rows per batch.",null,400);
  const results=input.rows.map(({index,value})=>{
    try {
      if(!Number.isInteger(index) || index<0 || index>=500)throw new Error("Invalid import row.");
      const record=normalize(value),commandId=`import-${input.batchId}-${index}`;
      const result=service.save(actor,{kind:"contacts",record,commandId});
      return {index,status:"saved",id:result.record.id,name:result.record.name};
    } catch(error){return {index,status:"error",code:error.code || "SALES_IMPORT_ROW_FAILED",message:error.message};}
  });
  return {results};
}
module.exports={preview,commit};
