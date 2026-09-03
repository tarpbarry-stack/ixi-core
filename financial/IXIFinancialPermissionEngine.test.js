"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  IXI_FINANCIAL_ACTIONS,
  IXI_FINANCIAL_ROLES,
  ROLE_PERMISSIONS
} = require("./IXIFinancialPermissionEngine");

test("journal posting is segregated to accounting control roles", () => {
  const post = IXI_FINANCIAL_ACTIONS.POST_JOURNAL;

  assert.equal(ROLE_PERMISSIONS[IXI_FINANCIAL_ROLES.EMPLOYEE].includes(post), false);
  assert.equal(ROLE_PERMISSIONS[IXI_FINANCIAL_ROLES.MANAGER].includes(post), false);
  assert.equal(ROLE_PERMISSIONS[IXI_FINANCIAL_ROLES.ACCOUNTING].includes(post), true);
  assert.equal(ROLE_PERMISSIONS[IXI_FINANCIAL_ROLES.CONTROLLER].includes(post), true);
  assert.equal(ROLE_PERMISSIONS[IXI_FINANCIAL_ROLES.ADMIN].includes(post), true);
});

test("period close is segregated from journal preparation", () => {
  const close = IXI_FINANCIAL_ACTIONS.CLOSE_PERIOD;

  assert.equal(ROLE_PERMISSIONS[IXI_FINANCIAL_ROLES.ACCOUNTING].includes(close), false);
  assert.equal(ROLE_PERMISSIONS[IXI_FINANCIAL_ROLES.CONTROLLER].includes(close), true);
  assert.equal(ROLE_PERMISSIONS[IXI_FINANCIAL_ROLES.ADMIN].includes(close), true);
});

test("accounting can read canonical GL and reports without close authority", () => {
  const permissions = ROLE_PERMISSIONS[IXI_FINANCIAL_ROLES.ACCOUNTING];

  assert.equal(permissions.includes(IXI_FINANCIAL_ACTIONS.VIEW_GENERAL_LEDGER), true);
  assert.equal(permissions.includes(IXI_FINANCIAL_ACTIONS.VIEW_FINANCIAL_REPORTS), true);
  assert.equal(permissions.includes(IXI_FINANCIAL_ACTIONS.CLOSE_PERIOD), false);
});
