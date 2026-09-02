"use strict";

/*
 * IXI FINANCIAL DOCUMENT IDENTITY
 *
 * Storage-neutral Financial Document identity helpers.
 */

function clean(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


function safeArray(
  value
) {
  return Array.isArray(
    value
  )
    ? value
    : [];
}


function safeObject(
  value
) {
  return (
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(
      value
    )
  )
    ? value
    : {};
}


/* =========================================================
   PASSPORT REFERENCE COLLECTION
   ========================================================= */

function collectDocumentPassportIds(
  financialDocument = {}
) {
  const document =
    safeObject(
      financialDocument
    );

  const passportIds =
    new Set();


  function collect(
    references
  ) {
    safeArray(
      references
    ).forEach(
      reference => {
        const passportId =
          clean(
            reference
              ?.passportId
          );

        if (
          passportId
        ) {
          passportIds.add(
            passportId
          );
        }
      }
    );
  }


  collect(
    document.references
  );


  safeArray(
    document.lines
  ).forEach(
    line => {
      collect(
        line?.references
      );
    }
  );


  return Array.from(
    passportIds
  );
}


module.exports = {
  collectDocumentPassportIds
};
