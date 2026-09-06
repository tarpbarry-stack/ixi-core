"use strict";

const clean = (value) => String(value ?? "").trim();
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const money = (value) => Math.round(num(value) * 100) / 100;
const array = (value) => (Array.isArray(value) ? value : []);
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const INACTIVE = new Set([
  "draft",
  "submitted",
  "rejected",
  "void",
  "reversed",
  "cancelled",
]);
const COST_TYPES = new Set([
  "expense",
  "bill",
  "supplier-invoice",
  "work-order",
  "time-entry",
  "material-usage",
  "technology-work-order",
  "freight",
  "rental-expense",
]);
const INCOME_TYPES = new Set(["rental-income", "service-invoice"]);

function documentOf(value = {}) {
  const envelope = object(value.record || value);
  const document = object(
    envelope.financialDocument ||
      envelope.document?.financialDocument ||
      envelope.document ||
      envelope,
  );
  return {
    ...document,
    metadata: { ...object(envelope.metadata), ...object(document.metadata) },
  };
}
function amountOf(value = {}) {
  const source = documentOf(value);
  return money(
    source?.totals?.total ??
      source?.totals?.subtotal ??
      source.amount ??
      source.financial?.amount ??
      source.bill?.amount ??
      source.expense?.amount ??
      0,
  );
}
function typeOf(value = {}) {
  const source = documentOf(value);
  return clean(
    source.documentType || source.type || source.metadata?.transactModule,
  ).toLowerCase();
}
function active(value = {}) {
  return !INACTIVE.has(clean(documentOf(value).financialState).toLowerCase());
}
function referencesAsset(document, passportId, objectId) {
  return array(document.references).some(
    (ref) =>
      (passportId && clean(ref.passportId) === passportId) ||
      (objectId && clean(ref.externalId) === objectId),
  );
}
function total(rows = []) {
  return money(
    array(rows)
      .filter(
        (row) =>
          row?.included !== false &&
          !["void", "reversed", "cancelled"].includes(
            clean(row?.status).toLowerCase(),
          ),
      )
      .reduce((sum, row) => sum + num(row.finalAmount ?? row.amount), 0),
  );
}

function commissions(rows = [], basis = {}) {
  return array(rows).map((row, index) => {
    const method = clean(
      row.calculationMethod || row.basis || "fixed",
    ).toLowerCase();
    const basisAmount =
      method === "sale-price"
        ? basis.salePrice
        : method === "gross-profit"
          ? basis.grossProfit
          : method === "net-profit"
            ? basis.netProfit
            : method === "above-target"
              ? Math.max(0, basis.salePrice - num(row.targetAmount))
              : 0;
    const calculatedAmount = ["fixed", "manual"].includes(method)
      ? money(row.fixedAmount ?? row.amount)
      : money((basisAmount * num(row.ratePercent)) / 100);
    const finalAmount =
      row.finalApprovedAmount !== "" && row.finalApprovedAmount != null
        ? money(row.finalApprovedAmount)
        : money(Math.max(0, calculatedAmount + num(row.adjustmentAmount)));
    return {
      ...row,
      commissionId: clean(row.commissionId) || `COM-${index + 1}`,
      recipientLabel: clean(row.recipientLabel),
      recipientPassportId: clean(row.recipientPassportId),
      calculationMethod: method,
      basisAmount: money(basisAmount),
      calculatedAmount,
      finalAmount,
      economicTreatment: clean(
        row.economicTreatment || "machine-selling-expense",
      ),
      status: clean(row.status || "projected"),
      included:
        row.included !== false &&
        !["void", "reversed", "cancelled"].includes(
          clean(row.status).toLowerCase(),
        ),
    };
  });
}

