"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {createFreightOrder,calculateActualEconomics,validateFreightOrder}=require("./freightContract");
const {canTransition,transitionFreightOrder}=require("./freightLifecycle");

function draft(){return createFreightOrder({
 id:"FO-TEST-1",entityId:"ENT-1",actorId:"ACT-1",
 asset:{objectId:"OBJ-1",passportId:"PASS-1",label:"CAT 336",objectType:"machine"},
 route:{origin:{objectId:"YARD-1",label:"MIDLAND"},destination:{objectId:"JOB-1",label:"DENVER"},routeMiles:500},
 execution:{mode:"external-carrier",carrierName:"ABC HEAVY HAUL"},
 economics:{agreedAmount:2500},purpose:"customer-delivery"
});}

test("creates canonical Freight Order with stable expected economics",()=>{
 const record=draft();
 assert.equal(record.schema,"ixi-freight-order-v1");
 assert.equal(record.status,"draft");
 assert.equal(record.economics.expectedTotal,2500);
 assert.equal(record.economics.expectedPerMile,5);
 assert.equal(record.asset.passportId,"PASS-1");
});

test("validates destination and Passport identity",()=>{
 const record=draft();
 assert.equal(validateFreightOrder(record).valid,true);
 const invalid={...record,asset:{...record.asset,passportId:""}};
 assert.equal(validateFreightOrder(invalid).valid,false);
});

test("guards lifecycle transitions",()=>{
 assert.equal(canTransition("draft","requested"),true);
 assert.equal(canTransition("draft","delivered"),false);
 assert.throws(()=>transitionFreightOrder(draft(),"delivered"),error=>error.code==="FREIGHT_INVALID_STATE");
});

test("increments revision on valid state change",()=>{
 const next=transitionFreightOrder(draft(),"requested",{actorId:"ACT-2"});
 assert.equal(next.status,"requested");
 assert.equal(next.identity.revision,2);
 assert.equal(next.audit.updatedBy,"ACT-2");
});

test("blocks external carrier reconciliation until canonical Bill is linked",()=>{
 assert.throws(()=>calculateActualEconomics(draft(),{actualFreight:2600}),error=>error.code==="FREIGHT_BILL_REQUIRED");
});

test("calculates actual total, variance and actual dollars per mile after carrier Bill",()=>{
 const record=draft();
 record.financial.billId="BILL-100";
 const actual=calculateActualEconomics(record,{actualFreight:2600,actualPermits:100,actualDetention:50});
 assert.equal(actual.actualTotal,2750);
 assert.equal(actual.variance,250);
 assert.equal(actual.actualPerMile,5.5);
});

test("allows internal fleet reconciliation without an external carrier Bill",()=>{
 const record=draft();
 record.execution.mode="internal-fleet";
 record.execution.carrierName="";
 const actual=calculateActualEconomics(record,{actualFreight:1200,actualPermits:100});
 assert.equal(actual.actualTotal,1300);
 assert.equal(actual.actualPerMile,2.6);
});
