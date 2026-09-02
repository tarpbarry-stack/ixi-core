"use strict";

class FreightError extends Error {
  constructor(
    code,
    message,
    details = {},
    status = 400
  ) {
    super(message);

    this.name = "FreightError";

    this.code =
      String(
        code ||
        "FREIGHT_ERROR"
      );

    this.details =
      details &&
      typeof details === "object"
        ? details
        : {};

    this.status =
      Number(status) || 400;
  }
}

module.exports = {
  FreightError
};
