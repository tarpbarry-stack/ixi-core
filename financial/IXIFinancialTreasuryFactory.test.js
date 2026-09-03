"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {createTreasuryAccountDocument,createTreasuryReconciliationDocument}=require("./IXIFinancialTreasuryFactory");
const {createPaymentDocument}=require("./IXIFinancialPaymentFactory");
const {validateFinancialDocument}=require("./IXIFinancialValidationBridge");
const provider=require("./IXIFinancialProviderService");
const {assertTreasuryControl}=require("./IXIFinancialCommandEngine");
const {IXI_FINANCIAL_ACTIONS,getEffectiveFinancialPermissions}=require("./IXIFinancialPermissionEngine");
const {createFinancialLifecycleSnapshot}=require("./IXIFinancialLifecycleEngine");
const {createTreasuryTransactionItems}=require("./IXIFinancialDynamoStore");

const entity="urn:ixi:passport:entity:test";
const actor="urn:ixi:passport:employee:test";
const refs=[{passportId:entity,role:"entity"}];

test("Treasury account is an Entity-bound non-economic control",()=>{
  const document=createTreasuryAccountDocument({financialDocumentId:"ifd_cash",entityPassportId:entity,actorPassportId:actor,references:refs,treasuryAccount:{account:{name:"Operating",accountType:"checking",currency:"USD"},opening:{effectiveDate:"2026-09-03",amount:2500,source:"bank-statement"},control:{minimumCash:500}}});
  assert.equal(document.treasuryAccount.identity.accountId,"ifd_cash");
  assert.equal(document.accountingTreatment.economicEvent,false);
  assert.equal(document.totals.total,0);
  assert.equal(validateFinancialDocument(document).ok,true);
});

test("Treasury transfer preserves both account legs and company net zero",()=>{
  const document=createPaymentDocument({amount:125,currency:"USD",occurredAt:"2026-09-03",paymentDirection:"outflow",transactionReference:"XFER-101",references:refs,treasuryMovement:{transactionClass:"account-transfer",fromCashAccountFinancialDocumentId:"ifd_cash_a",toCashAccountFinancialDocumentId:"ifd_cash_b",entityPassportId:entity,actorPassportId:actor}});
  assert.equal(document.treasuryMovement.schema,"ixi-treasury-movement-v2");
  assert.equal(document.accountingTreatment.companyCashNetChange,0);
  assert.equal(validateFinancialDocument(document).ok,true);
});

test("Treasury reconciliation computes difference without changing book cash",()=>{
  const document=createTreasuryReconciliationDocument({entityPassportId:entity,actorPassportId:actor,references:refs,treasuryReconciliation:{accountId:"ifd_cash",statement:{date:"2026-08-31",balance:900},book:{balance:1000},reconciling:{depositsInTransit:200,outstandingPayments:100,otherReconcilingItems:0}}});
  assert.equal(document.treasuryReconciliation.reconciling.adjustedBankBalance,1000);
  assert.equal(document.treasuryReconciliation.reconciling.difference,0);
  assert.equal(document.treasuryReconciliation.status,"reconciled");
  assert.equal(document.totals.total,0);
  assert.equal(validateFinancialDocument(document).ok,true);
});

test("Treasury movement rejects missing trusted lineage",()=>{
  const document=createPaymentDocument({amount:25,paymentDirection:"outflow",transactionReference:"ADJ-1",treasuryMovement:{transactionClass:"cash-adjustment",cashAccountFinancialDocumentId:"ifd_cash",reason:"Bank fee"}});
  const validation=validateFinancialDocument(document);
  assert.equal(validation.ok,false);
  assert.match(validation.errors.map(error=>error.message||error).join(" "),/trusted Entity and actor lineage/);
});

