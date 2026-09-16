"use strict";
const express = require("express");
const service = require("./IXISalesDeskService");
const repo = require("./IXISalesDeskRepository");
const { sendMosError } = require("../mos/routes/httpHelpers");
const router = express.Router();
router.use((req,res,next) => {
  res.setHeader("Cache-Control","private, no-store");
  try { req.salesActor = service.authorize(req.ixiRequestContext); next(); }
  catch(error) { sendMosError(res,error); }
});
router.get("/context",(req,res) => res.json({ok:true,context:req.salesActor,capabilities:{ read:true,write:true,financialAuthority:"existing-transact-policy" }}));
router.get("/bootstrap",(req,res) => {
  try {
    const actor=req.salesActor;
    const lists=Object.fromEntries(["contacts","deals","tasks","boards"].map(kind=>[kind,service.listRecords(actor,kind,{limit:100})]));
    res.json({ok:true,context:actor,lists,people:service.people(actor),summary:repo.summary(actor.entityId,service.date(req.query.today) || new Date().toISOString().slice(0,10))});
  } catch(error) { sendMosError(res,error); }
});
router.get("/people",(req,res) => { try { res.json({ok:true,items:service.people(req.salesActor)}); } catch(error) { sendMosError(res,error); } });
router.get("/records/:kind",(req,res) => { try { res.json({ok:true,...service.listRecords(req.salesActor,req.params.kind,req.query)}); } catch(error) { sendMosError(res,error); } });
router.get("/records/:kind/:id",(req,res) => {
  try { res.json({ok:true,record:service.getRecord(req.salesActor,req.params.kind,req.params.id),history:repo.history(req.salesActor.entityId,req.params.kind,req.params.id)}); }
  catch(error) { sendMosError(res,error); }
});
router.post("/commands",(req,res) => { try { res.json({ok:true,...service.save(req.salesActor,req.body)}); } catch(error) { sendMosError(res,error); } });
module.exports = router;
