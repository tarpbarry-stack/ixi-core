const {
  cleanText
} = require("../util/normalize");

const {
  MosError
} = require("../errors/MosError");


function isLoopbackRequest(req) {
  const address =
    cleanText(
      req.socket?.remoteAddress ||
      req.connection?.remoteAddress
    );

  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address ===
      "::ffff:127.0.0.1"
  );
}


function readCanonicalInternalContext(req) {
  const context =
    req?.ixiRequestContext;

  if (
    !context ||
    context.authenticated !== true
  ) {
    return null;
  }

  const principalId =
    cleanText(
      context.principalId
    );

  const entityId =
    cleanText(
      context.entityId
    );

  if (
    !principalId ||
    !entityId
  ) {
    return null;
  }

  return {
    authenticated: true,

    source:
      cleanText(
        context.source
      ) ||
      "ixi-internal-signature",

    principalId,
    entityId,

    requestId:
      cleanText(
        context.requestId
      ) || null
  };
}


function readTrustedServerContext(req) {
  /*
   * IMPORTANT:
   *
   * These headers are NOT accepted merely
   * because the browser sent them.
   *
   * Production use requires the request to
   * have passed through the trusted IXI
   * server/proxy boundary and carry the
   * server-only bridge secret.
   *
   * Localhost has a separate explicit test
   * path below.
   */

  const configuredSecret =
    cleanText(
      process.env
        .IXI_FACE_BRIDGE_SECRET
    );

  const suppliedSecret =
    cleanText(
      req.headers[
        "x-ixi-face-bridge-secret"
      ]
    );

  if (
    !configuredSecret ||
    !suppliedSecret ||
    suppliedSecret !==
      configuredSecret
  ) {
    return null;
  }

  const principalId =
    cleanText(
      req.headers[
        "x-ixi-principal-id"
      ]
    );

  const entityId =
    cleanText(
      req.headers[
        "x-ixi-entity-id"
      ]
    );

  if (
    !principalId ||
    !entityId
  ) {
    return null;
  }

  return {
    authenticated: true,
    source:
      "ixi-server-bridge",

    principalId,
    entityId
  };
}


function readLocalTestContext(req) {
  const testEnabled =
    cleanText(
      process.env
        .IXI_FACE_LOCAL_TEST
    ) === "1";

  if (
    !testEnabled ||
    !isLoopbackRequest(req)
  ) {
    return null;
  }

  const principalId =
    cleanText(
      req.headers[
        "x-ixi-test-principal-id"
      ]
    );

  const entityId =
    cleanText(
      req.headers[
        "x-ixi-test-entity-id"
      ]
    );

  if (
    !principalId ||
    !entityId
  ) {
    return null;
  }

  return {
    authenticated: true,
    source:
      "localhost-test",

    principalId,
    entityId
  };
}


function requireFaceRequestContext(
  req
) {
  const context =
    readCanonicalInternalContext(req) ||
    readTrustedServerContext(req) ||
    readLocalTestContext(req);

  if (!context) {
    throw new MosError(
      "FACE_AUTHENTICATION_REQUIRED",
      "Authenticated IXI Face Library context is required.",
      null,
      401
    );
  }

  return context;
}


module.exports = {
  readCanonicalInternalContext,
  requireFaceRequestContext
};
