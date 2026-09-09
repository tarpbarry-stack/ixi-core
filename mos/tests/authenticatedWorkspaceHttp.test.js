"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-workspace-http-"));
process.env.IXI_MOS_DATA_ROOT = path.join(testRoot, "mos");
process.env.IXI_PASSPORT_DATA_FILE = path.join(testRoot, "passports.json");
process.env.IXI_MOS_INTERNAL_SECRET = "workspace-http-test-secret";
process.env.IXI_MOS_INTERNAL_AUTH_ENFORCE = "true";

const express = require("express");
const { ensureAosAccount } = require("../accounts/aosAccountService");
const { provisionAosObject } = require("../provisioning/aosObjectProvisioningService");
const { listObjects } = require("../objects/objectService");
const { readPassportRecords } = require("../../passport/passportRegistry");
const { buildCanonicalRequest } = require("../security/internalRequestAuthService");
const authorityStore = require("../../authority/IXIAuthorityDynamoStore");
authorityStore.getCurrentPolicyRecord = async () => null;
const { mosRouter } = require("../routes/mosRouter");

const bootstrap = ensureAosAccount({ ownerUserId: "signed-owner", displayName: "Signed Entity" });
const object = provisionAosObject({
  commandId: "signed-object",
  entityId: bootstrap.entity.entityId,
  objectType: "customer-defined",
  displayName: "Signed Object",
  actorId: "signed-owner"
}).object;

function signedHeaders({ method, targetPath, principalId, entityId, body, commandId, requestId }) {
  const timestamp = String(Date.now());
  const id = requestId || crypto.randomUUID();
  const canonical = buildCanonicalRequest({
    timestamp,
    requestId: id,
    method,
    targetPath,
    principalId,
    entityId,
    bodyString: body === undefined ? "" : JSON.stringify(body)
  });
  return {
    "content-type": "application/json",
    "x-ixi-internal-signature-version": "v1",
    "x-ixi-internal-timestamp": timestamp,
    "x-ixi-internal-request-id": id,
    "x-ixi-internal-principal-id": principalId,
    "x-ixi-internal-entity-id": entityId,
    "x-ixi-internal-signature": crypto
      .createHmac("sha256", process.env.IXI_MOS_INTERNAL_SECRET)
      .update(canonical)
      .digest("hex"),
    ...(commandId ? { "idempotency-key": commandId } : {})
  };
}

