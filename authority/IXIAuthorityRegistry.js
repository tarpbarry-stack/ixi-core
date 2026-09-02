"use strict";

/*
 * IXI AUTHORITY REGISTRY
 *
 * Canonical enterprise capability vocabulary.
 *
 * Customer labels and object names NEVER
 * determine authority semantics.
 */

const CAPABILITIES =
  Object.freeze({

    /* AOS OBJECT GRAPH */

    "aos.discover": {
      family: "aos",
      label: "Discover object"
    },

    "aos.view": {
      family: "aos",
      label: "View object"
    },

    "aos.create": {
      family: "aos",
      label: "Create object"
    },

    "aos.edit": {
      family: "aos",
      label: "Edit object"
    },

    "aos.move": {
      family: "aos",
      label: "Move object"
    },

    "aos.archive": {
      family: "aos",
      label: "Archive object"
    },

    "aos.delete": {
      family: "aos",
      label: "Delete object"
    },


    /* TRANSACT */

    "transact.open": {
      family: "transact",
      label: "Open TRAN$ACT"
    },

    "transact.freight.view": {
      family: "freight",
      label: "View Freight Orders"
    },

    "transact.freight.create": {
      family: "freight",
      label: "Create Freight Orders"
    },

    "transact.freight.manage": {
      family: "freight",
      label: "Manage Freight Orders"
    },

    "transact.freight.dispatch": {
      family: "freight",
      label: "Dispatch Freight Orders"
    },

    "transact.freight.deliver": {
      family: "freight",
      label: "Complete Freight Delivery"
    },

    "transact.freight.reconcile": {
      family: "freight",
      label: "Reconcile Freight Orders"
    },

    "tickets.view": {
      family: "tickets",
      label: "View IXI Tickets"
    },

    "tickets.create": {
      family: "tickets",
      label: "Create IXI Tickets"
    },

    "tickets.manage": {
      family: "tickets",
      label: "Manage IXI Tickets"
    },

    "tickets.publish": {
      family: "tickets",
      label: "Publish IXI Tickets to GitHub"
    },

    "tickets.verify": {
      family: "tickets",
      label: "Verify and Close IXI Tickets"
    },


    "transact.work-order.view": {
      family: "work-order",
      label: "View Work Orders"
    },

    "transact.work-order.create": {
      family: "work-order",
      label: "Create Work Orders"
    },

    "transact.work-order.edit": {
      family: "work-order",
      label: "Edit Work Orders"
    },

    "transact.work-order.complete": {
      family: "work-order",
      label: "Complete Work Orders"
    },

    "transact.time.create": {
      family: "work",
      label: "Enter Time"
    },

    "transact.material.create": {
      family: "work",
      label: "Enter Materials"
    },

    "transact.expense.view": {
      family: "expense",
      label: "View Expenses"
    },

    "transact.expense.create": {
      family: "expense",
      label: "Create Expenses"
    },

    "transact.expense.approve": {
      family: "expense",
      label: "Approve Expenses"
    },

    "transact.purchase-order.view": {
      family: "purchasing",
      label: "View Purchase Orders"
    },

    "transact.purchase-order.create": {
      family: "purchasing",
      label: "Create Purchase Orders"
    },

    "transact.purchase-order.approve": {
      family: "purchasing",
      label: "Approve Purchase Orders"
    },

    "transact.bill.view": {
      family: "payables",
      label: "View Bills"
    },

    "transact.bill.create": {
      family: "payables",
      label: "Create Bills"
    },

    "transact.bill.approve": {
      family: "payables",
      label: "Approve Bills"
    },

    "transact.treasury.view": {
      family: "treasury",
      label: "View Treasury"
    },

    "transact.treasury.payment": {
      family: "treasury",
      label: "Execute Payments"
    },

    "transact.treasury.reconcile": {
      family: "treasury",
      label: "Reconcile Accounts"
    },

    "transact.gl.view": {
      family: "accounting",
      label: "View General Ledger"
    },

    "transact.gl.journal": {
      family: "accounting",
      label: "Post Journal"
    },

    "transact.gl.close": {
      family: "accounting",
      label: "Close Accounting Period"
    },

    "transact.financial-reporting.view": {
      family: "reporting",
      label: "View Financial Reporting"
    },


    /* SECURITY / AUTHORITY */

    "authority.view": {
      family: "authority",
      label: "View Access Policy"
    },

    "authority.manage": {
      family: "authority",
      label: "Manage Access Policy"
    },

    "identity.invite": {
      family: "identity",
      label: "Invite IXI User"
    },

    "identity.suspend": {
      family: "identity",
      label: "Suspend IXI User"
    }
  });


const SUBJECT_TYPES =
  Object.freeze([
    "principal",
    "role",
    "group",
    "entity-member",
    "all-authenticated"
  ]);


const SCOPE_TYPES =
  Object.freeze([
    "target",
    "target-and-descendants",
    "entity",
    "location",
    "selected-passports"
  ]);


function clean(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


function isRegisteredAuthorityCapability(
  capability
) {
  return Boolean(
    CAPABILITIES[
      clean(
        capability
      )
    ]
  );
}


function getAuthorityCapability(
  capability
) {
  return (
    CAPABILITIES[
      clean(
        capability
      )
    ] ||
    null
  );
}


module.exports = {
  CAPABILITIES,
  SUBJECT_TYPES,
  SCOPE_TYPES,

  isRegisteredAuthorityCapability,
  getAuthorityCapability
};
