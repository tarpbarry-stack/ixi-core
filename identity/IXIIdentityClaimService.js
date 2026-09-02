"use strict";

/*
 * IXI IDENTITY CLAIM SERVICE
 *
 * PURPOSE
 * -------
 *
 * Converts a VERIFIED Cognito login into
 * an active IXI Employee / Membership.
 *
 *
 * SECURITY BOUNDARY
 * -----------------
 *
 * Browser supplies:
 *
 *   Authorization: Bearer <access-token>
 *   invitationId
 *   invitationToken
 *
 * Browser does NOT supply trusted:
 *
 *   cognitoSubject
 *   employeeId
 *   entityId
 *   roles
 *   permissions
 *
 *
 * FLOW
 * ----
 *
 * Cognito JWT verification
 *        ↓
 * immutable Cognito sub
 *        ↓
 * IXI invitation token verification
 *        ↓
 * DynamoDB atomic claim
 *        ↓
 * Cognito sub ↔ Employee
 * Membership ACTIVE
 * Invitation ACCEPTED
 */


const jwtVerifier =
  require(
    "./IXICognitoJwtVerifier"
  );


const invitationService =
  require(
    "./IXIInvitationService"
  );


const repository =
  require(
    "./IXIIdentityRepository"
  );


const cognitoProvider =
  require(
    "./IXICognitoIdentityProvider"
  );


const identityService =
  require(
    "./IXIIdentityService"
  );


const membershipService =
  require(
    "./IXIMembershipService"
  );


const {
  identityError
} =
  require(
    "./IXIIdentityErrors"
  );