function expenseLedger(documents, assetPassportId, assetObjectId) {
  return documents
    .map(documentOf)
    .map((source, index) => {
      if (!referencesAsset(source, assetPassportId, assetObjectId)) return null;
      const type = typeOf(source);
      const separate =
        source.metadata?.settlementCost ||
        source.metadata?.sellingCost ||
        source.settlementCost ||
        source.metadata?.commission;
      const cost =
        COST_TYPES.has(type) &&
        !source.metadata?.acquisitionCost &&
        !source.acquisitionCost &&
        !separate;
      const income =
        INCOME_TYPES.has(type) && source.metadata?.assetIncome !== false;
      if (!cost && !income) return null;
      const included = active(source);
      return {
        ledgerItemId:
          clean(source.financialDocumentId) || `${type}-${index + 1}`,
        financialDocumentId: clean(source.financialDocumentId),
        type,
        date: clean(source.occurredAt || source.date).slice(0, 10),
        label: clean(
          source.description ||
            source.memo ||
            source.documentNumber ||
            "FINANCIAL RECORD",
        ),
        amount: amountOf(source),
        direction: income ? "income" : "cost",
        state: clean(source.financialState).toLowerCase(),
        included,
        exclusionReason: included
          ? ""
          : `STATE ${clean(source.financialState).toUpperCase() || "UNKNOWN"} IS NOT ECONOMIC`,
        source: "canonical",
      };
    })
    .filter(Boolean);
}

function waterfall(owners, projection, record) {
  const normalized = array(owners).map((owner, index) => ({
    ...owner,
    ownerId: clean(owner.ownerId) || `OWNER-${index + 1}`,
    label: clean(owner.partyLabel || owner.label),
    settlementSharePercent: num(
      owner.settlementSharePercent ?? owner.legalOwnershipPercent,
    ),
    profitSharePercent: num(
      owner.profitSharePercent ??
        owner.settlementSharePercent ??
        owner.legalOwnershipPercent,
    ),
    lossSharePercent: num(
      owner.lossSharePercent ??
        owner.settlementSharePercent ??
        owner.legalOwnershipPercent,
    ),
    capitalOutstanding: money(owner.initialContribution),
  }));
  const capital = new Map(
    normalized.map((owner) => [owner.ownerId, owner.capitalOutstanding]),
  );
  for (const event of array(record.capitalEvents)) {
    const id = clean(event.ownerId);
    if (id)
      capital.set(
        id,
        money(
          num(capital.get(id)) +
            num(
              event.capitalDelta ??
                (["capital-return", "capital-withdrawal"].includes(
                  clean(event.type),
                )
                  ? -num(event.amount)
                  : num(event.amount)),
            ),
        ),
      );
  }
  const reimbursement = new Map(),
    prior = new Map();
  for (const row of array(record.reimbursements))
    if (row.included !== false && clean(row.status) !== "paid")
      reimbursement.set(
        clean(row.ownerId),
        money(num(reimbursement.get(clean(row.ownerId))) + num(row.amount)),
      );
  for (const row of array(record.priorDistributions))
    if (row.included !== false)
      prior.set(
        clean(row.ownerId),
        money(num(prior.get(clean(row.ownerId))) + num(row.amount)),
      );
  const capitalTotal = money(
      [...capital.values()].reduce((s, v) => s + Math.max(0, v), 0),
    ),
    reimbursementTotal = money(
      [...reimbursement.values()].reduce((s, v) => s + v, 0),
    ),
    retained = money(Math.max(0, num(record.retainedProceeds))),
    availableCash = money(
      Math.max(0, projection.cashAvailableBeforeOwners - retained),
    ),
    afterReimbursements = money(
      Math.max(0, availableCash - reimbursementTotal),
    ),
    economicLoss = money(Math.max(0, -projection.economicProfit));
  const profitTotal = normalized.reduce((s, o) => s + o.profitSharePercent, 0),
    lossTotal = normalized.reduce((s, o) => s + o.lossSharePercent, 0),
    capitalAfterLossTotal = money(
      normalized.reduce(
        (sum, owner) =>
          sum +
          Math.max(
            0,
            num(capital.get(owner.ownerId)) -
              (lossTotal
                ? (economicLoss * owner.lossSharePercent) / lossTotal
                : 0),
          ),
        0,
      ),
    ),
    capitalReturnPool =
      record.returnCapitalFirst === false
        ? 0
        : money(
            Math.min(
              afterReimbursements,
              economicLoss > 0 ? capitalAfterLossTotal : capitalTotal,
            ),
          ),
    residualProfitPool = money(
      Math.max(0, afterReimbursements - capitalReturnPool),
    );
  const rows = normalized.map((owner) => {
    const capitalOutstanding = money(capital.get(owner.ownerId)),
      allocatedLoss = lossTotal
        ? money((economicLoss * owner.lossSharePercent) / lossTotal)
        : 0,
      capitalAfterLoss = money(Math.max(0, capitalOutstanding - allocatedLoss)),
      capitalBasis = economicLoss > 0 ? capitalAfterLossTotal : capitalTotal,
      capitalWeight = economicLoss > 0 ? capitalAfterLoss : capitalOutstanding,
      capitalReturn = capitalBasis
        ? money((capitalReturnPool * capitalWeight) / capitalBasis)
        : 0,
      profitShare = profitTotal
        ? money((residualProfitPool * owner.profitSharePercent) / profitTotal)
        : 0,
      reimb = money(reimbursement.get(owner.ownerId)),
      priorPaid = money(prior.get(owner.ownerId)),
      finalDue = money(
        Math.max(0, reimb + capitalReturn + profitShare - priorPaid),
      ),
      lossShortfall = money(Math.max(0, allocatedLoss - capitalOutstanding));
    return {
      ...owner,
      capitalOutstanding,
      capitalAfterLoss,
      reimbursement: reimb,
      capitalReturn,
      profitShare,
      allocatedLoss,
      lossShortfall,
      priorDistributions: priorPaid,
      grossEntitlement: money(reimb + capitalReturn + profitShare),
      finalDue,
      paid: 0,
      balanceDue: finalDue,
    };
  });
  const totalFinalDue = money(rows.reduce((s, o) => s + o.finalDue, 0)),
    unallocatedCash = money(availableCash - totalFinalDue);
  return {
    shareTotal: money(
      normalized.reduce((s, o) => s + o.settlementSharePercent, 0),
    ),
    profitShareTotal: money(profitTotal),
    lossShareTotal: money(lossTotal),
    capitalTotal,
    capitalAfterLossTotal,
    reimbursementTotal,
    availableCash,
    retainedProceeds: retained,
    capitalReturnPool,
    residualProfitPool,
    economicLoss,
    totalLossShortfall: money(rows.reduce((s, o) => s + o.lossShortfall, 0)),
    capitalCallRequired: false,
    owners: rows,
    totalFinalDue,
    unallocatedCash,
    balanced: Math.abs(totalFinalDue + unallocatedCash - availableCash) < 0.01,
  };
}

