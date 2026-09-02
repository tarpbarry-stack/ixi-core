"use strict";

const {
  getFinancialStorageProvider
} =
  require(
    "./IXIFinancialStorageProvider"
  );

const {
  buildFinancialGLProjection
} =
  require(
    "./IXIFinancialGLProjectionEngine"
  );


function clean(value) {
  return String(
    value ??
    ""
  ).trim();
}


async function getFinancialGLProjection({
  entityPassportId = "",
  period = "",
  currency = "USD"
} = {}) {

  const resolvedEntityPassportId =
    clean(
      entityPassportId
    );


  if (!resolvedEntityPassportId) {
    throw new Error(
      "Financial GL projection requires entityPassportId."
    );
  }


  const provider =
    getFinancialStorageProvider();


  if (
    typeof provider
      .listFinancialDocumentsByEntity !==
        "function"
  ) {
    throw new Error(
      "Financial storage provider does not support Entity document reads."
    );
  }


  const records =
    await provider
      .listFinancialDocumentsByEntity(
        resolvedEntityPassportId
      );


  return {
    entityPassportId:
      resolvedEntityPassportId,

    storageProvider:
      "dynamodb",

    projection:
      buildFinancialGLProjection({
        records,
        period,
        currency
      })
  };
}


module.exports = {
  getFinancialGLProjection
};
