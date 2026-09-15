"use strict";
const assert = require("node:assert/strict"),
  test = require("node:test"),
  fs = require("fs"),
  os = require("os"),
  path = require("path");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ixi-trades-"));
process.env.IXI_MOS_DATA_ROOT = path.join(root, "mos");
process.env.IXI_PASSPORT_DATA_FILE = path.join(root, "passports.json");
process.env.IXI_MOS_STORAGE_PROVIDER = "sqlite";
const {
  ensureCommercialOnboarding,
} = require("../onboarding/aosCommercialOnboardingService");
const {
  provisionSharetribeMachine,
} = require("../onboarding/sharetribeMachineProvisioningService");
const service = require("../onboarding/tradeMachineService");
const { readPassportRecords } = require("../../passport/passportRegistry");
const { listRelationships } = require("../relationships/relationshipService");
const {
  normalizeSalesTrades,
} = require("../../financial/IXIFinancialTradeContract");
const {
  createSalesOrderDocument,
} = require("../../financial/IXIFinancialSalesOrderFactory");
const owner = ensureCommercialOnboarding({
  ownerUserId: "dealer",
  entityDisplayName: "Trade dealer",
});
const entityId = owner.entity.entityId,
  principalId = "dealer";
const outgoing = provisionSharetribeMachine({
  entityId,
  principalId,
  commandId: "outgoing",
  creationBoundary: "post-free",
  listing: {
    listingId: "outgoing-listing",
    displayName: "Loader",
    fields: { serialNumber: "OUT001" },
  },
});
function input(tradeId) {
  return {
    entityId,
    principalId,
    dealId: "deal-example",
    outgoingPassportId: outgoing.passport.passportId,
    tradeId,
    machine: {
      year: "2019",
      make: "Mahindra",
      model: "6075",
      hours: "0",
      serialNumber: `SERIAL-${tradeId}`,
    },
    allowanceCents: 2061900,
  };
}
function complete(request) {
  return service.completeTradeMachine({
    ...request,
    listing: {
      listingId: `listing-${request.tradeId}`,
      displayName: "Trade machine",
      fields: request.machine,
      channel: "private",
      state: "draft",
      ownership: { role: "prospective-owner", status: "pending" },
    },
  });
}
test("one create reservation survives replay and changed payloads are rejected", () => {
  const request = input("trade-first");
  assert.equal(service.reserveTradeMachine(request).createGranted, true);
  assert.equal(service.reserveTradeMachine(request).createGranted, false);
  assert.throws(
    () => service.reserveTradeMachine({ ...request, allowanceCents: 1 }),
    /different details/,
  );
  const saved = complete(request),
    count = readPassportRecords().length;
  assert.equal(complete(request).row.passportId, saved.row.passportId);
  assert.equal(readPassportRecords().length, count);
  assert.equal(
    listRelationships({ entityId, sourceObjectId: saved.row.objectId }).length,
    0,
  );
});
test("two trades and additional trades retain distinct Passports and exact aggregate allowance", () => {
  const trades = ["trade-two", "trade-three", "trade-four"].map((id) => {
    const req = input(id);
    service.reserveTradeMachine(req);
    const row = complete(req).row;
    return { ...row, ...row.machine, allowance: row.allowanceCents / 100 };
  });
  const record = {
    identity: { dealId: "deal-example" },
    context: {
      primaryPassportId: outgoing.passport.passportId,
      entityPassportId: owner.passports.entityPassportId,
    },
    asset: { passportId: outgoing.passport.passportId },
    trades,
    totals: { subtotal: 126238 },
  };
  assert.equal(new Set(trades.map((row) => row.passportId)).size, 3);
  assert.equal(normalizeSalesTrades(record).totals.total, 64381);
  assert.equal(
    createSalesOrderDocument({ salesOrder: record }).salesOrder.trades.length,
    3,
  );
  assert.throws(
    () => normalizeSalesTrades({ ...record, trades: [trades[0], trades[0]] }),
    /unique machine/,
  );
  assert.throws(
    () =>
      service.verifiedOrderTrades({
        ...record,
        trades: [{ ...trades[0], allowance: 1 }],
      }),
    /must match/,
  );
});
test("acquisition confirmation rejects unverified documents and wrong machine lineage", async () => {
  const req = input("trade-acq");
  service.reserveTradeMachine(req);
  const row = complete(req).row;
  const provider = require("../../financial/IXIFinancialProviderService"),
    original = provider.getDocument;
  try {
    provider.getDocument = async () => ({
      ok: true,
      data: {
        record: {
          financialDocument: {
            documentType: "asset-acquisition",
            financialState: "incurred",
            assetAcquisition: { context: { primaryPassportId: "wrong" } },
          },
        },
      },
    });
    await assert.rejects(
      service.confirmTradeAcquisition({ ...req, acquisitionId: "acq01" }),
      /matching recorded/,
    );
    provider.getDocument = async () => ({
      ok: true,
      data: {
        record: {
          financialDocument: {
            documentType: "asset-acquisition",
            financialState: "incurred",
            occurredAt: "2026-01-05",
            assetAcquisition: {
              context: {
                primaryPassportId: row.passportId,
                entityPassportId: owner.passports.entityPassportId,
              },
              trade: { tradeId: row.tradeId, dealId: row.dealId },
            },
          },
        },
      },
    });
    const acquired = await service.confirmTradeAcquisition({
      ...req,
      acquisitionId: "acq01",
    });
    assert.equal(acquired.row.status, "acquired");
    assert.equal(acquired.row.inventoryStatus, "pending");
    await assert.rejects(
      service.confirmTradeAcquisition({ ...req, acquisitionId: "acq02" }),
      /already has/,
    );
  } finally {
    provider.getDocument = original;
  }
});
test("definite listing rejection permits one new attempt; lost responses cannot be released", () => {
  const req = input("trade-reject"),
    first = service.reserveTradeMachine(req);
  assert.throws(
    () =>
      service.rejectTradeListingCreate({
        ...req,
        attemptId: first.row.attemptId,
        statusCode: 500,
      }),
    /ambiguous/,
  );
  service.rejectTradeListingCreate({
    ...req,
    attemptId: first.row.attemptId,
    statusCode: 422,
  });
  const next = service.reserveTradeMachine(req);
  assert.equal(next.createGranted, true);
  assert.notEqual(next.row.attemptId, first.row.attemptId);
  assert.equal(service.reserveTradeMachine(req).createGranted, false);
});
test("financial writes verify the saved order and permanent acquisition identity", async () => {
  const req = input("trade-write");
  service.reserveTradeMachine(req);
  const row = complete(req).row;
  const {
    assertFinancialTradeLinks,
    tradeAcquisitionId,
  } = require("../../financial/IXIFinancialTradeContract");
  const trade = {
    ...row.machine,
    tradeId: row.tradeId,
    passportId: row.passportId,
    objectId: row.objectId,
    listingId: row.listingId,
    allowance: 20619,
  };
  const order = {
    identity: { dealId: req.dealId },
    context: {
      entityPassportId: owner.passports.entityPassportId,
      primaryPassportId: req.outgoingPassportId,
    },
    trades: [trade],
    totals: { subtotal: 100000, total: 79381, tradeAllowance: 20619 },
  };
  const invoice = {
    documentType: "invoice",
    sourceFinancialDocumentId: "order",
    totals: { total: 79381 },
    metadata: {
      trades: [trade],
      dealId: req.dealId,
      tradeContext: order.context,
    },
  };
  const load = async () => ({ financialDocument: { salesOrder: order } });
  await assertFinancialTradeLinks(invoice, load);
  await assert.rejects(
    assertFinancialTradeLinks({ ...invoice, totals: { total: 100000 } }, load),
    /net amount/,
  );
  const acq = {
    context: { ...order.context, primaryPassportId: row.passportId },
    acquisition: { purchasePrice: 20619 },
    trade: { tradeId: row.tradeId, dealId: row.dealId },
  };
  const document = {
    documentType: "asset-acquisition",
    financialDocumentId: tradeAcquisitionId(acq),
    sourceFinancialDocumentId: "order",
    assetAcquisition: acq,
  };
  await assertFinancialTradeLinks(document, load);
  await assert.rejects(
    assertFinancialTradeLinks(
      { ...document, financialDocumentId: "ifd_duplicate" },
      load,
    ),
    /permanent acquisition/,
  );
  await assert.rejects(
    assertFinancialTradeLinks(
      {
        ...document,
        assetAcquisition: {
          ...acq,
          context: {
            ...acq.context,
            primaryPassportId: req.outgoingPassportId,
          },
        },
      },
      load,
    ),
    /machine/,
  );
});
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
