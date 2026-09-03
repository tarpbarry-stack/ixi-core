"use strict";

const crypto=require("crypto");
const clean=value=>String(value??"").trim();
const object=value=>value&&typeof value==="object"&&!Array.isArray(value)?value:{};
const array=value=>Array.isArray(value)?value:[];
const money=value=>Math.round((Number(value)||0)*100)/100;

function normalizeReference(value={}){
  const source=object(value),passportId=clean(source.passportId),role=clean(source.role);
  return passportId&&role?{passportId,role,label:clean(source.label),objectType:clean(source.objectType),metadata:{...object(source.metadata)}}:null;
}

function normalizeReferences(values=[]){
  const map=new Map();
  array(values).forEach(value=>{const reference=normalizeReference(value);if(reference)map.set(`${reference.role}:${reference.passportId}`,reference)});
  return [...map.values()];
}

function createPayablesControlDocument({financialDocumentId="",documentNumber="",currency="USD",occurredAt="",references=[],sourceFinancialDocumentId="",payablesControl={},entityPassportId="",actorPassportId="",metadata={}}={}){
  const timestamp=clean(occurredAt)||new Date().toISOString(),source=object(payablesControl),id=clean(financialDocumentId)||`ifd_${crypto.randomBytes(12).toString("hex")}`,billId=clean(sourceFinancialDocumentId||source?.payable?.billId);
  const control={...source,schema:"ixi-payables-control-v1",identity:{...object(source.identity),payablesControlId:id,number:clean(source?.identity?.number||documentNumber||`AP-${id.slice(-6).toUpperCase()}`)},payable:{...object(source.payable),billId},context:{...object(source.context),entityPassportId:clean(entityPassportId||source?.context?.entityPassportId),updatedByPassportId:clean(actorPassportId||source?.context?.updatedByPassportId)},audit:{...object(source.audit),createdAt:clean(source?.audit?.createdAt)||timestamp,updatedAt:timestamp}};
  return{financialDocumentId:id,documentType:"payables-control",documentNumber:control.identity.number,financialState:"submitted",currency:/^[A-Z]{3}$/.test(clean(currency).toUpperCase())?clean(currency).toUpperCase():"USD",occurredAt:timestamp,description:`A/P control · ${clean(control?.payable?.billNumber||billId)}`,sourceFinancialDocumentId:billId,relatedFinancialDocumentIds:billId?[billId]:[],relationships:billId?[{financialDocumentId:billId,relationshipType:"controls"}]:[],references:normalizeReferences(references),lines:[],totals:{subtotal:0,tax:0,total:0},payablesControl:control,accountingTreatment:{classification:"payables-operational-control",economicEvent:false,createsExpense:false,createsPayable:false,createsCashEvent:false},metadata:{...object(metadata),transactModule:"payables"}};
}

module.exports={createPayablesControlDocument};
