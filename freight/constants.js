"use strict";

const FREIGHT_SCHEMA =
  "ixi-freight-order-v2";

const FREIGHT_STATUS =
  Object.freeze({
    DRAFT: "draft",
    REQUESTED: "requested",
    AWARDED: "awarded",
    DISPATCHED: "dispatched",
    PICKED_UP: "picked-up",
    IN_TRANSIT: "in-transit",
    DELIVERED: "delivered",
    BILLED: "billed",
    RECONCILED: "reconciled",
    PAID: "paid",
    CLOSED: "closed",
    CANCELLED: "cancelled"
  });

const FREIGHT_MODE =
  Object.freeze({
    EXTERNAL_CARRIER:
      "external-carrier",

    INTERNAL_FLEET:
      "internal-fleet"
  });

const FREIGHT_PURPOSE =
  Object.freeze({
    ACQUISITION_INBOUND:
      "acquisition-inbound",

    SALE_PREPARATION:
      "sale-preparation",

    CUSTOMER_DELIVERY:
      "customer-delivery",

    YARD_TRANSFER:
      "yard-transfer",

    SERVICE_OUTBOUND:
      "service-outbound",

    SERVICE_RETURN:
      "service-return",

    AUCTION_MOVE:
      "auction-move",

    RENTAL_DELIVERY:
      "rental-delivery",

    RENTAL_RETURN:
      "rental-return",

    DEMO:
      "demo",

    INTERNAL_REPOSITION:
      "internal-reposition",

    OTHER:
      "other"
  });

module.exports = {
  FREIGHT_SCHEMA,
  FREIGHT_STATUS,
  FREIGHT_MODE,
  FREIGHT_PURPOSE
};
