"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync, spawn } = require("node:child_process");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "aos-create-recovery-"));
process.env.IXI_MOS_DATA_ROOT = path.join(root, "mos");
process.env.IXI_MOS_STORAGE_PROVIDER = "sqlite";
process.env.IXI_PASSPORT_DATA_FILE = path.join(root, "passports.json");
const { createEntity } = require("../entities/entityService");
const objects = require("../objects/objectService");
const { provisionAosObject } = require("../provisioning/aosObjectProvisioningService");
const creation = require("../provisioning/aosCreationCommandService");
const relationships = require("../relationships/relationshipService");
const { readJsonFile, writeJsonFileAtomic } = require("../storage/jsonStore");
const { MOS_PATHS } = require("../storage/mosPaths");
const entity = createEntity({ displayName: "Creation contract", actorId: "owner" });
const principal = { entityId: entity.entityId, principalId: "owner" };
const authorize = async object => assert.equal(object.entityId, principal.entityId);
const policy = { schema: "aos.system-index-membership.v1", enabled: true, defaultWorkspaceHome: false,
  allowedObjectTypes: ["person"], allowedDefinitionIds: [] };
const parent = provisionAosObject({ commandId: "parent", entityId: entity.entityId, actorId: "owner",
  objectType: "system-index", displayName: "Customer workforce name", metadata: { systemIndexMembershipPolicy: policy } });
const input = id => ({ commandId: id, draftId: `aos-draft:${id}`, entityId: entity.entityId,
  objectType: "person", displayName: "New colleague", membership: {
    parentObjectId: parent.object.objectId, parentPassportId: parent.passport.passportId } });
const census = () => ({ objects: objects.listObjects({ entityId: entity.entityId }).map(o => o.objectId),
  passports: fs.readFileSync(process.env.IXI_PASSPORT_DATA_FILE, "utf8"), relationships: relationships.listRelationships({ entityId: entity.entityId }) });
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("wrong child classification is rejected before durable identity or command creation", async () => {
  const before = census();
  await assert.rejects(creation.createAndAttachAosObject({ ...input("wrong"), objectType: "machine" }, { principal, authorize }),
    { code: "AOS_SYSTEM_INDEX_MEMBER_REJECTED" });
  assert.deepEqual(census(), before);
  assert.equal(readJsonFile(MOS_PATHS.idempotency, {}).wrong, undefined);
  const corrected = await creation.createAndAttachAosObject(input("wrong"), { principal, authorize });
  assert.equal(corrected.creation.relationship.targetObjectId, parent.object.objectId);
});

test("new roots require explicit configuration while ordinary card appearance adds no structural role", () => {
  const before = census();
  assert.throws(() => objects.createObject({ entityId: entity.entityId, displayName: "New index", objectType: "system-index" }),
    { code: "AOS_SYSTEM_INDEX_MEMBERSHIP_POLICY_REQUIRED" });
  assert.deepEqual(census(), before);
  const ordinary = objects.prepareObjectForCreation({ entityId: entity.entityId, displayName: "Ordinary",
    objectType: "person", cardTemplateSlug: "ixi-system-index-v1" });
  assert.equal(ordinary.objectType, "person");
  assert.deepEqual(census(), before);
});

test("parent authority and Passport failures leave no saved child", async () => {
  const before = census();
  await assert.rejects(creation.createAndAttachAosObject(input("denied"), { principal,
    authorize: async () => { throw Object.assign(new Error("Denied"), { statusCode: 403 }); } }));
  await assert.rejects(creation.createAndAttachAosObject({ ...input("bad-passport"), membership: {
    ...input("bad-passport").membership, parentPassportId: "IXIWRONG123" } }, { principal, authorize }));
  assert.deepEqual(census(), before);
});

