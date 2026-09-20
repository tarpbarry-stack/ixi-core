"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createFinancialBatchReader } = require("./IXIFinancialBatchRead");

const tableName = "test-financial";
function recordsFor(keys) {
  return keys.map(key => ({ ...key, record: { financialDocumentId: key.PK.slice(4) } })).reverse();
}

test("350 current documents use four batches with at most two in flight and preserve index order", async () => {
  let active = 0, peak = 0, calls = 0;
  const read = createFinancialBatchReader({ tableName, client: { async send(command) {
    assert.equal(command.constructor.name, "BatchGetCommand");
    const request = command.input.RequestItems[tableName];
    assert.equal(request.ConsistentRead, true);
    assert.ok(request.Keys.length <= 100);
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return { Responses: { [tableName]: recordsFor(request.Keys) } };
  } } });
  const ids = Array.from({ length: 350 }, (_, i) => `doc-${i}`);
  assert.deepEqual((await read(ids)).map(record => record.financialDocumentId), ids);
  assert.equal(calls, 4);
  assert.equal(peak, 2);
});

test("empty, duplicate, missing and unordered keys do not duplicate records or shift their identity", async () => {
  let calls = 0;
  const read = createFinancialBatchReader({ tableName, client: { async send(command) {
    calls++;
    const keys = command.input.RequestItems[tableName].Keys;
    assert.deepEqual(keys.map(key => key.PK), ["FIN#a", "FIN#missing", "FIN#b"]);
    return { Responses: { [tableName]: recordsFor(keys.filter(key => key.PK !== "FIN#missing")) } };
  } } });
  assert.deepEqual(await read([]), []);
  assert.equal(calls, 0);
  assert.deepEqual(await read(["a", "missing", " b ", "a", "", null]), [
    { financialDocumentId: "a" }, null, { financialDocumentId: "b" }
  ]);
  assert.equal(calls, 1);
});

test("partial batches retry only unprocessed keys, with backoff and consistent reads", async () => {
  const requests = [], waits = [];
  const read = createFinancialBatchReader({ tableName, wait: async ms => waits.push(ms), random: () => 0,
    client: { async send(command) {
      const request = command.input.RequestItems[tableName]; requests.push(request);
      if (requests.length === 1) return {
        Responses: { [tableName]: recordsFor(request.Keys.slice(0, 1)) },
        UnprocessedKeys: { [tableName]: { Keys: request.Keys.slice(1) } }
      };
      return { Responses: { [tableName]: recordsFor(request.Keys) } };
    } }
  });
  assert.deepEqual((await read(["a", "b", "c"])).map(record => record.financialDocumentId), ["a", "b", "c"]);
  assert.deepEqual(requests.map(request => request.Keys.length), [3, 2]);
  assert.ok(requests.every(request => request.ConsistentRead));
  assert.deepEqual(waits, [50]);
});

test("exhausted partial reads fail closed; errors are not converted into empty balances", async () => {
  let calls = 0;
  const read = createFinancialBatchReader({ tableName, wait: async () => {}, client: { async send(command) {
    calls++;
    return { UnprocessedKeys: command.input.RequestItems };
  } } });
  await assert.rejects(read(["a"]), { code: "FINANCIAL_BATCH_READ_INCOMPLETE" });
  assert.equal(calls, 5);
  const denied = Object.assign(new Error("denied"), { name: "AccessDeniedException" });
  const deniedRead = createFinancialBatchReader({ tableName, client: { async send() { throw denied; } } });
  await assert.rejects(deniedRead(["a"]), error => error === denied);
});

test("each collection obtains fresh records and keeps overlapping calls isolated", async () => {
  let revision = 0;
  const read = createFinancialBatchReader({ tableName, client: { async send(command) {
    const version = ++revision;
    return { Responses: { [tableName]: recordsFor(command.input.RequestItems[tableName].Keys)
      .map(item => ({ ...item, record: { ...item.record, version } })) } };
  } } });
  const [first, second] = await Promise.all([read(["a"]), read(["a"])]);
  assert.equal(first[0].version, 1);
  assert.equal(second[0].version, 2);
  assert.equal((await read(["a"]))[0].version, 3);
});

test("real entity and Passport collection adapters retain their indexes and batch current records", async t => {
  const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
  const store = require("./IXIFinancialDynamoStore");
  const adapter = require("./IXIFinancialDynamoPersistenceAdapter");
  const ids = Array.from({ length: 283 }, (_, i) => `doc-${i}`);
  const indexCalls = [];
  t.mock.method(store, "getEntityDocumentIds", async scope => { indexCalls.push(["entity", scope]); return ids; });
  t.mock.method(store, "getPassportDocumentIds", async scope => { indexCalls.push(["passport", scope]); return ids; });
  let calls = 0;
  t.mock.method(DynamoDBDocumentClient.prototype, "send", async command => {
    assert.equal(command.constructor.name, "BatchGetCommand", "collection must not restore one Get per record");
    calls++;
    return { Responses: { [store.TABLE_NAME]: recordsFor(command.input.RequestItems[store.TABLE_NAME].Keys) } };
  });
  assert.deepEqual((await adapter.listFinancialDocumentsByEntity("company-passport")).map(r => r.financialDocumentId), ids);
  assert.deepEqual((await adapter.listFinancialDocumentsByPassport("machine-passport")).map(r => r.financialDocumentId), ids);
  assert.deepEqual(indexCalls, [["entity", "company-passport"], ["passport", "machine-passport"]]);
  assert.equal(calls, 6);
});
