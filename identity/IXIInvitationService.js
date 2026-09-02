"use strict";

const crypto =
  require(
    "crypto"
  );


const repository =
  require(
    "./IXIIdentityRepository"
  );


const {
  DEFAULT_INVITATION_TTL_SECONDS,
  IXI_INVITATION_STATUS
} =
  require(
    "./IXIIdentityConstants"
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


function normalizeEmail(
  email
) {
  return clean(
    email
  ).toLowerCase();
}


function hashValue(
  value
) {
  return crypto
    .createHash(
      "sha256"
    )
    .update(
      String(value)
    )
    .digest(
      "hex"
    );
}


function createInvitationId() {
  return `ixi_inv_${crypto
    .randomBytes(12)
    .toString("hex")}`;
}


function createInvitationToken() {
  return crypto
    .randomBytes(32)
    .toString("base64url");
}


function timingSafeHashMatch({
  value,
  expectedHash
}) {
  const actual =
    Buffer.from(
      hashValue(
        value
      ),
      "hex"
    );

  const expected =
    Buffer.from(
      clean(
        expectedHash
      ),
      "hex"
    );

  if (
    actual.length !==
      expected.length
  ) {
    return false;
  }

  return crypto
    .timingSafeEqual(
      actual,
      expected
    );
}


async function createEmployeeInvitation({
  employeeId,
  entityId,
  email,
  roleIds = [],
  directGrants = [],
  directDenies = [],
  scopes = [],
  createdByEmployeeId = "",
  ttlSeconds =
    DEFAULT_INVITATION_TTL_SECONDS
} = {}) {
  const employee =
    clean(
      employeeId
    );

  const entity =
    clean(
      entityId
    );

  const normalizedEmail =
    normalizeEmail(
      email
    );

  if (
    !employee ||
    !entity ||
    !normalizedEmail
  ) {
    throw identityError(
      "IXI_INVITATION_INPUT_REQUIRED",
      "employeeId, entityId and email are required.",
      {
        employeeId:
          employee,

        entityId:
          entity
      },
      400
    );
  }


  const invitationId =
    createInvitationId();

  const token =
    createInvitationToken();

  const emailHash =
    hashValue(
      normalizedEmail
    );

  const tokenHash =
    hashValue(
      token
    );

  const expiresAtEpoch =
    Math.floor(
      Date.now() /
      1000
    ) +
    Math.max(
      300,
      Number(
        ttlSeconds ||
        DEFAULT_INVITATION_TTL_SECONDS
      )
    );


  const created =
    await repository
      .createPendingMembershipAndInvitation({
        invitation: {
          invitationId,
          employeeId:
            employee,

          entityId:
            entity,

          emailNormalized:
            normalizedEmail,

          emailHash,
          tokenHash,

          expiresAtEpoch,

          createdByEmployeeId:
            clean(
              createdByEmployeeId
            )
        },

        membership: {
          roleIds,
          directGrants,
          directDenies,
          scopes
        }
      });


  /*
   * IMPORTANT:
   *
   * Raw invitation token is returned only to the caller.
   * DynamoDB stores only tokenHash.
   */
  return {
    invitationId,

    token,

    expiresAtEpoch,

    invitation:
      created.invitation,

    membership:
      created.membership
  };
}


async function verifyInvitationToken({
  invitationId,
  token
} = {}) {
  const invitation =
    await repository
      .getInvitation(
        clean(
          invitationId
        )
      );

  if (!invitation) {
    throw identityError(
      "IXI_INVITATION_NOT_FOUND",
      "IXI invitation was not found.",
      {},
      404
    );
  }

  if (
    invitation.status !==
      IXI_INVITATION_STATUS
        .PENDING
  ) {
    throw identityError(
      "IXI_INVITATION_NOT_PENDING",
      "IXI invitation is not pending.",
      {
        status:
          invitation.status
      },
      409
    );
  }

  const nowEpoch =
    Math.floor(
      Date.now() /
      1000
    );

  if (
    Number(
      invitation
        .expiresAtEpoch ||
      0
    ) <
      nowEpoch
  ) {
    throw identityError(
      "IXI_INVITATION_EXPIRED",
      "IXI invitation has expired.",
      {},
      410
    );
  }

  if (
    !timingSafeHashMatch({
      value:
        clean(
          token
        ),

      expectedHash:
        invitation.tokenHash
    })
  ) {
    throw identityError(
      "IXI_INVITATION_TOKEN_INVALID",
      "IXI invitation token is invalid.",
      {},
      403
    );
  }

  return invitation;
}


async function acceptEmployeeInvitation({
  invitationId,
  token,
  cognitoSubject
} = {}) {
  const invitation =
    await verifyInvitationToken({
      invitationId,
      token
    });

  const subject =
    clean(
      cognitoSubject
    );

  if (!subject) {
    throw identityError(
      "IXI_COGNITO_SUBJECT_REQUIRED",
      "Verified Cognito subject is required to accept an invitation.",
      {},
      401
    );
  }


  return repository
    .acceptInvitationTransaction({
      invitation,

      cognitoSubject:
        subject,

      identityProvider:
        "cognito"
    });
}


module.exports = {
  normalizeEmail,
  hashValue,

  createEmployeeInvitation,
  verifyInvitationToken,
  acceptEmployeeInvitation
};