function rebuildCanonicalSettlement({
  financialDocument = {},
  saleInvoice = {},
  documents = [],
} = {}) {
  const shell = documentOf(financialDocument),
    record = { ...object(shell.assetSettlement) },
    sale = documentOf(saleInvoice);
  const assetPassportId = clean(record.context?.assetPassportId),
    assetObjectId = clean(record.context?.assetObjectId);
  const related = array(documents)
    .map(documentOf)
    .filter(
      (doc) => documentEntity(doc) === clean(record.context?.entityPassportId),
    );
  const acquisitionDoc = related.find(
    (doc) =>
      typeOf(doc) === "asset-acquisition" &&
      referencesAsset(doc, assetPassportId, assetObjectId),
  );
  const acquisition = object(acquisitionDoc?.assetAcquisition);
  const invoiceId = clean(sale.financialDocumentId),
    salePrice = money(sale?.totals?.total ?? record.projection?.salePrice);
  const receipts = related.filter(
    (doc) =>
      typeOf(doc) === "payment" &&
      active(doc) &&
      clean(doc.paymentDirection) === "inflow" &&
      clean(doc.sourceFinancialDocumentId) === invoiceId,
  );
  const credits = related.filter(
    (doc) =>
      typeOf(doc) === "credit" &&
      active(doc) &&
      clean(doc.sourceFinancialDocumentId) === invoiceId,
  );
  const collected = money(receipts.reduce((s, x) => s + amountOf(x), 0)),
    credited = money(credits.reduce((s, x) => s + amountOf(x), 0));
  const ledger = expenseLedger(related, assetPassportId, assetObjectId),
    canonicalCosts = money(
      ledger
        .filter((x) => x.included && x.direction === "cost")
        .reduce((s, x) => s + x.amount, 0),
    ),
    assetIncome = money(
      ledger
        .filter((x) => x.included && x.direction === "income")
        .reduce((s, x) => s + x.amount, 0),
    );
  const acquisitionCost = money(
      acquisition?.acquisition?.currentAcquisitionBasis ??
        acquisition?.acquisition?.directAcquisitionCost,
    ),
    makeReadyCost = money(acquisition?.makeReady?.actualTotal),
    expenseAdjustments = array(record.expenseAdjustments),
    postAcquisitionCosts = money(canonicalCosts + total(expenseAdjustments)),
    netEconomicInvestment = money(
      acquisitionCost + makeReadyCost + postAcquisitionCosts - assetIncome,
    );
  const sellingCosts = money(record.projection?.sellingCosts),
    profitBeforeCommission = money(
      salePrice - sellingCosts - netEconomicInvestment,
    );
  const order = related.find(
    (doc) =>
      typeOf(doc) === "sales-order" &&
      clean(doc?.salesOrder?.identity?.dealId) ===
        clean(record.dealId || record?.identity?.dealId),
  );
  const commissionRows = array(record.commissions).length
      ? record.commissions
      : array(order?.salesOrder?.compensation?.commissions),
    calculated = commissions(commissionRows, {
      salePrice,
      grossProfit: profitBeforeCommission,
      netProfit: profitBeforeCommission,
    }),
    commissionTotal = money(
      calculated
        .filter((x) => x.included && x.economicTreatment !== "company-overhead")
        .reduce((s, x) => s + x.finalAmount, 0),
    );
  const lienPayoffs = total(record.liabilities),
    thirdPartyDisbursements = total(record.disbursements),
    priorDistributions = total(record.priorDistributions),
    economicProfit = money(
      salePrice - sellingCosts - commissionTotal - netEconomicInvestment,
    ),
    cashAvailableBeforeOwners = money(
      Math.max(
        0,
        collected -
          sellingCosts -
          commissionTotal -
          lienPayoffs -
          thirdPartyDisbursements -
          priorDistributions,
      ),
    );
  const projection = {
    salePrice,
    collected,
    credited,
    buyerBalance: money(Math.max(0, salePrice - collected - credited)),
    acquisitionCost,
    makeReadyCost,
    postAcquisitionCosts,
    assetIncome,
    netEconomicInvestment,
    sellingCosts,
    commissionTotal,
    lienPayoffs,
    thirdPartyDisbursements,
    priorDistributions,
    profitBeforeCommission,
    economicProfit,
    cashAvailableBeforeOwners,
    expenseLedger: ledger,
    expenseAdjustments,
    commissions: calculated,
  };
  const ownership = object(acquisition.ownership),
    calculatedWaterfall = waterfall(
      array(ownership.owners),
      projection,
      record,
    );
  return {
    ...shell,
    assetSettlement: {
      ...record,
      schema: "ixi-asset-settlement-v2",
      version: Math.max(1, num(record.version) || 1),
      projection,
      waterfall: calculatedWaterfall,
      commissions: calculated,
      controls: {
        ...object(record.controls),
        canonicalCalculation: true,
        calculationVersion: "settlement-v2",
        canonicalCalculatedAt: new Date().toISOString(),
        sourceDocumentIds: [
          invoiceId,
          clean(acquisitionDoc?.financialDocumentId),
          ...receipts.map((x) => x.financialDocumentId),
          ...credits.map((x) => x.financialDocumentId),
        ].filter(Boolean),
      },
    },
    metadata: {
      ...object(shell.metadata),
      settlementSchema: "ixi-asset-settlement-v2",
      canonicalCalculation: true,
    },
  };
}

function documentEntity(document = {}) {
  const source = documentOf(document);
  return clean(
    source.assetAcquisition?.context?.entityPassportId ||
      source.assetSettlement?.context?.entityPassportId ||
      source.invoice?.context?.entityPassportId ||
      array(source.references).find((ref) => clean(ref.role) === "entity")
        ?.passportId,
  );
}

module.exports = {
  rebuildCanonicalSettlement,
  documentOf,
  amountOf,
  active,
  commissions,
};
