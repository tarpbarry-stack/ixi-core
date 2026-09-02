"use strict";

class TicketError extends Error {
  constructor(
    code,
    message,
    details = {},
    status = 400
  ) {
    super(message);

    this.name = "TicketError";
    this.code = String(code || "TICKET_ERROR");
    this.details =
      details && typeof details === "object"
        ? details
        : {};
    this.status =
      Number.isInteger(status)
        ? status
        : 400;
  }
}

module.exports = {
  TicketError
};
