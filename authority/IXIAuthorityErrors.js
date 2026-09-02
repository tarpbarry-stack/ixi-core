"use strict";

class IXIAuthorityError extends Error {
  constructor(
    code,
    message,
    details = {},
    statusCode = 400
  ) {
    super(message);

    this.name =
      "IXIAuthorityError";

    this.code =
      String(
        code ||
        "IXI_AUTHORITY_ERROR"
      );

    this.details =
      details &&
      typeof details === "object"
        ? details
        : {};

    this.statusCode =
      Number(statusCode) ||
      400;
  }
}

function authorityError(
  code,
  message,
  details = {},
  statusCode = 400
) {
  return new IXIAuthorityError(
    code,
    message,
    details,
    statusCode
  );
}

module.exports = {
  IXIAuthorityError,
  authorityError
};
