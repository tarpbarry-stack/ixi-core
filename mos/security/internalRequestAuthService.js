"use strict";

const crypto =
  require("crypto");

const {
  MOS_PATHS
} = require(
  "../storage/mosPaths"
);

const {
  readJsonFile,
  writeJsonFileAtomic
} = require(
  "../storage/jsonStore"
);

const {
  MosError
} = require(
  "../errors/MosError"
);


const SIGNATURE_VERSION =
  "v1";

const MAX_CLOCK_SKEW_MS =
  60 * 1000;

const REPLAY_RETENTION_MS =
  10 * 60 * 1000;


function clean(value) {
  return String(
    value ?? ""
  ).trim();
}


function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}


function normalizeBodyString(
  req
) {
  if (
    req.body === undefined ||
    req.body === null
  ) {
    return "";
  }

  /*
   * Vercel signs the exact JSON string it sends.
   * JSON.parse / JSON.stringify preserves object
   * property insertion order for our generated
   * request envelopes.
   */
  return JSON.stringify(
    req.body
  );
}


function getCanonicalTargetPath(
  req
) {
  const originalUrl =
    clean(
      req.originalUrl ||
      req.url
    );

  if (!originalUrl) {
    return "";
  }

  /*
   * The mounted router receives:
   *
   * /mos/v1/...
   *
   * The Vercel signer signs that complete
   * MOS path including its query string.
   */
  return originalUrl;
}


function buildCanonicalRequest({
  timestamp,
  requestId,
  method,
  targetPath,
  principalId,
  entityId,
  bodyString
}) {
  return [
    timestamp,
    requestId,
    clean(method)
      .toUpperCase(),
    targetPath,
    principalId,
    entityId,
    sha256(bodyString)
  ].join("\n");
}


function getSecret() {
  return clean(
    process.env
      .IXI_MOS_INTERNAL_SECRET
  );
}


function isEnforcementEnabled() {
  return (
    clean(
      process.env
        .IXI_MOS_INTERNAL_AUTH_ENFORCE
    ).toLowerCase() ===
      "true"
  );
}


function readReplayStore() {
  const stored =
    readJsonFile(
      MOS_PATHS.internalAuthReplay,
      {}
    );

  return (
    stored &&
    typeof stored === "object" &&
    !Array.isArray(stored)
  )
    ? stored
    : {};
}


function writeReplayStore(
  store
) {
  writeJsonFileAtomic(
    MOS_PATHS.internalAuthReplay,
    store
  );
}


function pruneReplayStore(
  store,
  now = Date.now()
) {
  const next = {};

  Object.entries(
    store || {}
  ).forEach(
    ([requestId, record]) => {
      const createdAt =
        Number(
          record?.createdAtMs || 0
        );

      if (
        createdAt > 0 &&
        now - createdAt <=
          REPLAY_RETENTION_MS
      ) {
        next[requestId] =
          record;
      }
    }
  );

  return next;
}


function assertFreshRequestId({
  requestId,
  timestamp
}) {
  const now =
    Date.now();

  let store =
    pruneReplayStore(
      readReplayStore(),
      now
    );

  if (
    store[
      requestId
    ]
  ) {
    throw new MosError(
      "IXI_INTERNAL_REQUEST_REPLAYED",
      "Internal IXI request ID has already been used.",
      {
        requestId
      },
      409
    );
  }

  store[
    requestId
  ] = {
    requestId,
    timestamp,
    createdAtMs:
      now
  };

  writeReplayStore(
    store
  );
}


