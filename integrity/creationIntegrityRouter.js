"use strict";

const express = require("express");
const {
  reconcileCreationIntegrity
} = require("./creationIntegrityService");

const clean = value => String(value ?? "").trim();

function createCreationIntegrityRouter({
  loadObjects,
  loadPassports,
  loadProvisioningRecords,
  resolveActor
} = {}) {
  if (typeof loadObjects !== "function") {
    throw new Error("Creation Integrity requires loadObjects.");
  }
  if (typeof loadPassports !== "function") {
    throw new Error("Creation Integrity requires loadPassports.");
  }
  if (typeof loadProvisioningRecords !== "function") {
    throw new Error("Creation Integrity requires loadProvisioningRecords.");
  }
  if (process.env.NODE_ENV === "production" && typeof resolveActor !== "function") {
    throw new Error("Creation Integrity production registration requires trusted resolveActor.");
  }

  const router = express.Router();

  async function context(req) {
    const resolved = typeof resolveActor === "function"
      ? await resolveActor(req)
      : {};

    const entityId = clean(
      resolved?.entityId ||
      req.ixiRequestContext?.entityId ||
      req.user?.entityId
    );

    const actorId = clean(
      resolved?.actorId ||
      resolved?.principalId ||
      req.ixiRequestContext?.principalId ||
      req.user?.id
    );

    if (!entityId) {
      const error = new Error("Authenticated Entity is required.");
      error.code = "AOS_CREATION_INTEGRITY_ENTITY_REQUIRED";
      error.status = 401;
      throw error;
    }

    return { entityId, actorId };
  }

  function sendError(res, error) {
    return res.status(Number(error?.status || 500)).json({
      ok: false,
      error: {
        code: error?.code || "AOS_CREATION_INTEGRITY_FAILED",
        message: error?.message || "Creation integrity reconciliation failed.",
        details: error?.details || null
      }
    });
  }

  router.get("/report", async (req, res) => {
    try {
      const { entityId } = await context(req);
      const [objects, passports, provisioningRecords] = await Promise.all([
        loadObjects({ entityId }),
        loadPassports({ entityId }),
        loadProvisioningRecords({ entityId })
      ]);

      const report = reconcileCreationIntegrity({
        entityId,
        objects,
        passports,
        provisioningRecords
      });

      return res.status(report.status === "failed" ? 409 : 200).json({
        ok: report.status !== "failed",
        report
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/health", async (req, res) => {
    try {
      const { entityId } = await context(req);
      const [objects, passports, provisioningRecords] = await Promise.all([
        loadObjects({ entityId }),
        loadPassports({ entityId }),
        loadProvisioningRecords({ entityId })
      ]);

      const report = reconcileCreationIntegrity({
        entityId,
        objects,
        passports,
        provisioningRecords
      });

      return res.status(report.status === "healthy" ? 200 : 409).json({
        ok: report.status === "healthy",
        status: report.status,
        summary: report.summary,
        contractVersion: report.contractVersion
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
}

module.exports = {
  createCreationIntegrityRouter
};