test("customer definition is resolved before creation, including its required fields", async () => {
  const { createCustomerObjectType } = require("../objects/customerObjectTypeService");
  const definition = createCustomerObjectType({ entityId: entity.entityId, label: "Customer defined crew",
    actorId: "owner", fieldSchema: [{ field: "crewCode", label: "Crew code", required: true, type: "text" }] });
  const definitionParent = provisionAosObject({ commandId: "definition-parent", entityId: entity.entityId,
    objectType: "system-index", displayName: "Crews", actorId: "owner", metadata: {
      systemIndexMembershipPolicy: { ...policy, allowedObjectTypes: [], allowedDefinitionIds: [definition.definitionId] } } });
  const request = { ...input("defined"), definitionKey: definition.definitionKey, objectType: "machine",
    membership: { parentObjectId: definitionParent.object.objectId, parentPassportId: definitionParent.passport.passportId } };
  const before = census();
  await assert.rejects(creation.createAndAttachAosObject(request, { principal, authorize }));
  assert.deepEqual(census(), before);
  const created = await creation.createAndAttachAosObject({ ...request, fields: { crewCode: "CREW-1" } }, { principal, authorize });
  assert.equal(created.object.definitionId, definition.definitionId);
  assert.equal(created.object.objectType, "generic");
  assert.equal(created.creation.relationship.targetObjectId, definitionParent.object.objectId);
});

test("changed parent policy cannot turn a retained invalid child into an accepted member", async t => {
  const stub = t.mock.method(relationships, "createObjectRelationship", () => { throw new Error("Temporary failure"); });
  await assert.rejects(creation.createAndAttachAosObject(input("policy-change"), { principal, authorize }));
  stub.mock.restore();
  const original = objects.getObject(parent.object.objectId);
  objects.updateObject({ objectId: original.objectId, expectedRevision: original.revision, commandId: "policy-change-1",
    metadata: { systemIndexMembershipPolicy: { ...policy, allowedObjectTypes: ["location"] } } });
  const before = census();
  await assert.rejects(creation.resumeAosCreation({ commandId: "policy-change", principal, authorize }),
    { code: "AOS_SYSTEM_INDEX_MEMBER_REJECTED" });
  assert.deepEqual(census(), before);
  const changed = objects.getObject(original.objectId);
  objects.updateObject({ objectId: original.objectId, expectedRevision: changed.revision, commandId: "policy-change-2",
    metadata: { systemIndexMembershipPolicy: policy } });
  await creation.resumeAosCreation({ commandId: "policy-change", principal, authorize });
  assert.deepEqual(census().objects, before.objects);
});

test("concurrent requests share one lease and cannot create parallel identities", async () => {
  const results = await Promise.allSettled([
    creation.createAndAttachAosObject(input("concurrent"), { principal, authorize }),
    creation.createAndAttachAosObject(input("concurrent"), { principal, authorize })
  ]);
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  const success = results.find(item => item.status === "fulfilled").value;
  const before = census();
  const retry = await creation.createAndAttachAosObject(input("concurrent"), { principal, authorize });
  assert.equal(retry.object.objectId, success.object.objectId);
  assert.deepEqual(census(), before);
});

test("attachment failure resumes the same identity and survives response replay", async t => {
  const original = relationships.createObjectRelationship;
  const stub = t.mock.method(relationships, "createObjectRelationship", () => { throw new Error("Attachment storage unavailable"); });
  await assert.rejects(creation.createAndAttachAosObject(input("retry"), { principal, authorize }), error => {
    assert.ok(error.details.creation.objectId); return true;
  });
  stub.mock.restore();
  assert.equal(relationships.createObjectRelationship, original);
  const savedBefore = census();
  const pending = await creation.listAosCreationCommands({ principal, authorize });
  assert.ok(pending.some(item => item.commandId === "retry" && item.state === "failed"));
  const recovered = await creation.resumeAosCreation({ commandId: "retry", principal, authorize });
  assert.deepEqual(census().objects, savedBefore.objects);
  assert.equal(census().passports, savedBefore.passports);
  const after = census();
  const replay = await creation.createAndAttachAosObject(input("retry"), { principal, authorize });
  assert.equal(replay.object.objectId, recovered.object.objectId);
  assert.equal(replay.passport.passportId, recovered.passport.passportId);
  assert.deepEqual(census(), after);
  assert.equal(relationships.listRelationships({ entityId: entity.entityId }).filter(r =>
    r.sourceObjectId === recovered.object.objectId && r.status === "active").length, 1);
  await assert.rejects(creation.createAndAttachAosObject({ ...input("retry"), displayName: "Changed after save" }, { principal, authorize }),
    { code: "AOS_CREATION_PAYLOAD_CONFLICT" });
  await assert.rejects(creation.resumeAosCreation({ commandId: "retry", principal: { ...principal, principalId: "other" }, authorize }),
    { code: "AOS_CREATION_NOT_FOUND" });
  await creation.acknowledgeAosCreation({ commandId: "retry", principal, authorize });
  assert.equal((await creation.listAosCreationCommands({ principal, authorize })).some(item => item.commandId === "retry"), false);
});

