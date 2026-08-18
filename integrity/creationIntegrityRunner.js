"use strict";

const crypto = require("crypto");

const {
  reconcileCreationIntegrity
} = require("./creationIntegrityService");

const RUNNER_VERSION = "ixi-aos-creation-integrity-runner-v1";
const clean = value => String(value ?? "").trim();
const array = value => Array.isArray(value) ? value : [];
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function createReportFingerprint(report = {}) {
  const normalized = {
    status: clean(report.status),
    findings: array(report.findings)
      .map(item => ({ ...object(item) }))
      .sort((a, b) => stableSerialize(a).localeCompare(stableSerialize(b)))
  };

  return crypto
    .createHash("sha256")
    .update(stableSerialize(normalized))
    .digest("hex");
}

function normalizeEntityIds(value) {
  return [...new Set(array(value).map(clean).filter(Boolean))].sort();
}

function createDefaultState(entityId) {
  return {
    entityId,
    runnerVersion: RUNNER_VERSION,
    lastStatus: null,
    lastFingerprint: null,
    lastRunAt: null,
    lastHealthyAt: null,
    lastUnhealthyAt: null,
    lastAlertFingerprint: null,
    lastAlertAt: null,
    lastRecoveryAt: null,
    consecutiveUnhealthyRuns: 0,
    runCount: 0
  };
}

function shouldEmitIncident({ report, fingerprint, state }) {
  if (!report || report.status === "healthy") return false;
  return clean(state?.lastAlertFingerprint) !== clean(fingerprint);
}

function shouldEmitRecovery({ report, state }) {
  return report?.status === "healthy" && Boolean(state?.lastStatus && state.lastStatus !== "healthy");
}

function createIntegrityAlert({ kind, entityId, report, fingerprint, generatedAt }) {
  return {
    alertVersion: "ixi-aos-creation-integrity-alert-v1",
    kind,
    entityId,
    generatedAt,
    fingerprint,
    status: report.status,
    contractVersion: report.contractVersion,
    summary: report.summary,
    findings: report.findings
  };
}

function requireFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function.`);
  }
  return value;
}

function createCreationIntegrityRunner({
  listEntityIds,
  loadObjects,
  loadPassports,
  loadProvisioningRecords,
  loadState,
  saveState,
  emitAlert,
  passportEntityEnforcementAt = process.env.IXI_AOS_PASSPORT_ENTITY_ENFORCEMENT_AT || "",
  now = () => new Date().toISOString(),
  logger = console
} = {}) {
  requireFunction(listEntityIds, "listEntityIds");
  requireFunction(loadObjects, "loadObjects");
  requireFunction(loadPassports, "loadPassports");
  requireFunction(loadProvisioningRecords, "loadProvisioningRecords");
  requireFunction(loadState, "loadState");
  requireFunction(saveState, "saveState");
  requireFunction(emitAlert, "emitAlert");

  async function runEntity(entityId) {
    const normalizedEntityId = clean(entityId);
    if (!normalizedEntityId) throw new Error("Creation integrity runner requires entityId.");

    const startedAt = now();
    const previousState = {
      ...createDefaultState(normalizedEntityId),
      ...object(await loadState({ entityId: normalizedEntityId }))
    };

    const [objects, passports, provisioningRecords] = await Promise.all([
      loadObjects({ entityId: normalizedEntityId }),
      loadPassports({ entityId: normalizedEntityId }),
      loadProvisioningRecords({ entityId: normalizedEntityId })
    ]);

    const report = reconcileCreationIntegrity({
      entityId: normalizedEntityId,
      objects,
      passports,
      provisioningRecords,
      passportEntityEnforcementAt
    });

    const fingerprint = createReportFingerprint(report);
    let alert = null;
    let alertError = null;

    if (shouldEmitIncident({ report, fingerprint, state: previousState })) {
      alert = createIntegrityAlert({
        kind: "incident",
        entityId: normalizedEntityId,
        report,
        fingerprint,
        generatedAt: startedAt
      });
    } else if (shouldEmitRecovery({ report, state: previousState })) {
      alert = createIntegrityAlert({
        kind: "recovery",
        entityId: normalizedEntityId,
        report,
        fingerprint,
        generatedAt: startedAt
      });
    }

    if (alert) {
      try {
        await emitAlert(alert);
      } catch (error) {
        alertError = {
          code: clean(error?.code) || "INTEGRITY_ALERT_EMIT_FAILED",
          message: clean(error?.message) || String(error)
        };
        logger?.error?.("IXI creation integrity alert emission failed", {
          entityId: normalizedEntityId,
          kind: alert.kind,
          error: alertError
        });
      }
    }

    const unhealthy = report.status !== "healthy";
    const completedAt = now();
    const nextState = {
      ...previousState,
      entityId: normalizedEntityId,
      runnerVersion: RUNNER_VERSION,
      lastStatus: report.status,
      lastFingerprint: fingerprint,
      lastRunAt: completedAt,
      lastHealthyAt: unhealthy ? previousState.lastHealthyAt : completedAt,
      lastUnhealthyAt: unhealthy ? completedAt : previousState.lastUnhealthyAt,
      consecutiveUnhealthyRuns: unhealthy ? Number(previousState.consecutiveUnhealthyRuns || 0) + 1 : 0,
      runCount: Number(previousState.runCount || 0) + 1
    };

    // An alert is considered delivered only when the sink succeeds. Failed
    // delivery intentionally leaves lastAlertFingerprint unchanged so the
    // next scheduled run retries the alert rather than suppressing it.
    if (alert && !alertError) {
      if (alert.kind === "incident") {
        nextState.lastAlertFingerprint = fingerprint;
        nextState.lastAlertAt = completedAt;
      } else if (alert.kind === "recovery") {
        nextState.lastRecoveryAt = completedAt;
      }
    }

    await saveState({ entityId: normalizedEntityId, state: nextState });

    return {
      runnerVersion: RUNNER_VERSION,
      entityId: normalizedEntityId,
      startedAt,
      completedAt,
      report,
      fingerprint,
      alertEmitted: Boolean(alert && !alertError),
      alertKind: alert?.kind || null,
      alertError,
      state: nextState
    };
  }

  async function runAll() {
    const startedAt = now();
    const entityIds = normalizeEntityIds(await listEntityIds());
    const results = [];

    // Deliberately sequential in v1: reconciliation is operational control,
    // not throughput work. This avoids burst-reading shared stores and keeps
    // alert ordering deterministic. Concurrency can be introduced later with
    // explicit back-pressure semantics.
    for (const entityId of entityIds) {
      try {
        results.push(await runEntity(entityId));
      } catch (error) {
        results.push({
          runnerVersion: RUNNER_VERSION,
          entityId,
          startedAt: now(),
          completedAt: now(),
          report: null,
          fingerprint: null,
          alertEmitted: false,
          alertKind: null,
          alertError: null,
          runnerError: {
            code: clean(error?.code) || "INTEGRITY_RUNNER_ENTITY_FAILED",
            message: clean(error?.message) || String(error)
          }
        });
      }
    }

    const failedRuns = results.filter(item => item.runnerError).length;
    const unhealthyTenants = results.filter(item => item.report && item.report.status !== "healthy").length;

    return {
      runnerVersion: RUNNER_VERSION,
      startedAt,
      completedAt: now(),
      entitiesChecked: entityIds.length,
      unhealthyTenants,
      failedRuns,
      healthy: failedRuns === 0 && unhealthyTenants === 0,
      results
    };
  }

  return {
    runEntity,
    runAll
  };
}

module.exports = {
  RUNNER_VERSION,
  createReportFingerprint,
  createDefaultState,
  shouldEmitIncident,
  shouldEmitRecovery,
  createIntegrityAlert,
  createCreationIntegrityRunner
};