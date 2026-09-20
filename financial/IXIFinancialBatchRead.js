"use strict";
const { createCurrentRecordBatchReader } = require("../storage/IXIDynamoCurrentRead");
function createFinancialBatchReader(options) {
  return createCurrentRecordBatchReader({ ...options, keyPrefix: "FIN#",
    valueForItem: item => item.record || null,
    errorCode: "FINANCIAL_BATCH_READ_INCOMPLETE",
    errorMessage: "Financial collection could not be read completely; please retry." });
}
module.exports = { createFinancialBatchReader };
