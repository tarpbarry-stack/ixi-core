"use strict";
const express = require("express");
const service = require("./IXISalesDeskService");
const repo = require("./IXISalesDeskRepository");
const { sendMosError } = require("../mos/routes/httpHelpers");
const access=require("./IXISalesDeskAccess"),contactImport=require("./IXISalesDeskImport");
const router = express.Router();
router.get("/companies",(req,res)=>{try{res.setHeader("Cache-Control","private, no-store");res.json({ok:true,companies:access.companies(req.ixiRequestContext)});}catch(e){sendMosError(res,e);}});
router.post("/invitations/accept",(req,res)=>{try{res.setHeader("Cache-Control","private, no-store");res.json({ok:true,...access.acceptInvitation(req.ixiRequestContext,req.body)});}catch(e){sendMosError(res,e);}});
router.use((req,res,next) => {
  res.setHeader("Cache-Control","private, no-store");
  try { req.salesActor = service.authorize(req.ixiRequestContext,req.method === "POST" ? "write" : "read"); next(); }
  catch(error) { sendMosError(res,error); }
});
router.get("/context",(req,res) => res.json({ok:true,context:req.salesActor,capabilities:{ read:true,write:req.salesActor.canWrite,financialAuthority:"existing-transact-policy" }}));
router.get("/bootstrap",(req,res) => {
  try {
    const actor=req.salesActor;
    const lists=Object.fromEntries(["contacts","deals","tasks","boards"].map(kind=>[kind,service.listRecords(actor,kind,{limit:100})]));
    res.json({ok:true,context:actor,team:access.team(actor),lists,people:service.people(actor),summary:repo.summary(actor.entityId,service.date(req.query.today) || new Date().toISOString().slice(0,10),actor)});
  } catch(error) { sendMosError(res,error); }
});
router.get("/team",(req,res)=>{try{access.requireOwner(req.salesActor);res.json({ok:true,members:access.team(req.salesActor,true),invitations:access.invitations(req.salesActor)});}catch(e){sendMosError(res,e);}});
router.post("/team",(req,res)=>{try{res.json({ok:true,...access.updateSeat(req.salesActor,req.body)});}catch(e){sendMosError(res,e);}});
router.post("/invitations",(req,res)=>{try{res.json({ok:true,...access.invitation(req.salesActor,req.body)});}catch(e){sendMosError(res,e);}});
router.post("/invitations/revoke",(req,res)=>{try{res.json({ok:true,...access.revokeInvitation(req.salesActor,req.body)});}catch(e){sendMosError(res,e);}});
router.post("/import/:action",(req,res)=>{try{if(!["preview","commit"].includes(req.params.action))return res.sendStatus(404);res.json({ok:true,...contactImport[req.params.action](req.salesActor,req.body)});}catch(e){sendMosError(res,e);}});
router.get("/related/:kind/:id",(req,res)=>{try{res.json({ok:true,...service.related(req.salesActor,req.params.kind,req.params.id)});}catch(e){sendMosError(res,e);}});
router.get("/people",(req,res) => { try { res.json({ok:true,items:service.people(req.salesActor)}); } catch(error) { sendMosError(res,error); } });
router.get("/records/:kind",(req,res) => { try { res.json({ok:true,...service.listRecords(req.salesActor,req.params.kind,req.query)}); } catch(error) { sendMosError(res,error); } });
router.get("/records/:kind/:id",(req,res) => {
  try { res.json({ok:true,record:service.getRecord(req.salesActor,req.params.kind,req.params.id),history:repo.history(req.salesActor.entityId,req.params.kind,req.params.id)}); }
  catch(error) { sendMosError(res,error); }
});
router.post("/commands",(req,res) => { try { res.json({ok:true,...service.save(req.salesActor,req.body)}); } catch(error) { sendMosError(res,error); } });
module.exports = router;
