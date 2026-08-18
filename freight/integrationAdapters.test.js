"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {createAdapters}=require("./integrationAdapters");

function mockFetch(calls){
  return async (url,options={})=>{
    calls.push({url,options,body:options.body?JSON.parse(options.body):null});
    return {ok:true,status:200,json:async()=>({ok:true,movementId:"MOV-1",financialDocument:{id:"FD-1"}})};
  };
}

test("Freight dispatch uses Freight Order stable MOS command id",async()=>{
 const original=global.fetch;const calls=[];global.fetch=mockFetch(calls);
 try{
  const adapters=createAdapters({mosBaseUrl:"http://mos/mos/v1",financialBaseUrl:"http://fin/financial"});
  await adapters.requestFreightMove({commandId:"browser-command-a",entityId:"ENT",objectId:"OBJ",destinationContainerId:"DEST",actorId:"ACT",metadata:{freightOrderId:"FO-101"}});
  await adapters.requestFreightMove({commandId:"browser-command-b",entityId:"ENT",objectId:"OBJ",destinationContainerId:"DEST",actorId:"ACT",metadata:{freightOrderId:"FO-101"}});
  assert.equal(calls[0].body.commandId,"freight:FO-101:movement");
  assert.equal(calls[1].body.commandId,"freight:FO-101:movement");
 }finally{global.fetch=original}
});

test("Freight delivery uses movement-stable completion command",async()=>{
 const original=global.fetch;const calls=[];global.fetch=mockFetch(calls);
 try{
  const adapters=createAdapters({mosBaseUrl:"http://mos/mos/v1",financialBaseUrl:"http://fin/financial"});
  await adapters.completeFreightMove({movementId:"MOV-77",commandId:"browser-a",actorId:"ACT"});
  await adapters.completeFreightMove({movementId:"MOV-77",commandId:"browser-b",actorId:"ACT"});
  assert.equal(calls[0].body.commandId,"freight-movement:MOV-77:complete");
  assert.equal(calls[1].body.commandId,"freight-movement:MOV-77:complete");
 }finally{global.fetch=original}
});

test("Asset Move uses Asset Move stable MOS command id",async()=>{
 const original=global.fetch;const calls=[];global.fetch=mockFetch(calls);
 try{
  const adapters=createAdapters({mosBaseUrl:"http://mos/mos/v1",financialBaseUrl:"http://fin/financial"});
  await adapters.moveAssetImmediately({commandId:"browser-a",entityId:"ENT",objectId:"OBJ",destinationContainerId:"DEST",actorId:"ACT",metadata:{assetMoveId:"AMO-99"}});
  assert.equal(calls[0].body.commandId,"asset-move:AMO-99:movement");
 }finally{global.fetch=original}
});
