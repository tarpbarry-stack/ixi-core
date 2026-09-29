"use strict";

const express = require("express");
const { sendMosError } = require("../mos/routes/httpHelpers");
const access = require("./IXIWorkforceAccessService");

const router = express.Router();

router.use((req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  next();
});

router.post("/invitations/accept", (req, res) => {
  try {
    return res.status(200).json({
      ok: true,
      ...access.acceptInvitation(req.ixiRequestContext, req.body || {})
    });
  } catch (error) {
    return sendMosError(res, error);
  }
});

router.get("/people/:personObjectId", (req, res) => {
  try {
    return res.status(200).json({
      ok: true,
      ...access.getPersonAccess(req.ixiRequestContext, req.params.personObjectId)
    });
  } catch (error) {
    return sendMosError(res, error);
  }
});

router.put("/people/:personObjectId", (req, res) => {
  try {
    return res.status(200).json({
      ok: true,
      ...access.savePersonAccess(req.ixiRequestContext, req.params.personObjectId, req.body || {})
    });
  } catch (error) {
    return sendMosError(res, error);
  }
});

router.post("/people/:personObjectId/invitations", (req, res) => {
  try {
    return res.status(201).json({
      ok: true,
      ...access.createInvitation(req.ixiRequestContext, req.params.personObjectId, req.body || {})
    });
  } catch (error) {
    return sendMosError(res, error);
  }
});

router.post("/invitations/:invitationId/revoke", (req, res) => {
  try {
    return res.status(200).json({
      ok: true,
      ...access.revokeInvitation(req.ixiRequestContext, req.params.invitationId, req.body || {})
    });
  } catch (error) {
    return sendMosError(res, error);
  }
});

module.exports = router;