test("process exit after Passport creation resumes after the lease expires without duplicate identity", async () => {
  const cwd = path.resolve(__dirname, "../..");
  const killed = spawnSync(process.execPath, ["-e", `
    require('./mos/relationships/relationshipService').createObjectRelationship = () => process.exit(76);
    require('./mos/provisioning/aosCreationCommandService').createAndAttachAosObject(${JSON.stringify(input("restart"))},
      { principal: ${JSON.stringify(principal)}, authorize: async () => {} }).catch(e => { console.error(e); process.exit(1); });
  `], { cwd, env: process.env, encoding: "utf8" });
  assert.equal(killed.status, 76, killed.stderr);
  const before = census();
  await assert.rejects(creation.resumeAosCreation({ commandId: "restart", principal, authorize }), { code: "AOS_CREATION_PROCESSING" });
  const commands = readJsonFile(MOS_PATHS.idempotency, {});
  commands.restart.leaseUntil = Date.now() - 1;
  writeJsonFileAtomic(MOS_PATHS.idempotency, commands);
  const restarted = spawnSync(process.execPath, ["-e", `
    require('./mos/provisioning/aosCreationCommandService').resumeAosCreation({ commandId: 'restart',
      principal: ${JSON.stringify(principal)}, authorize: async () => {} }).then(r => console.log(r.object.objectId)).catch(e => { console.error(e); process.exit(1); });
  `], { cwd, env: process.env, encoding: "utf8" });
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.deepEqual(census().objects, before.objects);
  assert.equal(census().passports, before.passports);
  const childId = restarted.stdout.trim();
  assert.equal(census().relationships.filter(r => r.sourceObjectId === childId && r.status === "active").length, 1);
});

test("an expired worker cannot create a second Object after another process finishes its reserved identity", { timeout: 10000 }, async t => {
  const readyFile = path.join(root, "worker-ready"), resumeFile = path.join(root, "worker-resume");
  const cwd = path.resolve(__dirname, "../..");
  const worker = spawn(process.execPath, ["-e", `
    const fs = require('node:fs');
    const objects = require('./mos/objects/objectService');
    const create = objects.createObject;
    objects.createObject = (...args) => {
      fs.writeFileSync(${JSON.stringify(readyFile)}, 'ready');
      const lock = new Int32Array(new SharedArrayBuffer(4));
      while (!fs.existsSync(${JSON.stringify(resumeFile)})) Atomics.wait(lock, 0, 0, 10);
      return create(...args);
    };
    require('./mos/provisioning/aosCreationCommandService').createAndAttachAosObject(${JSON.stringify(input("expired-worker"))},
      { principal: ${JSON.stringify(principal)}, authorize: async () => {} }).then(() => process.exit(1)).catch(() => process.exit(74));
  `], { cwd, env: process.env, stdio: "ignore" });
  t.after(() => { if (worker.exitCode === null) worker.kill(); });
  const exited = new Promise(resolve => worker.on("exit", code => resolve(code)));
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(readyFile) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(fs.existsSync(readyFile), "Worker reached the controlled point before Object creation");
  const commands = readJsonFile(MOS_PATHS.idempotency, {});
  commands["expired-worker"].leaseUntil = Date.now() - 1;
  writeJsonFileAtomic(MOS_PATHS.idempotency, commands);
  const saved = await creation.resumeAosCreation({ commandId: "expired-worker", principal, authorize });
  const before = census();
  fs.writeFileSync(resumeFile, "resume");
  assert.equal(await exited, 74);
  assert.deepEqual(census(), before);
  assert.equal(readJsonFile(MOS_PATHS.idempotency, {})["expired-worker:identity"].status, "completed");
  const retry = await creation.resumeAosCreation({ commandId: "expired-worker", principal, authorize });
  assert.equal(retry.object.objectId, saved.object.objectId);
});
