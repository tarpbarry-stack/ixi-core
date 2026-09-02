"use strict";

const {
  listIntegrityEntityIds,
  loadObjects,
  loadPassports,
  loadProvisioningRecords
} = require(
  "./liveCreationIntegrityAdapter"
);


/*
 * Optional external alert hook.
 *
 * The worker itself always writes the
 * durable local alert spool first.
 *
 * If no URL exists, stdout/stderr + the
 * spool remain the operational evidence.
 */
async function emitAlert(
  alert
) {
  const url =
    String(
      process.env
        .IXI_AOS_CREATION_INTEGRITY_ALERT_URL ||
      ""
    ).trim();

  if (!url) {
    console.error(
      "IXI_CREATION_INTEGRITY_ALERT",
      JSON.stringify(alert)
    );

    return {
      accepted: true,
      transport:
        "local-spool"
    };
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      10000
    );

  try {
    const headers = {
      "content-type":
        "application/json"
    };

    const token =
      String(
        process.env
          .IXI_AOS_CREATION_INTEGRITY_ALERT_TOKEN ||
        ""
      ).trim();

    if (token) {
      headers.authorization =
        `Bearer ${token}`;
    }

    const response =
      await fetch(
        url,
        {
          method:
            "POST",

          headers,

          body:
            JSON.stringify(
              alert
            ),

          signal:
            controller.signal
        }
      );

    if (!response.ok) {
      const error =
        new Error(
          `Integrity alert endpoint returned HTTP ${response.status}.`
        );

      error.code =
        "INTEGRITY_ALERT_HTTP_FAILED";

      throw error;
    }

    return {
      accepted: true,
      transport:
        "http"
    };
  } finally {
    clearTimeout(
      timeout
    );
  }
}


module.exports = {
  listEntityIds:
    listIntegrityEntityIds,

  loadObjects,
  loadPassports,
  loadProvisioningRecords,

  emitAlert
};