function verifyInternalRequest(
  req
) {
  const version =
    clean(
      req.headers[
        "x-ixi-internal-signature-version"
      ]
    );

  const timestamp =
    clean(
      req.headers[
        "x-ixi-internal-timestamp"
      ]
    );

  const requestId =
    clean(
      req.headers[
        "x-ixi-internal-request-id"
      ]
    );

  const principalId =
    clean(
      req.headers[
        "x-ixi-internal-principal-id"
      ]
    );

  const entityId =
    clean(
      req.headers[
        "x-ixi-internal-entity-id"
      ]
    );

  const suppliedSignature =
    clean(
      req.headers[
        "x-ixi-internal-signature"
      ]
    ).toLowerCase();

  const secret =
    getSecret();


  if (!secret) {
    throw new MosError(
      "IXI_INTERNAL_AUTH_NOT_CONFIGURED",
      "IX-Core internal request authentication is not configured.",
      null,
      503
    );
  }


  if (
    version !==
      SIGNATURE_VERSION
  ) {
    throw new MosError(
      "IXI_INTERNAL_SIGNATURE_VERSION_INVALID",
      "Internal IXI signature version is invalid.",
      {
        suppliedVersion:
          version || null
      },
      401
    );
  }


  if (
    !timestamp ||
    !requestId ||
    !principalId ||
    !suppliedSignature
  ) {
    throw new MosError(
      "IXI_INTERNAL_AUTH_HEADERS_REQUIRED",
      "Required IXI internal authentication headers are missing.",
      null,
      401
    );
  }


  const timestampMs =
    Number(timestamp);

  if (
    !Number.isFinite(
      timestampMs
    )
  ) {
    throw new MosError(
      "IXI_INTERNAL_TIMESTAMP_INVALID",
      "Internal IXI request timestamp is invalid.",
      null,
      401
    );
  }


  const now =
    Date.now();

  if (
    Math.abs(
      now -
      timestampMs
    ) >
    MAX_CLOCK_SKEW_MS
  ) {
    throw new MosError(
      "IXI_INTERNAL_TIMESTAMP_EXPIRED",
      "Internal IXI request timestamp is outside the allowed clock window.",
      {
        requestId
      },
      401
    );
  }


  if (
    !/^[a-f0-9]{64}$/.test(
      suppliedSignature
    )
  ) {
    throw new MosError(
      "IXI_INTERNAL_SIGNATURE_INVALID",
      "Internal IXI request signature is invalid.",
      null,
      401
    );
  }


  const bodyString =
    normalizeBodyString(
      req
    );

  const targetPath =
    getCanonicalTargetPath(
      req
    );

  const canonical =
    buildCanonicalRequest({
      timestamp,
      requestId,
      method:
        req.method,
      targetPath,
      principalId,
      entityId,
      bodyString
    });


  const expected =
    crypto
      .createHmac(
        "sha256",
        secret
      )
      .update(
        canonical
      )
      .digest("hex");


  const valid =
    crypto.timingSafeEqual(
      Buffer.from(
        expected,
        "hex"
      ),
      Buffer.from(
        suppliedSignature,
        "hex"
      )
    );


  if (!valid) {
    throw new MosError(
      "IXI_INTERNAL_SIGNATURE_INVALID",
      "Internal IXI request signature is invalid.",
      {
        requestId
      },
      401
    );
  }


  /*
   * Replay ID is consumed only after the
   * cryptographic request has verified.
   */
  assertFreshRequestId({
    requestId,
    timestamp
  });


  return {
    authenticated:
      true,

    signatureVersion:
      SIGNATURE_VERSION,

    requestId,

    timestamp,

    principalId,

    entityId:
      entityId || null,

    targetPath,

    authenticatedAt:
      new Date()
        .toISOString()
  };
}


function createInternalAuthMiddleware() {
  return function internalAuthMiddleware(
    req,
    res,
    next
  ) {
    /*
     * Installation mode:
     *
     * verifier exists and can be tested,
     * but live requests are not blocked
     * until deployment is coordinated.
     */
    if (
      !isEnforcementEnabled()
    ) {
      req.ixiInternalAuth = {
        authenticated:
          false,

        enforcement:
          false
      };

      return next();
    }


    try {
      const context =
        verifyInternalRequest(
          req
        );

      req.ixiInternalAuth = {
        ...context,

        enforcement:
          true
      };

      return next();

    } catch (error) {
      const status =
        Number(
          error?.statusCode ||
          error?.status ||
          401
        );

      return res
        .status(status)
        .json({
          ok: false,

          error: {
            code:
              error?.code ||
              "IXI_INTERNAL_AUTH_FAILED",

            message:
              error?.message ||
              "IXI internal authentication failed.",

            details:
              error?.details ||
              null
          }
        });
    }
  };
}


module.exports = {
  SIGNATURE_VERSION,
  MAX_CLOCK_SKEW_MS,
  REPLAY_RETENTION_MS,

  sha256,
  normalizeBodyString,
  getCanonicalTargetPath,
  buildCanonicalRequest,

  isEnforcementEnabled,

  verifyInternalRequest,
  createInternalAuthMiddleware
};
