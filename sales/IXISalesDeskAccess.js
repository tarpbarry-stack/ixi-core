"use strict";
const crypto = require("node:crypto");
const { MosError } = require("../mos/errors/MosError");
const { resolveMosMembershipPrincipal } = require("../mos/security/mosMembershipAuthorityService");
const { readJsonFile, writeJsonFileAtomic } = require("../mos/storage/jsonStore");
const { MOS_PATHS } = require("../mos/storage/mosPaths");
const { getEntity } = require("../mos/entities/entityService");
const { getObject } = require("../mos/objects/objectService");
const repo = require("./IXISalesDeskRepository");
const clean = value => String(value ?? "").trim();
const fail = (code,message,status=403) => { throw new MosError(code,message,null,status); };
function authorize(context, operation="read") {
  if (!context?.authenticated || !context.principalId || !context.entityId) fail("SALES_AUTH_REQUIRED","Sign in to open Sales Desk.",401);
  const {principal,membership,account}=resolveMosMembershipPrincipal(context);
  if(account.primaryEntityId!==context.entityId)fail("SALES_ACCESS_DENIED","The company membership and account do not match.");
  const owner=membership.role==="owner" && account.ownerUserId===context.principalId && account.primaryEntityId===context.entityId;
  const seat=membership.salesDesk || {};
  const denied=principal.directDenies || [];
  if (denied.includes("*") || denied.includes("sales-desk.access") || (!owner && seat.enabled!==true)) fail("SALES_ACCESS_DENIED","An active Sales Desk seat is required for this company.");
  const role=owner ? "owner" : seat.role;
  if (!["owner","manager","sales","viewer"].includes(role)) fail("SALES_ACCESS_DENIED","This Sales Desk seat is not configured.");
  const canWrite=role!=="viewer" && !denied.includes("sales-desk.write");
  if (operation==="write" && !canWrite) fail("SALES_WRITE_DENIED","Your company membership does not permit Sales Desk changes.");
  const memberships=Object.values(readJsonFile(MOS_PATHS.memberships,{}));
  const ownerMembership=memberships.find(m=>m.accountId===account.accountId && m.principalId===account.ownerUserId && m.role==="owner" && m.status==="active");
  return {entityId:context.entityId,actorId:context.principalId,company:getEntity(context.entityId).displayName,role,canWrite,canAssign:owner || role==="manager",canReadAll:owner || role==="manager" || seat.scope==="company",canManageTeam:owner,canImport:owner,canFinancial:owner,canEditMachines:owner,ownerUserId:account.ownerUserId,ownerPersonObjectId:clean(ownerMembership?.personObjectId),accountId:account.accountId,tenantId:account.tenantId,membershipId:membership.membershipId};
}
function companies(context) {
  if (!context?.authenticated || !context.principalId) fail("SALES_AUTH_REQUIRED","Sign in to open Sales Desk.",401);
  return Object.values(readJsonFile(MOS_PATHS.memberships,{})).filter(m=>m.principalId===context.principalId && m.status==="active").flatMap(m=>{
    try { const a=authorize({...context,entityId:m.entityId});return [{entityId:a.entityId,company:a.company,role:a.role}]; } catch { return []; }
  });
}
function team(actor, includeDisabled=false) {
  const members=Object.values(readJsonFile(MOS_PATHS.memberships,{})).filter(m=>m.entityId===actor.entityId && m.accountId===actor.accountId && m.status==="active");
  return members.filter(m=>m.role==="owner" || m.salesDesk?.enabled || includeDisabled).map(m=>({id:m.membershipId,principalId:m.principalId,name:m.salesDesk?.name || (m.personObjectId ? getObject(m.personObjectId)?.displayName : "") || (m.role==="owner" ? actor.company+" · owner" : "Company member"),enabled:m.role==="owner" || m.salesDesk?.enabled===true,role:m.role==="owner" ? "owner" : m.salesDesk?.role || "sales",scope:m.role==="owner" ? "company" : m.salesDesk?.scope || "assigned",revision:m.salesDesk?.revision || 0}));
}
function requireOwner(actor) { if (!actor.canManageTeam) fail("SALES_TEAM_DENIED","Only the company owner can manage Sales Desk access."); }
function seatPolicy(input) {
  const role=clean(input.role),scope=clean(input.scope);
  if (!["manager","sales","viewer"].includes(role) || !["assigned","company"].includes(scope)) fail("SALES_SEAT_INVALID","Choose a sales role and record scope.",400);
  return {role,scope:role==="manager" ? "company" : scope};
}
function updateSeat(actor,input) {
  requireOwner(actor);
  const all=readJsonFile(MOS_PATHS.memberships,{}),m=all[clean(input.id)];
  if (!m || m.entityId!==actor.entityId || m.accountId!==actor.accountId || m.role==="owner" || m.status!=="active") fail("SALES_TEAM_MEMBER_INVALID","Select an active non-owner company member.");
  if (Number(input.revision)!==(m.salesDesk?.revision || 0)) fail("SALES_REVISION_CONFLICT","This seat changed. Refresh before saving.",409);
  const policy=seatPolicy(input);
  all[m.membershipId]={...m,salesDesk:{...m.salesDesk,...policy,enabled:input.enabled===true,revision:(m.salesDesk?.revision || 0)+1,updatedBy:actor.actorId,updatedAt:new Date().toISOString()}};
  writeJsonFileAtomic(MOS_PATHS.memberships,all);
  return {members:team(actor,true)};
}
function invitation(actor,input) {
  requireOwner(actor);
  const email=clean(input.email).toLowerCase(),person=getObject(clean(input.personObjectId));
  if (!email || email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("SALES_EMAIL_INVALID","Enter the invitee's email.",400);
  if (!person || person.entityId!==actor.entityId || person.objectType!=="person" || person.status!=="active" || person.objectId===actor.ownerPersonObjectId) fail("SALES_INVITEE_INVALID","Choose an active team member in AOS. The owner already has access.",400);
  const policy=seatPolicy(input),token=crypto.randomBytes(32).toString("base64url"),id=crypto.randomUUID();
  const record={id,email,personObjectId:person.objectId,name:person.displayName,...policy,tokenHash:crypto.createHash("sha256").update(token).digest("hex"),expiresAt:new Date(Date.now()+7*86400000).toISOString(),status:"pending"};
  repo.command({...actor,commandId:crypto.randomUUID(),input:{id,email}},()=>({kind:"invitations",record}));
  return {id,token,expiresAt:record.expiresAt};
}
function invitations(actor) {
  requireOwner(actor);
  return repo.list(actor.entityId,"invitations",{limit:200}).items.map(({tokenHash,...item})=>item);
}
function revokeInvitation(actor,input) {
  requireOwner(actor);const old=repo.get(actor.entityId,"invitations",clean(input.id));
  if (!old || old.status!=="pending") fail("SALES_INVITATION_UNAVAILABLE","This invitation is no longer pending.",409);
  return repo.command({...actor,commandId:crypto.randomUUID(),input:{id:old.id}},()=>({kind:"invitations",record:{...old,status:"revoked"},expectedRevision:old.revision}));
}
function acceptInvitation(context,input) {
  if (!context?.authenticated || !context.principalId || input?.verifiedEmail!==true) fail("SALES_VERIFIED_EMAIL_REQUIRED","Sign in with a verified email address to accept this invitation.",401);
  const entityId=clean(input.entityId),id=clean(input.id),token=clean(input.token),old=repo.get(entityId,"invitations",id);
  const hash=crypto.createHash("sha256").update(token).digest("hex");
  if (!old || !token || hash!==old.tokenHash || old.email!==clean(input.email).toLowerCase() || old.status==="revoked" || Date.parse(old.expiresAt)<Date.now() || (old.acceptedBy && old.acceptedBy!==context.principalId)) fail("SALES_INVITATION_UNAVAILABLE","This invitation is invalid, expired, or belongs to another email.");
  const accounts=Object.values(readJsonFile(MOS_PATHS.accounts,{})),account=accounts.find(a=>a.primaryEntityId===entityId && a.status==="active");
  if (!account) fail("SALES_INVITATION_UNAVAILABLE","This company is unavailable.");
  const owner=authorize({authenticated:true,principalId:account.ownerUserId,entityId});
  if (!owner.canManageTeam) fail("SALES_INVITATION_UNAVAILABLE","This company cannot activate the invitation.");
  const person=getObject(old.personObjectId);
  if (!person || person.entityId!==entityId || person.status!=="active" || person.objectType!=="person") fail("SALES_INVITEE_INVALID","The selected AOS person is unavailable.");
  const memberships=readJsonFile(MOS_PATHS.memberships,{});
  const matches=Object.values(memberships).filter(m=>m.entityId===entityId && (m.principalId===context.principalId || m.personObjectId===person.objectId));
  if (matches.some(m=>m.membershipId!==`sales-${id}`)) fail("SALES_MEMBERSHIP_EXISTS","This user or person already has a company membership. Ask the owner to manage the existing seat.",409);
  if (!memberships[`sales-${id}`]) {
    memberships[`sales-${id}`]={membershipId:`sales-${id}`,accountId:account.accountId,tenantId:account.tenantId,entityId,principalType:"sharetribe-user",principalId:context.principalId,role:"sales",status:"active",permissions:["sales-desk.access"],personObjectId:person.objectId,personPassportId:person.passportId,entityPassportId:getEntity(entityId).passportId,salesDesk:{enabled:true,role:old.role,scope:old.scope,name:old.name,revision:1,invitationId:id,updatedBy:account.ownerUserId,updatedAt:new Date().toISOString()},createdAt:new Date().toISOString()};
    // Recoverable: retry after a lost response reuses this exact membership.
    writeJsonFileAtomic(MOS_PATHS.memberships,memberships);
  }
  if (old.status!=="accepted") repo.command({entityId,actorId:context.principalId,commandId:`accept-${id}`,input:{id}},()=>({kind:"invitations",record:{...old,status:"accepted",acceptedBy:context.principalId},expectedRevision:old.revision}));
  return {entityId,company:owner.company};
}
module.exports={authorize,companies,team,requireOwner,updateSeat,invitation,invitations,revokeInvitation,acceptInvitation};
