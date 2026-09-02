"use strict";

/*
 * IXI AOS IDENTITY / AUTHORITY CONSTANTS
 *
 * Cognito authenticates humans.
 * IXI owns business identity, membership,
 * authority relationships and scope.
 */

const REGION =
  process.env.AWS_REGION ||
  process.env.AWS_DEFAULT_REGION ||
  "us-east-2";


const TABLE_NAME =
  process.env.IXI_AOS_IDENTITY_DDB_TABLE ||
  "ixi-aos-identity-v1";


const COGNITO_USER_POOL_ID =
  process.env.IXI_AOS_COGNITO_USER_POOL_ID ||
  "us-east-2_nB5CRg6DM";


const COGNITO_WEB_CLIENT_ID =
  process.env.IXI_AOS_COGNITO_WEB_CLIENT_ID ||
  "2aetbus1ine9jk8hc3qr9a7i0e";


const IXI_IDENTITY_RECORD_TYPES =
  Object.freeze({
    IDENTITY:
      "ixi-identity",

    EMPLOYEE_IDENTITY_LINK:
      "ixi-employee-identity-link",

    MEMBERSHIP:
      "ixi-membership",

    INVITATION:
      "ixi-invitation",

    INVITATION_EMAIL_GUARD:
      "ixi-invitation-email-guard",

    ROLE:
      "ixi-role",

    ROLE_ASSIGNMENT:
      "ixi-role-assignment",

    GRANT:
      "ixi-permission-grant",

    DENY:
      "ixi-permission-deny",

    SCOPE:
      "ixi-scope-assignment"
  });


const IXI_MEMBERSHIP_STATUS =
  Object.freeze({
    PENDING:
      "pending",

    ACTIVE:
      "active",

    SUSPENDED:
      "suspended",

    TERMINATED:
      "terminated"
  });


const IXI_INVITATION_STATUS =
  Object.freeze({
    PENDING:
      "pending",

    ACCEPTED:
      "accepted",

    REVOKED:
      "revoked",

    EXPIRED:
      "expired"
  });


const DEFAULT_INVITATION_TTL_SECONDS =
  7 * 24 * 60 * 60;


module.exports = {
  REGION,
  TABLE_NAME,

  COGNITO_USER_POOL_ID,
  COGNITO_WEB_CLIENT_ID,

  IXI_IDENTITY_RECORD_TYPES,
  IXI_MEMBERSHIP_STATUS,
  IXI_INVITATION_STATUS,

  DEFAULT_INVITATION_TTL_SECONDS
};
