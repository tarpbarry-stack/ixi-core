"use strict";

/*
 * IXI FINANCIAL STORAGE PROVIDER
 *
 * PURPOSE
 * -------
 *
 * One provider-selection seam for Financial
 * persistence.
 *
 *
 * AVAILABLE PROVIDERS
 * -------------------
 *
 * dynamodb
 *
 *
 * DEFAULT
 * -------
 *
 * dynamodb
 *
 *
 * IMPORTANT
 * ---------
 *
 * Production Financial persistence is DynamoDB.
 *
 * There is no silent local persistence fallback.
 *
 * IXI_FINANCIAL_STORAGE_PROVIDER may remain explicit,
 * but an unsupported value fails closed.
 */


const dynamoPersistence =
  require(
    "./IXIFinancialDynamoPersistenceAdapter"
  );


/* =========================================================
   PROVIDERS
   ========================================================= */

const PROVIDERS = {
  dynamodb:
    dynamoPersistence
};


/* =========================================================
   HELPERS
   ========================================================= */

function clean(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


/* =========================================================
   PROVIDER ID
   ========================================================= */

function getConfiguredFinancialStorageProviderId() {
  const configured =
    clean(
      process.env
        .IXI_FINANCIAL_STORAGE_PROVIDER ||
      "dynamodb"
    )
      .toLowerCase();


  if (
    !PROVIDERS[
      configured
    ]
  ) {
    throw new Error(
      `Unsupported IXI Financial storage provider: ${configured}`
    );
  }


  return configured;
}


/* =========================================================
   PROVIDER
   ========================================================= */

function getFinancialStorageProvider(
  providerId = ""
) {
  const id =
    clean(
      providerId
    )
      .toLowerCase() ||
    getConfiguredFinancialStorageProviderId();


  const provider =
    PROVIDERS[
      id
    ];


  if (
    !provider
  ) {
    throw new Error(
      `Unsupported IXI Financial storage provider: ${id}`
    );
  }


  return provider;
}


/* =========================================================
   DESCRIPTION
   ========================================================= */

function describeFinancialStorageProvider(
  providerId = ""
) {
  const id =
    clean(
      providerId
    )
      .toLowerCase() ||
    getConfiguredFinancialStorageProviderId();


  const provider =
    getFinancialStorageProvider(
      id
    );


  return {
    providerId:
      id,

    async:
      id ===
        "dynamodb",

    availableMethods:
      [
        "getFinancialDocumentRecord",
        "getFinancialDocumentHistory",
        "createFinancialDocument",
        "replaceFinancialDocument",
        "listFinancialDocumentsByPassport",
        "getFinancialPersistenceHealth"
      ].filter(
        methodName =>
          typeof provider[
            methodName
          ] ===
            "function"
      )
  };
}


/* =========================================================
   EXPORTS
   ========================================================= */

module.exports = {
  PROVIDERS,

  getConfiguredFinancialStorageProviderId,

  getFinancialStorageProvider,

  describeFinancialStorageProvider
};
