"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
const { createAuthorityBatchReader, createPolicyReadQueue } = require("../../authority/IXIAuthorityBatchRead");
const graph = require("../../authority/IXIAuthorityGraphResolver");
// The batch boundary is real; only the graph fixture replaces disk discovery.
graph.resolveAuthorityGraph = target => ({ targetPassportId: target,
  ancestorPassportIds: ["parent", "root"] });
const store = require("../../authority/IXIAuthorityDynamoStore");
const { loadPolicy, resolveAuthorityPolicyChain, withAuthorityPolicyReadScope } = require("../../authority/IXIAuthorityPolicyResolver");
const tableName = store.TABLE_NAME;
const policyItem = (key, revision = 1) => ({ ...key, revision,
  policy: { policyId: key.PK, target: { passportId: key.PK.slice(7) }, rules: [],
    inheritance: { propagateToChildren: key.PK !== "POLICY#parent" } } });

test("200 targets share ancestor reads in three consistent batches, retaining specificity and inheritance", async t => {
  let active = 0, peak = 0;
  const requested = [];
  t.mock.method(DynamoDBDocumentClient.prototype, "send", async command => {
    assert.equal(command.constructor.name, "BatchGetCommand");
    const request = command.input.RequestItems[tableName];
    assert.equal(request.ConsistentRead, true);
    assert.ok(request.Keys.length <= 100);
    requested.push(request.Keys.map(key => key.PK));
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return { Responses: { [tableName]: request.Keys.map(key => policyItem(key)).reverse() } };
  });
  const targets = Array.from({ length: 200 }, (_, i) => `machine-${i}`);
  const chains = await withAuthorityPolicyReadScope(() => Promise.all(
    targets.flatMap(id => [resolveAuthorityPolicyChain(id), resolveAuthorityPolicyChain(id)])
  ));
  assert.equal(requested.length, 3);
  assert.equal(new Set(requested.flat()).size, 202);
  assert.equal(requested.flat().length, 202);
  assert.equal(peak, 2);
  chains.forEach((chain, i) => {
    assert.deepEqual(chain.chain.map(item => item.passportId), [targets[Math.floor(i / 2)], "root"]);
    assert.deepEqual(chain.chain.map(item => item.distance), [0, 2]);
  });
});

test("missing policies remain null; unprocessed keys retry, and incomplete or denied reads fail closed", async () => {
  const requests = [];
  const read = createAuthorityBatchReader({ tableName, wait: async () => {}, client: { async send(command) {
    const request = command.input.RequestItems[tableName]; requests.push(request.Keys);
    if (requests.length === 1) return { Responses: { [tableName]: [policyItem(request.Keys[0])] },
      UnprocessedKeys: { [tableName]: { Keys: request.Keys.slice(1) } } };
    return { Responses: { [tableName]: request.Keys.filter(key => key.PK !== "POLICY#missing").map(key => policyItem(key)) } };
  } } });
  const result = await read(["a", "missing", "b", "a"]);
  assert.deepEqual(result.map(item => item?.policy.target.passportId || null), ["a", null, "b"]);
  assert.deepEqual(requests.map(keys => keys.length), [3, 2]);
  let attempts = 0;
  const incomplete = createAuthorityBatchReader({ tableName, wait: async () => {}, client: { async send(command) {
    attempts++; return { UnprocessedKeys: command.input.RequestItems };
  } } });
  await assert.rejects(incomplete(["a"]), { code: "AUTHORITY_BATCH_READ_INCOMPLETE" });
  assert.equal(attempts, 5);
  const denied = createAuthorityBatchReader({ tableName, client: { async send() { throw new Error("denied"); } } });
  await assert.rejects(denied(["a"]), /denied/);
});

test("separate and concurrent scopes read fresh policy revisions; unscoped reads retain single Get", async t => {
  let revision = 0;
  const commands = [];
  t.mock.method(DynamoDBDocumentClient.prototype, "send", async command => {
    commands.push(command.constructor.name);
    if (command.constructor.name === "GetCommand") return { Item: policyItem(command.input.Key, ++revision) };
    return { Responses: { [tableName]: command.input.RequestItems[tableName].Keys.map(key => policyItem(key, ++revision)) } };
  });
  const reads = await Promise.all([withAuthorityPolicyReadScope(() => loadPolicy("same")),
    withAuthorityPolicyReadScope(() => loadPolicy("same"))]);
  assert.deepEqual(reads.map(item => item.record.revision), [1, 2]);
  assert.equal((await withAuthorityPolicyReadScope(() => loadPolicy("same"))).record.revision, 3);
  assert.equal((await loadPolicy("same")).record.revision, 4);
  assert.deepEqual(commands, ["BatchGetCommand", "BatchGetCommand", "BatchGetCommand", "GetCommand"]);
});

test("queued waves do not multiply concurrency and failed waves can retry without retaining data", async () => {
  let active = 0, peak = 0, calls = 0;
  const read = createPolicyReadQueue(async ids => {
    active++; peak = Math.max(peak, active); calls++;
    await new Promise(resolve => setImmediate(resolve));
    active--;
    if (ids.includes("fail")) throw new Error("controlled failure");
    return ids.map(id => ({ id }));
  });
  const first = read("a");
  await Promise.resolve();
  const second = read("b");
  assert.deepEqual(await Promise.all([first, second]), [{ id: "a" }, { id: "b" }]);
  assert.equal(peak, 1);
  assert.equal(calls, 2);
  await assert.rejects(read("fail"), /controlled failure/);
  assert.deepEqual(await read("a"), { id: "a" });
  const malformed = createPolicyReadQueue(async () => []);
  await assert.rejects(malformed("a"), /incomplete policy/);
});
