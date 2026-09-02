"use strict";


class IXIIdentityError
  extends Error {
  constructor(
    code,
    message,
    details = {},
    statusCode = 400
  ) {
    super(message);

    this.name =
      "IXIIdentityError";

    this.code =
      String(
        code ||
        "IXI_IDENTITY_ERROR"
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


function identityError(
  code,
  message,
  details = {},
  statusCode = 400
) {
  return new IXIIdentityError(
    code,
    message,
    details,
    statusCode
  );
}


module.exports = {
  IXIIdentityError,
  identityError
};
