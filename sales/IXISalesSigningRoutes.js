"use strict";

const express = require("express");
const { loadByToken, completeByToken } = require("./IXISalesSigningService");

const router = express.Router();
const clean = value => String(value ?? "").trim();

function errorStatus(error) {
  if (/expired/i.test(clean(error?.name))) return 410;
  if (/token|signature validation|not available|does not match|does not reference/i.test(`${clean(error?.name)} ${clean(error?.message)}`)) return 400;
  return 500;
}

function failure(res, error) {
  return res.status(errorStatus(error)).json({ ok: false, contract: "ixi-sales-signing", data: null, errors: [{ name: clean(error?.name || "IXISalesSigningError"), message: clean(error?.message || "Sales signing failed.") }], warnings: [] });
}

router.get("/:token", async (req, res) => {
  try {
    const result = await loadByToken(req.params.token);
    res.setHeader("Cache-Control", "no-store, private");
    return res.status(200).json({ ok: true, contract: "ixi-sales-signing", data: { order: result.order }, errors: [], warnings: [] });
  } catch (error) { return failure(res, error); }
});

router.post("/:token/complete", async (req, res) => {
  try {
    const requestId = clean(req.headers["x-request-id"] || cryptoRandom());
    const result = await completeByToken(req.params.token, req.body || {}, {
      requestId,
      sourceIp: clean(req.headers["x-forwarded-for"] || req.socket?.remoteAddress).split(",")[0],
      userAgent: clean(req.headers["user-agent"])
    });
    res.setHeader("Cache-Control", "no-store, private");
    return res.status(200).json({ ok: true, contract: "ixi-sales-signing", data: result, errors: [], warnings: [] });
  } catch (error) { return failure(res, error); }
});

function cryptoRandom() { return require("crypto").randomBytes(12).toString("hex"); }

module.exports = router;