test("Treasury control rejects duplicate openings and cash overdrafts",async()=>{
  const accountDocument=createTreasuryAccountDocument({financialDocumentId:"ifd_cash",entityPassportId:entity,actorPassportId:actor,references:refs,treasuryAccount:{account:{name:"Operating",accountType:"checking",currency:"USD"},opening:{effectiveDate:"2026-09-03",amount:100},control:{allowNegative:false}}});
  const opening=createPaymentDocument({financialDocumentId:"ifd_open",amount:100,currency:"USD",paymentDirection:"inflow",references:refs,treasuryMovement:{transactionClass:"opening-balance",cashAccountFinancialDocumentId:"ifd_cash",entityPassportId:entity,actorPassportId:actor}});
  const originalGet=provider.getDocument,originalList=provider.listDocumentsByPassport;
  provider.getDocument=async()=>({ok:true,data:{record:{financialDocument:accountDocument}}});
  provider.listDocumentsByPassport=async()=>({ok:true,data:{documents:[{financialDocument:opening}]}});
  try{
    const duplicate=createPaymentDocument({amount:10,currency:"USD",paymentDirection:"inflow",references:refs,treasuryMovement:{transactionClass:"opening-balance",cashAccountFinancialDocumentId:"ifd_cash",entityPassportId:entity,actorPassportId:actor}});
    await assert.rejects(()=>assertTreasuryControl({financialDocument:duplicate,entityPassportId:entity}),/only one opening balance/);
    const cashOut=createPaymentDocument({amount:125,currency:"USD",paymentDirection:"outflow",transactionReference:"ADJ-OVER",references:refs,treasuryMovement:{transactionClass:"cash-adjustment",cashAccountFinancialDocumentId:"ifd_cash",entityPassportId:entity,actorPassportId:actor,reason:"Bank correction"}});
    await assert.rejects(()=>assertTreasuryControl({financialDocument:cashOut,entityPassportId:entity}),/exceeds canonical book cash/);
  }finally{provider.getDocument=originalGet;provider.listDocumentsByPassport=originalList;}
});

test("Treasury mutation authority is segregated to accounting control roles",()=>{
  const employee=getEffectiveFinancialPermissions({roles:["financial-employee"]}),accounting=getEffectiveFinancialPermissions({roles:["financial-accounting"]});
  assert.equal(employee.includes(IXI_FINANCIAL_ACTIONS.MANAGE_TREASURY),false);
  assert.equal(employee.includes(IXI_FINANCIAL_ACTIONS.POST_TREASURY_MOVEMENT),false);
  assert.equal(accounting.includes(IXI_FINANCIAL_ACTIONS.MANAGE_TREASURY),true);
  assert.equal(accounting.includes(IXI_FINANCIAL_ACTIONS.POST_TREASURY_MOVEMENT),true);
  assert.equal(accounting.includes(IXI_FINANCIAL_ACTIONS.RECONCILE_TREASURY),true);
});

test("Treasury movements never masquerade as A/P settlement or A/R collection",()=>{
  const opening=createPaymentDocument({amount:500,paymentDirection:"inflow",references:refs,treasuryMovement:{transactionClass:"opening-balance",cashAccountFinancialDocumentId:"ifd_cash",entityPassportId:entity,actorPassportId:actor}}),adjustment=createPaymentDocument({amount:20,paymentDirection:"outflow",transactionReference:"BANK-FEE",references:refs,treasuryMovement:{transactionClass:"cash-adjustment",cashAccountFinancialDocumentId:"ifd_cash",entityPassportId:entity,actorPassportId:actor,reason:"Bank fee"}}),snapshot=createFinancialLifecycleSnapshot({documents:[opening,adjustment]});
  assert.equal(snapshot.paid,0);assert.equal(snapshot.collected,0);
});

test("Dynamo atomically guards balance, transfer legs, and one-time opening",()=>{
  const transfer=createPaymentDocument({financialDocumentId:"ifd_transfer",amount:75,currency:"USD",paymentDirection:"outflow",transactionReference:"XFER-ATOMIC",references:refs,treasuryMovement:{transactionClass:"account-transfer",fromCashAccountFinancialDocumentId:"ifd_a",toCashAccountFinancialDocumentId:"ifd_b",entityPassportId:entity,actorPassportId:actor}}),transferItems=createTreasuryTransactionItems({record:{financialDocument:transfer},updatedAt:"2026-09-03T00:00:00.000Z"});
  assert.equal(transferItems.length,2);assert.match(transferItems[0].Update.ConditionExpression,/balance >= :required/);assert.equal(transferItems[0].Update.ExpressionAttributeValues[":delta"],-75);assert.equal(transferItems[1].Update.ExpressionAttributeValues[":delta"],75);
  const opening=createPaymentDocument({financialDocumentId:"ifd_opening",amount:100,currency:"USD",paymentDirection:"inflow",references:refs,treasuryMovement:{transactionClass:"opening-balance",cashAccountFinancialDocumentId:"ifd_a",entityPassportId:entity,actorPassportId:actor}}),openingItems=createTreasuryTransactionItems({record:{financialDocument:opening},updatedAt:"2026-09-03T00:00:00.000Z"});
  assert.equal(openingItems.length,2);assert.equal(openingItems[1].Put.ConditionExpression,"attribute_not_exists(PK)");assert.match(openingItems[1].Put.Item.SK,/^OPENING#/);
});
