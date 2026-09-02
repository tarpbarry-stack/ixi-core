"use strict";

const repository =
  require(
    "./IXIIdentityRepository"
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


async function resolveIdentityByCognitoSubject(
  cognitoSubject
) {
  const subject =
    clean(
      cognitoSubject
    );

  if (!subject) {
    throw identityError(
      "IXI_AUTH_SUBJECT_REQUIRED",
      "Authenticated Cognito subject is required.",
      {},
      401
    );
  }

  const identity =
    await repository
      .getIdentityBySubject(
        subject
      );

  if (!identity) {
    throw identityError(
      "IXI_IDENTITY_NOT_LINKED",
      "Authenticated user is not linked to an IXI employee.",
      {
        cognitoSubject:
          subject
      },
      403
    );
  }

  if (
    identity.status !==
      "active"
  ) {
    throw identityError(
      "IXI_IDENTITY_NOT_ACTIVE",
      "IXI identity is not active.",
      {
        employeeId:
          identity.employeeId,

        status:
          identity.status
      },
      403
    );
  }

  return identity;
}


async function getEmployeeIdentity(
  employeeId
) {
  return repository
    .getEmployeeIdentityLink(
      clean(
        employeeId
      )
    );
}


module.exports = {
  resolveIdentityByCognitoSubject,
  getEmployeeIdentity
};
