"use strict";
// Isolated integration check. Never uses AWS credentials or a cloud endpoint.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { DynamoDBClient, CreateTableCommand, ListTablesCommand } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, TransactWriteCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { createSaleBalanceTransactionItems, createInventoryTransactionItems, TABLE_NAME } = require("../financial/IXIFinancialDynamoStore");

async function main() {
  const localRoot = process.argv[2];
  if (!localRoot) throw new Error("Pass the verified DynamoDB Local directory. This check cannot target AWS.");
  const server = spawn("java", [`-Djava.library.path=${path.join(localRoot, "DynamoDBLocal_lib")}`, "-jar", path.join(localRoot, "DynamoDBLocal.jar"), "-inMemory", "-sharedDb", "-disableTelemetry", "-port", "8934"], { stdio: "ignore" });
  const raw = new DynamoDBClient({ region: "us-east-2", endpoint: "http://127.0.0.1:8934", credentials: { accessKeyId: "LOCALTESTONLY", secretAccessKey: "LOCALTESTONLY" }, maxAttempts: 1 });
  const client = DynamoDBDocumentClient.from(raw);
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { await raw.send(new ListTablesCommand({})); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    if (!ready) throw new Error("Isolated DynamoDB Local did not start.");
    await raw.send(new CreateTableCommand({ TableName: TABLE_NAME, BillingMode: "PAY_PER_REQUEST", KeySchema: [{ AttributeName: "PK", KeyType: "HASH" }, { AttributeName: "SK", KeyType: "RANGE" }], AttributeDefinitions: [{ AttributeName: "PK", AttributeType: "S" }, { AttributeName: "SK", AttributeType: "S" }, { AttributeName: "GSI1PK", AttributeType: "S" }, { AttributeName: "GSI1SK", AttributeType: "S" }], GlobalSecondaryIndexes: [{ IndexName: "GSI1", KeySchema: [{ AttributeName: "GSI1PK", KeyType: "HASH" }, { AttributeName: "GSI1SK", KeyType: "RANGE" }], Projection: { ProjectionType: "ALL" } }] }));
    const record = (id, amount, controls) => ({ financialDocument: { financialDocumentId: id, documentType: "credit", totals: { total: amount }, metadata: controls }, server: { entityPassportId: "IXITESTENTITY" } });
    const write = (source, items) => client.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: TABLE_NAME, Item: { PK: `DOC#${source.financialDocument.financialDocumentId}`, SK: "CURRENT", record: source }, ConditionExpression: "attribute_not_exists(PK)" } }, ...items
    ] }));
    const creditControl = { sourceId: "sale-1", kind: "credit", limitCents: 100000, baselineCents: 0 };
    const credits = [record("credit-a", 600, { saleBalanceControl: creditControl }), record("credit-b", 600, { saleBalanceControl: creditControl })];
    const attempts = await Promise.allSettled(credits.map(source => write(source, createSaleBalanceTransactionItems({ record: source }))));
    assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(attempts.find(result => result.status === "rejected").reason.name, "TransactionCanceledException");
    const guard = await client.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: "SALE-BALANCE#IXITESTENTITY#sale-1", SK: "credit" }, ConsistentRead: true }));
    assert.equal(guard.Item.usedCents, 60000);
    const losingId = attempts[0].status === "rejected" ? "credit-a" : "credit-b";
    assert.equal((await client.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: `DOC#${losingId}`, SK: "CURRENT" }, ConsistentRead: true }))).Item, undefined);
    const replayIndex = attempts.findIndex(result => result.status === "fulfilled");
    await assert.rejects(write(credits[replayIndex], createSaleBalanceTransactionItems({ record: credits[replayIndex] })), { name: "TransactionCanceledException" });
    assert.equal((await client.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: "SALE-BALANCE#IXITESTENTITY#sale-1", SK: "credit" } }))).Item.usedCents, 60000);
    const refunds = ["a", "b"].map(id => record(`refund-${id}`, 600, {
      saleBalanceControl: { sourceId: `credit-${id}`, kind: "refund", limitCents: 60000, baselineCents: 0 },
      saleCashRefundControl: { sourceId: "sale-cash", kind: "cash-refund", limitCents: 100000, baselineCents: 0 }
    }));
    const refunded = await Promise.allSettled(refunds.map(source => write(source, createSaleBalanceTransactionItems({ record: source }))));
    assert.equal(refunded.filter(result => result.status === "fulfilled").length, 1);
    const sales = ["sale-a", "sale-b"].map(id => record(id, 1000, { inventoryMutation: { commandId: id, passportId: "IXITESTMACHINE", state: "sold", previousSaleId: "", effectiveDate: "2026-02-01", recordedAt: "2026-09-15T12:00:00Z" } }));
    const sold = await Promise.allSettled(sales.map(source => write(source, createInventoryTransactionItems({ record: source }))));
    assert.equal(sold.filter(result => result.status === "fulfilled").length, 1);
    // Exercise the actual HTTP router, provider normalization, audit records,
    // Passport indexes and revisioned storage against the same isolated database.
    const send = DynamoDBDocumentClient.prototype.send;
    DynamoDBDocumentClient.prototype.send = function(command) { return send.call(client, command); };
    let httpServer;
    try {
      const express = require("express");
      const provider = require("../financial/IXIFinancialProviderService");
      const { createInvoiceDocument } = require("../financial/IXIFinancialInvoiceFactory");
      const { createPaymentDocument } = require("../financial/IXIFinancialPaymentFactory");
      const entity = "IXIHTTPENTITY", machine = "IXIHTTPMACHINE";
      const references = [{ role: "entity", passportId: entity }, { role: "asset", passportId: machine }];
      const invoice = createInvoiceDocument({ financialDocumentId: "ifd_http_sale", documentNumber: "INV-ISOLATED", amount: 10000, currency: "USD", financialState: "billed", occurredAt: "2026-02-01", references });
      const payment = createPaymentDocument({ financialDocumentId: "ifd_http_receipt", amount: 10000, currency: "USD", financialState: "paid", paymentDirection: "inflow", occurredAt: "2026-02-01", sourceFinancialDocumentId: invoice.financialDocumentId, references });
      for (const financialDocument of [invoice, payment]) {
        const result = await provider.createDocument({ financialDocument, entityPassportId: entity, actorPassportId: "IXIHTTPACTOR", commandId: financialDocument.financialDocumentId, idempotencyKey: financialDocument.financialDocumentId });
        assert.equal(result.ok, true, JSON.stringify(result));
      }
      const app = express(); app.use(express.json());
      app.use((req, res, next) => {
        req.ixiIdentity = { authenticatedUserId: "isolated-user", actorPassportId: "IXIHTTPACTOR", entityPassportId: entity, trustedInternal: true };
        req.trustedFinancialAccess = { actorPassportId: "IXIHTTPACTOR", entityPassportId: entity, roles: ["financial-admin"], managedPassportIds: [entity, machine] };
        req.ixiInternalAuth = { requestId: "isolated-http" }; next();
      }); app.use("/financial", require("../financial/IXIFinancialRoutes"));
      httpServer = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
      const http = async (url, method = "GET", body) => {
        const response = await fetch(`http://127.0.0.1:${httpServer.address().port}/financial${url}`, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
        const result = await response.json(); assert.equal(result.ok, true, JSON.stringify(result)); return result;
      };
      const saleRecord = { status: "sold", identity: { saleId: invoice.financialDocumentId, financialInvoiceId: invoice.financialDocumentId }, context: { assetPassportId: machine, entityPassportId: entity }, sale: { saleDate: "2026-02-01", machineSalePrice: 9500, buyerLabel: "Isolated buyer" }, audit: {} };
      const closed = await http(`/documents/${invoice.financialDocumentId}`, "PATCH", { commandId: "http-close-command", idempotencyKey: "http-close-command", expectedRevision: 1, patch: { status: "closed", financialState: "collected", metadata: { ...invoice.metadata, assetSale: true, assetSaleRecord: saleRecord } } });
      assert.equal((await http("/inventory?all=1")).data.current[machine].state, "sold");
      const actionUrl = `/inventory/sales/${invoice.financialDocumentId}`;
      const credit = await http(`${actionUrl}/adjustment`, "POST", { commandId: "http-credit-command", kind: "return", amount: 10000, effectiveDate: "2026-02-02", reason: "Full return in isolated test" });
      const creditId = credit.data.record.financialDocument.financialDocumentId;
      assert.equal(credit.data.record.financialDocument.assetSaleAdjustment.kind, "return");
      await http(`${actionUrl}/refund`, "POST", { commandId: "http-refund-command", creditId, amount: 10000, effectiveDate: "2026-02-03", paymentMethod: "wire", reference: "ISOLATED-TEST-ONLY" });
      const returned = await http(`${actionUrl}/return`, "POST", { commandId: "http-return-command", creditId, expectedRevision: closed.data.record.server.revision, machineReturned: true, effectiveDate: "2026-02-03", reason: "Machine physically returned in isolated test" });
      assert.equal(returned.data.record.financialDocument.metadata.assetSaleRecord.sale.machineSalePrice, 9500);
      const after = (await http("/inventory?all=1")).data;
      assert.equal(after.current[machine].state, "owned");
      assert.equal(after.sales[0].refundDue, 0);
      const readBack = await provider.getDocument({ financialDocumentId: invoice.financialDocumentId });
      assert.equal(readBack.data.record.server.revision, 3);
      console.log(JSON.stringify({ ok: true, fullPath: "HTTP → provider → DynamoDB → inventory response", sale: "sold", return: "owned/private", originalInvoiceRevisions: 3, refundDue: 0, cloudWrites: 0 }));
    } finally {
      DynamoDBDocumentClient.prototype.send = send;
      if (httpServer) await new Promise(resolve => httpServer.close(resolve));
    }
    console.log(JSON.stringify({ ok: true, database: "DynamoDB Local", checks: ["concurrent credits bounded", "losing write rolled back", "retry cannot charge twice", "refunds bounded by actual cash", "concurrent machine sale rejected"], cloudWrites: 0 }));
  } finally { raw.destroy(); server.kill("SIGTERM"); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