function clean(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


/* =========================================================
   CLAIM INVITATION
   ========================================================= */

async function claimEmployeeInvitation({
  accessToken,
  invitationId
} = {}) {

  const id =
    clean(
      invitationId
    );

  if (
    !id
  ) {
    throw identityError(
      "IXI_INVITATION_CLAIM_REQUIRED",
      "Invitation ID is required.",
      {},
      400
    );
  }


  /*
   * STEP 1
   *
   * Cryptographically verify Cognito.
   *
   * This produces our ONLY trusted
   * Cognito subject.
   */

  const auth =
    await jwtVerifier
      .verifyAccessToken(
        accessToken
      );


  const cognitoSubject =
    clean(
      auth.cognitoSubject
    );


  if (!cognitoSubject) {
    throw identityError(
      "IXI_COGNITO_SUBJECT_REQUIRED",
      "Verified Cognito subject is required.",
      {},
      401
    );
  }


  /*
   * STEP 2
   *
   * Prevent one Cognito identity from
   * claiming multiple Employee identities.
   */

  let existingIdentity =
    null;


  try {
    existingIdentity =
      await identityService
        .resolveIdentityByCognitoSubject(
          cognitoSubject
        );
  } catch (error) {
    if (
      error?.code !==
        "IXI_IDENTITY_NOT_LINKED"
    ) {
      throw error;
    }
  }


  if (existingIdentity) {
    throw identityError(
      "IXI_COGNITO_IDENTITY_ALREADY_LINKED",
      "This Cognito identity is already linked to an IXI employee.",
      {
        employeeId:
          existingIdentity
            .employeeId,

        entityId:
          existingIdentity
            .entityId
      },
      409
    );
  }


  /*
   * STEP 3
   *
   * Verify IXI invitation secret and
   * invitation lifecycle.
   *
   * This determines the Employee and
   * Entity being claimed.
   */

  const invitation =
    await repository
      .getInvitation(
        id
      );


  if (!invitation) {
    throw identityError(
      "IXI_INVITATION_NOT_FOUND",
      "IXI invitation was not found.",
      {
        invitationId:
          id
      },
      404
    );
  }


  if (
    invitation.status !==
      "pending"
  ) {
    throw identityError(
      "IXI_INVITATION_NOT_PENDING",
      "IXI invitation is not pending.",
      {
        invitationId:
          id,

        status:
          clean(
            invitation.status
          )
      },
      409
    );
  }


  if (
    Number(
      invitation.expiresAtEpoch ||
      0
    ) <
    Math.floor(
      Date.now() /
      1000
    )
  ) {
    throw identityError(
      "IXI_INVITATION_EXPIRED",
      "IXI invitation has expired.",
      {
        invitationId:
          id
      },
      410
    );
  }


  /*
   * Delivery must have reached Cognito
   * before it can be claimed.
   */

  if (
    invitation.deliveryState !==
      "sent"
  ) {
    throw identityError(
      "IXI_INVITATION_NOT_DELIVERED",
      "IXI invitation has not completed authentication provisioning.",
      {
        invitationId:
          id,

        deliveryState:
          clean(
            invitation
              .deliveryState
          )
      },
      409
    );
  }


  /*
   * STEP 4
   *
   * Bind the invitation to the actual
   * verified Cognito account.
   *
   * A valid invitation token alone cannot
   * be used by a different signed-in user.
   */

  const cognitoUser =
    await cognitoProvider
      .getCognitoUser(
        auth.username
      );


  if (!cognitoUser) {
    throw identityError(
      "IXI_COGNITO_USER_NOT_FOUND",
      "Verified Cognito user could not be resolved.",
      {},
      401
    );
  }


  if (
    !cognitoUser.emailVerified
  ) {
    throw identityError(
      "IXI_COGNITO_EMAIL_NOT_VERIFIED",
      "Cognito email must be verified before an IXI employee invitation can be claimed.",
      {},
      403
    );
  }


  if (
    clean(
      cognitoUser.email
    ).toLowerCase() !==
    clean(
      invitation.emailNormalized
    ).toLowerCase()
  ) {
    throw identityError(
      "IXI_INVITATION_IDENTITY_MISMATCH",
      "Authenticated Cognito identity does not match the invited employee email.",
      {
        invitationId:
          id
      },
      403
    );
  }


  /*
   * STEP 5
   *
   * Atomically:
   *
   * - Cognito sub → Employee
   * - Employee → Cognito sub
   * - Membership pending → active
   * - Invitation pending → accepted
   *
   * Repository conditions protect against
   * race conditions and double claims.
   */

  const claimed =
    await repository
      .acceptInvitationTransaction({
        invitation,

        cognitoSubject,

        identityProvider:
          "cognito"
      });


  /*
   * STEP 6
   *
   * Read back active membership.
   *
   * Do not return success based only on
   * the write response.
   */

  const membership =
    await membershipService
      .getActiveMembership({
        employeeId:
          claimed.employeeId,

        entityId:
          claimed.entityId
      });


  /*
   * STEP 7
   *
   * Resolve persisted IXI identity.
   */

  const identity =
    await identityService
      .resolveIdentityByCognitoSubject(
        cognitoSubject
      );


  return {
    ok:
      true,

    authentication: {
      provider:
        "cognito",

      cognitoSubject,

      username:
        clean(
          auth.username
        )
    },

    identity: {
      employeeId:
        clean(
          identity.employeeId
        ),

      entityId:
        clean(
          identity.entityId
        ),

      status:
        clean(
          identity.status
        )
    },

    membership: {
      employeeId:
        clean(
          membership.employeeId
        ),

      entityId:
        clean(
          membership.entityId
        ),

      status:
        clean(
          membership.status
        ),

      roleIds:
        Array.isArray(
          membership.roleIds
        )
          ? membership.roleIds
          : [],

      directGrants:
        Array.isArray(
          membership.directGrants
        )
          ? membership.directGrants
          : [],

      directDenies:
        Array.isArray(
          membership.directDenies
        )
          ? membership.directDenies
          : [],

      scopes:
        Array.isArray(
          membership.scopes
        )
          ? membership.scopes
          : []
    },

    invitation: {
      invitationId:
        id,

      status:
        "accepted"
    }
  };
}


/* =========================================================
   RESOLVE AUTHENTICATED IXI ACCESS
   ========================================================= */

/*
 * Normal login path AFTER initial claim.
 *
 * Cognito token
 *    ↓
 * verified subject
 *    ↓
 * IXI identity
 *    ↓
 * active membership
 */

async function resolveAuthenticatedAccess({
  accessToken,
  entityId = ""
} = {}) {
  const auth =
    await jwtVerifier
      .verifyAccessToken(
        accessToken
      );


  const identity =
    await identityService
      .resolveIdentityByCognitoSubject(
        auth.cognitoSubject
      );


  const requestedEntityId =
    clean(
      entityId ||
      identity.entityId
    );


  if (!requestedEntityId) {
    throw identityError(
      "IXI_ENTITY_CONTEXT_REQUIRED",
      "IXI entity context is required.",
      {},
      400
    );
  }


  const membership =
    await membershipService
      .getActiveMembership({
        employeeId:
          identity.employeeId,

        entityId:
          requestedEntityId
      });


  return {
    authentication: {
      provider:
        "cognito",

      cognitoSubject:
        clean(
          auth.cognitoSubject
        ),

      username:
        clean(
          auth.username
        )
    },

    identity,

    membership
  };
}


module.exports = {
  claimEmployeeInvitation,
  resolveAuthenticatedAccess
};
