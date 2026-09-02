"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  IXI_FINANCIAL_ACTIONS,
  IXI_FINANCIAL_ROLES,
  ROLE_PERMISSIONS
} = require("./IXIFinancialPermissionEngine");

test("journal posting is segregated to accounting control roles", () => {
  const post = IXI_FINANCIAL_ACTIONS.POST_DOCUMENT;

  assert.equal(ROLE_PERMISSIONS[IXI_FINANCIAL_ROLES.EMPLOYEE].includes(post), false);
  assert.equal(ROLE_PERMISSIONS[IXI_FINANCIAL_ROLES.MANAGER].includes(post), false);
  assert.equal(ROLE_PERMISSIONS[IXI_FINANCIAL_ROLES.ACCOUNTING].includes(post), true);
  assert.equal(ROLE_PERMISSIONS[IXI_FINANCIAL_ROLES.CONTROLLER].includes(post), true);
  assert.equal(ROLE_PERMISSIONS[IXI_FINANCIAL_ROLES.ADMIN].includes(post), true);
});
