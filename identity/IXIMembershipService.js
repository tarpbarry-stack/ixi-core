"use strict";

const repository =
  require(
    "./IXIIdentityRepository"
  );


const {
  IXI_MEMBERSHIP_STATUS
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


async function getActiveMembership({
  employeeId,
  entityId
} = {}) {
  const membership =
    await repository
      .getMembership({
        employeeId:
          clean(
            employeeId
          ),

        entityId:
          clean(
            entityId
          )
      });

  if (!membership) {
    throw identityError(
      "IXI_MEMBERSHIP_NOT_FOUND",
      "IXI company membership was not found.",
      {
        employeeId:
          clean(
            employeeId
          ),

        entityId:
          clean(
            entityId
          )
      },
      403
    );
  }

  if (
    membership.status !==
      IXI_MEMBERSHIP_STATUS
        .ACTIVE
  ) {
    throw identityError(
      "IXI_MEMBERSHIP_NOT_ACTIVE",
      "IXI company membership is not active.",
      {
        employeeId:
          membership.employeeId,

        entityId:
          membership.entityId,

        status:
          membership.status
      },
      403
    );
  }

  return membership;
}


function listCompanyMemberships(
  entityId
) {
  return repository
    .listEntityMemberships(
      clean(
        entityId
      )
    );
}


module.exports = {
  getActiveMembership,
  listCompanyMemberships
};