async function request(baseUrl, { method = "POST", targetPath, principalId = "signed-owner", entityId = bootstrap.entity.entityId, body, commandId }) {
  const response = await fetch(`${baseUrl}${targetPath}`, {
    method,
    headers: signedHeaders({ method, targetPath, principalId, entityId, body, commandId }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: response.status, body: await response.json() };
}

test("signed workspace HTTP contract binds membership, ignores forged authority, and replays safely", async () => {
  const app = express();
  app.use(express.json());
  app.use("/mos/v1", mosRouter);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const frontendOnboarding = await request(baseUrl, {
      targetPath: "/mos/v1/aos/onboarding/bootstrap",
      principalId: "frontend-new-owner",
      entityId: "",
      body: {
        ownerUserId: "browser-value-is-not-authority",
        entityDisplayName: "Frontend Contract Entity",
        person: { displayName: "Frontend Owner" },
        metadata: { source: "authenticated-browser-gateway" }
      }
    });
    assert.equal(frontendOnboarding.status, 200);
    const frontendEntityId = frontendOnboarding.body.environment.entity.entityId;
    const contextCensusBefore = {
      objects: listObjects({ status: null }).length,
      passports: readPassportRecords().length
    };

    const frontendContext = await request(baseUrl, {
      method: "GET",
      targetPath: "/mos/v1/aos/context",
      principalId: "frontend-new-owner",
      entityId: ""
    });
    assert.equal(frontendContext.status, 200);
    assert.equal(frontendContext.body.context.principalId, "frontend-new-owner");
    assert.equal(frontendContext.body.context.entityId, frontendEntityId);
    assert.equal(
      frontendContext.body.context.accountId,
      frontendOnboarding.body.environment.account.accountId
    );
    assert.deepEqual(
      {
        objects: listObjects({ status: null }).length,
        passports: readPassportRecords().length
      },
      contextCensusBefore
    );

    let authorityPolicyReads = 0;
    authorityStore.getCurrentPolicyRecord = async () => {
      authorityPolicyReads += 1;
      return null;
    };

    const workBootstrap = await request(baseUrl, {
      method: "GET",
      targetPath: "/mos/v1/aos/work-bootstrap",
      principalId: "frontend-new-owner",
      entityId: ""
    });
    assert.equal(workBootstrap.status, 200);
    assert.equal(
      workBootstrap.body.workBootstrapVersion,
      "ixi.aos-work-bootstrap.v1"
    );
    assert.equal(workBootstrap.body.environment.entity.entityId, frontendEntityId);
    assert.equal(
      workBootstrap.body.admissions.length,
      workBootstrap.body.environment.objects.length
    );
    assert.deepEqual(
      new Set(workBootstrap.body.admissions.map(item => item.identity.objectId)),
      new Set(workBootstrap.body.environment.objects.map(item => item.objectId))
    );
    assert.deepEqual(
      {
        objects: listObjects({ status: null }).length,
        passports: readPassportRecords().length
      },
      contextCensusBefore
    );
    assert.ok(authorityPolicyReads > 0);
    assert.ok(
      authorityPolicyReads <= workBootstrap.body.environment.objects.length,
      `AOS Work bootstrap must read at most one Authority policy per visible Object; read ${authorityPolicyReads}`
    );
    authorityStore.getCurrentPolicyRecord = async () => null;

    const machineCommandId = "sharetribe-listing:frontend-listing-1";
    const frontendMachine = await request(baseUrl, {
      targetPath: "/mos/v1/aos/machines/sharetribe-listing",
      principalId: "frontend-new-owner",
      entityId: frontendEntityId,
      commandId: machineCommandId,
      body: {
        listing: {
          listingId: "frontend-listing-1",
          displayName: "Frontend Machine",
          channel: "private"
        }
      }
    });
    assert.equal(frontendMachine.status, 201);
    assert.equal(frontendMachine.body.object.metadata.creationBoundary, "authenticated-listing-admission.v1");
    assert.equal(frontendMachine.body.object.actorAuthority.canCreateObject, true);
    assert.equal(
      frontendMachine.body.passport.passportId,
      frontendMachine.body.object.identities.find(identity => identity.identityType === "ixi-passport").passportId
    );

    const importCommandId = "frontend-bulk-import-job-1";
    const importJob = await request(baseUrl, {
      targetPath: "/mos/v1/imports/jobs",
      principalId: "frontend-new-owner",
      entityId: frontendEntityId,
      commandId: importCommandId,
      body: {
        commandId: importCommandId,
        entityId: "browser-cannot-select-tenant",
        actorId: "browser-cannot-select-actor",
        sourceFile: {
          name: "import.csv",
          type: "text/csv",
          size: 100,
          fingerprint: "sha256:frontend-import-1"
        },
        rows: [{
          rowKey: "row-1",
          status: "ready",
          normalizedInput: {
            objectType: "customer-defined",
            displayName: "Imported Object"
          }
        }]
      }
    });
    assert.equal(importJob.status, 403);
    assert.equal(importJob.body.error.code, "IXI_ENTITY_BODY_MISMATCH");

    const governedImportBody = {
      commandId: importCommandId,
      sourceFile: {
        name: "import.csv",
        type: "text/csv",
        size: 100,
        fingerprint: "sha256:frontend-import-1"
      },
      rows: [{
        rowKey: "row-1",
        status: "ready",
        normalizedInput: {
          objectType: "customer-defined",
          displayName: "Imported Object"
        }
      }]
    };
    const governedImport = await request(baseUrl, {
      targetPath: "/mos/v1/imports/jobs",
      principalId: "frontend-new-owner",
      entityId: frontendEntityId,
      commandId: importCommandId,
      body: governedImportBody
    });
    assert.equal(governedImport.status, 201);
    assert.equal(governedImport.body.job.actorId, "frontend-new-owner");
    assert.equal(governedImport.body.job.entityId, frontendEntityId);
    const importRow = governedImport.body.job.rows[0];
    const executeCommandId = "frontend-bulk-import-execute-1";
    const executeBody = { commandId: executeCommandId };
    const executed = await request(baseUrl, {
      targetPath: `/mos/v1/imports/jobs/${governedImport.body.job.jobId}/rows/${importRow.rowId}/execute`,
      principalId: "frontend-new-owner",
      entityId: frontendEntityId,
      commandId: executeCommandId,
      body: executeBody
    });
    assert.equal(executed.status, 200);
    assert.match(executed.body.identity.objectId, /^object_/);
    assert.match(executed.body.identity.passportId, /^IXI/);

    const admission = await request(baseUrl, {
      targetPath: "/mos/v1/identity/admit",
      body: {
        objectId: object.objectId,
        passportId: object.identities[0].passportId,
        actorAuthority: { canDelete: false },
        permissions: []
      }
    });
    assert.equal(admission.status, 200);
    assert.equal(admission.body.object.actorAuthority.canCreateObject, true);
    assert.equal(admission.body.object.actorAuthority.canRelate, true);
    assert.equal(admission.body.object.actorAuthority.canDelete, true);
    assert.equal(admission.body.object.actorAuthority.canViewFinancialInformation, true);
    assert.equal(admission.body.object.authorityDecisions["aos.delete"].reason, "principal-direct-grant");

    const batchAdmission = await request(baseUrl, {
      targetPath: "/mos/v1/identity/admit-batch",
      body: {
        requests: [{
          objectId: object.objectId,
          passportId: object.identities[0].passportId,
          actorAuthority: { canDelete: false }
        }]
      }
    });
    assert.equal(batchAdmission.status, 200);
    assert.equal(batchAdmission.body.admissions.length, 1);
    assert.equal(batchAdmission.body.admissions[0].ok, true);
    assert.equal(batchAdmission.body.admissions[0].identity.objectId, object.objectId);
    assert.equal(batchAdmission.body.admissions[0].object.actorAuthority.canDelete, true);

    const openBody = {
      commandId: "http-open-session",
      workspaceId: "aos-work",
      placementScope: "personal",
      actorId: "forged-browser-actor",
      permissions: ["*"],
      capabilities: { canCreate: true }
    };
    const opened = await request(baseUrl, {
      targetPath: "/mos/v1/aos/workspace-sessions",
      body: openBody,
      commandId: openBody.commandId
    });
    assert.equal(opened.status, 201);
    assert.equal(opened.body.result.session.createdBy, "signed-owner");
    assert.equal(opened.body.result.session.tenantId, bootstrap.account.tenantId);

    const replay = await request(baseUrl, {
      targetPath: "/mos/v1/aos/workspace-sessions",
      body: openBody,
      commandId: openBody.commandId
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.result.session.sessionId, opened.body.result.session.sessionId);

    const conflictBody = { ...openBody, workspaceId: "different-workspace" };
    const conflict = await request(baseUrl, {
      targetPath: "/mos/v1/aos/workspace-sessions",
      body: conflictBody,
      commandId: openBody.commandId
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, "GOVERNED_COMMAND_REUSE_CONFLICT");

    const commandBody = {
      commandId: "http-admit-object",
      expectedRevision: 0,
      placementScope: "personal",
      actorId: "forged-browser-actor",
      payload: {
        objectId: object.objectId,
        surfaceId: "equipment",
        visualOrder: 0,
        operatingState: "tucked"
      },
      commandType: "object.admit"
    };
    const targetPath = `/mos/v1/aos/workspace-sessions/${opened.body.result.session.sessionId}/commands`;
    const admittedHeaders = signedHeaders({
      method: "POST",
      targetPath,
      principalId: "signed-owner",
      entityId: bootstrap.entity.entityId,
      body: commandBody,
      commandId: commandBody.commandId
    });
    admittedHeaders["if-match"] = "0";
    const admittedResponse = await fetch(`${baseUrl}${targetPath}`, {
      method: "POST",
      headers: admittedHeaders,
      body: JSON.stringify(commandBody)
    });
    const admitted = { status: admittedResponse.status, body: await admittedResponse.json() };
    assert.equal(admitted.status, 200);
    assert.equal(admitted.body.result.session.updatedBy, "signed-owner");
    assert.equal(admitted.body.result.session.objects[object.objectId].sessionOrigin.surfaceId, "equipment");

    const missingMembershipBody = { ...openBody, commandId: "missing-membership-open" };
    const missing = await request(baseUrl, {
      targetPath: "/mos/v1/aos/workspace-sessions",
      principalId: "not-a-member",
      body: missingMembershipBody,
      commandId: missingMembershipBody.commandId
    });
    assert.equal(missing.status, 403);
    assert.equal(missing.body.error.code, "IXI_AUTHORITY_MEMBERSHIP_REQUIRED");
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
});
