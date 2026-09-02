"use strict";

const store =
  require(
    "./IXIIdentityDynamoStore"
  );


const {
  IXI_IDENTITY_RECORD_TYPES,
  IXI_MEMBERSHIP_STATUS,
  IXI_INVITATION_STATUS
} =
  require(
    "./IXIIdentityConstants"
  );


function clean(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


function nowIso() {
  return new Date()
    .toISOString();
}


function getIdentityBySubject(
  cognitoSubject
) {
  const subject =
    clean(
      cognitoSubject
    );

  if (!subject) {
    return null;
  }

  return store.getItem({
    PK:
      store.identityPk(
        subject
      ),

    SK:
      "PROFILE"
  });
}


function getEmployeeIdentityLink(
  employeeId
) {
  const id =
    clean(
      employeeId
    );

  if (!id) {
    return null;
  }

  return store.getItem({
    PK:
      store.employeePk(
        id
      ),

    SK:
      "IDENTITY"
  });
}


function getMembership({
  employeeId,
  entityId
} = {}) {
  const employee =
    clean(
      employeeId
    );

  const entity =
    clean(
      entityId
    );

  if (
    !employee ||
    !entity
  ) {
    return null;
  }

  return store.getItem({
    PK:
      store.employeePk(
        employee
      ),

    SK:
      store.membershipSk(
        entity
      )
  });
}


function listEntityMemberships(
  entityId
) {
  return store.queryGsi1(
    store.entityPk(
      entityId
    ),
    {
      sortKeyPrefix:
        "MEMBER#"
    }
  );
}


function getInvitation(
  invitationId
) {
  const id =
    clean(
      invitationId
    );

  if (!id) {
    return null;
  }

  return store.getItem({
    PK:
      store.invitePk(
        id
      ),

    SK:
      "PROFILE"
  });
}


function findInvitationsByEmailHash(
  emailHash
) {
  const hash =
    clean(
      emailHash
    );

  if (!hash) {
    return [];
  }

  return store.queryGsi2(
    `EMAIL#${hash}`,
    {
      sortKeyPrefix:
        "INVITE#"
    }
  );
}


async function createPendingMembershipAndInvitation({
  invitation,
  membership
} = {}) {
  const timestamp =
    nowIso();

  const invitationId =
    clean(
      invitation
        ?.invitationId
    );

  const employeeId =
    clean(
      invitation
        ?.employeeId
    );

  const entityId =
    clean(
      invitation
        ?.entityId
    );

  const emailHash =
    clean(
      invitation
        ?.emailHash
    );

  const expiresAtEpoch =
    Number(
      invitation
        ?.expiresAtEpoch ||
      0
    );

  if (
    !invitationId ||
    !employeeId ||
    !entityId ||
    !emailHash ||
    !expiresAtEpoch
  ) {
    throw new Error(
      "Invitation identity fields are required."
    );
  }

  const invitationItem = {
    PK:
      store.invitePk(
        invitationId
      ),

    SK:
      "PROFILE",

    GSI1PK:
      store.entityPk(
        entityId
      ),

    GSI1SK:
      `INVITE#${invitationId}`,

    GSI2PK:
      `EMAIL#${emailHash}`,

    GSI2SK:
      `INVITE#${invitationId}`,

    entityType:
      IXI_IDENTITY_RECORD_TYPES
        .INVITATION,

    invitationId,
    employeeId,
    entityId,

    emailNormalized:
      clean(
        invitation.emailNormalized
      ),

    emailHash,

    tokenHash:
      clean(
        invitation.tokenHash
      ),

    status:
      IXI_INVITATION_STATUS
        .PENDING,

    expiresAtEpoch,

    createdAt:
      timestamp,

    updatedAt:
      timestamp,

    createdByEmployeeId:
      clean(
        invitation
          .createdByEmployeeId
      )
  };


  const membershipItem = {
    PK:
      store.employeePk(
        employeeId
      ),

    SK:
      store.membershipSk(
        entityId
      ),

    GSI1PK:
      store.entityPk(
        entityId
      ),

    GSI1SK:
      `MEMBER#${employeeId}`,

    GSI2PK:
      `EMPLOYEE#${employeeId}`,

    GSI2SK:
      `ENTITY#${entityId}`,

    entityType:
      IXI_IDENTITY_RECORD_TYPES
        .MEMBERSHIP,

    employeeId,
    entityId,

    status:
      IXI_MEMBERSHIP_STATUS
        .PENDING,

    roleIds:
      Array.isArray(
        membership?.roleIds
      )
        ? membership.roleIds
        : [],

    directGrants:
      Array.isArray(
        membership?.directGrants
      )
        ? membership.directGrants
        : [],

    directDenies:
      Array.isArray(
        membership?.directDenies
      )
        ? membership.directDenies
        : [],

    scopes:
      Array.isArray(
        membership?.scopes
      )
        ? membership.scopes
        : [],

    createdAt:
      timestamp,

    updatedAt:
      timestamp,

    invitationId
  };


  const guardItem = {
    PK:
      store.invitationEmailGuardPk({
        entityId,
        emailHash
      }),

    SK:
      "ACTIVE",

    entityType:
      IXI_IDENTITY_RECORD_TYPES
        .INVITATION_EMAIL_GUARD,

    entityId,
    employeeId,
    invitationId,
    emailHash,

    expiresAtEpoch,

    createdAt:
      timestamp
  };


  await store.transactWrite([
    {
      Put: {
        TableName:
          store.TABLE_NAME,

        Item:
          invitationItem,

        ConditionExpression:
          "attribute_not_exists(PK)"
      }
    },

    {
      Put: {
        TableName:
          store.TABLE_NAME,

        Item:
          membershipItem,

        ConditionExpression:
          "attribute_not_exists(PK)"
      }
    },

    {
      Put: {
        TableName:
          store.TABLE_NAME,

        Item:
          guardItem,

        ConditionExpression:
          "attribute_not_exists(PK) OR expiresAtEpoch < :now",

        ExpressionAttributeValues: {
          ":now":
            Math.floor(
              Date.now() /
              1000
            )
        }
      }
    }
  ]);


  return {
    invitation:
      invitationItem,

    membership:
      membershipItem
  };
}


async function acceptInvitationTransaction({
  invitation,
  cognitoSubject,
  identityProvider = "cognito"
} = {}) {
  const invitationId =
    clean(
      invitation
        ?.invitationId
    );

  const employeeId =
    clean(
      invitation
        ?.employeeId
    );

  const entityId =
    clean(
      invitation
        ?.entityId
    );

  const subject =
    clean(
      cognitoSubject
    );

  if (
    !invitationId ||
    !employeeId ||
    !entityId ||
    !subject
  ) {
    throw new Error(
      "Invitation acceptance identity fields are required."
    );
  }

  const timestamp =
    nowIso();


  const identityItem = {
    PK:
      store.identityPk(
        subject
      ),

    SK:
      "PROFILE",

    GSI1PK:
      store.employeePk(
        employeeId
      ),

    GSI1SK:
      `IDENTITY#${subject}`,

    entityType:
      IXI_IDENTITY_RECORD_TYPES
        .IDENTITY,

    authProvider:
      clean(
        identityProvider
      ) ||
      "cognito",

    authSubjectId:
      subject,

    employeeId,
    entityId,

    status:
      "active",

    createdAt:
      timestamp,

    updatedAt:
      timestamp
  };


  const employeeIdentityItem = {
    PK:
      store.employeePk(
        employeeId
      ),

    SK:
      "IDENTITY",

    GSI2PK:
      `IDENTITY#${subject}`,

    GSI2SK:
      `EMPLOYEE#${employeeId}`,

    entityType:
      IXI_IDENTITY_RECORD_TYPES
        .EMPLOYEE_IDENTITY_LINK,

    employeeId,

    authProvider:
      clean(
        identityProvider
      ) ||
      "cognito",

    authSubjectId:
      subject,

    linkedAt:
      timestamp
  };


  await store.transactWrite([
    {
      Put: {
        TableName:
          store.TABLE_NAME,

        Item:
          identityItem,

        ConditionExpression:
          "attribute_not_exists(PK)"
      }
    },

    {
      Put: {
        TableName:
          store.TABLE_NAME,

        Item:
          employeeIdentityItem,

        ConditionExpression:
          "attribute_not_exists(PK)"
      }
    },

    {
      Update: {
        TableName:
          store.TABLE_NAME,

        Key: {
          PK:
            store.employeePk(
              employeeId
            ),

          SK:
            store.membershipSk(
              entityId
            )
        },

        UpdateExpression:
          "SET #status = :active, authSubjectId = :subject, activatedAt = :now, updatedAt = :now",

        ConditionExpression:
          "#status = :pending",

        ExpressionAttributeNames: {
          "#status":
            "status"
        },

        ExpressionAttributeValues: {
          ":pending":
            IXI_MEMBERSHIP_STATUS
              .PENDING,

          ":active":
            IXI_MEMBERSHIP_STATUS
              .ACTIVE,

          ":subject":
            subject,

          ":now":
            timestamp
        }
      }
    },

    {
      Update: {
        TableName:
          store.TABLE_NAME,

        Key: {
          PK:
            store.invitePk(
              invitationId
            ),

          SK:
            "PROFILE"
        },

        UpdateExpression:
          "SET #status = :accepted, acceptedAt = :now, authSubjectId = :subject, updatedAt = :now",

        ConditionExpression:
          "#status = :pending AND expiresAtEpoch >= :epoch",

        ExpressionAttributeNames: {
          "#status":
            "status"
        },

        ExpressionAttributeValues: {
          ":pending":
            IXI_INVITATION_STATUS
              .PENDING,

          ":accepted":
            IXI_INVITATION_STATUS
              .ACCEPTED,

          ":subject":
            subject,

          ":now":
            timestamp,

          ":epoch":
            Math.floor(
              Date.now() /
              1000
            )
        }
      }
    }
  ]);


  return {
    identity:
      identityItem,

    employeeIdentity:
      employeeIdentityItem,

    employeeId,
    entityId,
    invitationId
  };
}



/* =========================================================
   INVITATION DELIVERY LIFECYCLE
   ========================================================= */

async function markInvitationDeliverySent({
  invitationId,
  cognitoUsername,
  messageId = "",
  deliveryProvider = "amazon-ses"
} = {}) {
  const id =
    clean(
      invitationId
    );

  const username =
    clean(
      cognitoUsername
    );

  if (
    !id ||
    !username
  ) {
    throw new Error(
      "invitationId and cognitoUsername are required."
    );
  }

  const timestamp =
    nowIso();

  return store.updateItem({
    key: {
      PK:
        store.invitePk(
          id
        ),

      SK:
        "PROFILE"
    },

    updateExpression:
      "SET deliveryState = :sent, cognitoUsername = :username, deliveryProvider = :provider, deliveryMessageId = :messageId, deliveredAt = :now, updatedAt = :now REMOVE deliveryErrorCode, deliveryErrorMessage",

    conditionExpression:
      "#status = :pending",

    expressionAttributeNames: {
      "#status":
        "status"
    },

    expressionAttributeValues: {
      ":pending":
        IXI_INVITATION_STATUS
          .PENDING,

      ":sent":
        "sent",

      ":username":
        username,

      ":provider":
        clean(
          deliveryProvider
        ) ||
        "amazon-ses",

      ":messageId":
        clean(
          messageId
        ),

      ":now":
        timestamp
    }
  });
}


async function markInvitationDeliveryFailed({
  invitationId,
  errorCode = "",
  errorMessage = ""
} = {}) {
  const id =
    clean(
      invitationId
    );

  if (!id) {
    throw new Error(
      "invitationId is required."
    );
  }

  const timestamp =
    nowIso();

  return store.updateItem({
    key: {
      PK:
        store.invitePk(
          id
        ),

      SK:
        "PROFILE"
    },

    updateExpression:
      "SET deliveryState = :failed, deliveryErrorCode = :code, deliveryErrorMessage = :message, deliveryFailedAt = :now, updatedAt = :now",

    conditionExpression:
      "#status = :pending",

    expressionAttributeNames: {
      "#status":
        "status"
    },

    expressionAttributeValues: {
      ":pending":
        IXI_INVITATION_STATUS
          .PENDING,

      ":failed":
        "failed",

      ":code":
        clean(
          errorCode
        ),

      ":message":
        clean(
          errorMessage
        ).slice(
          0,
          500
        ),

      ":now":
        timestamp
    }
  });
}


async function markInvitationDeliveryRetrying({
  invitationId
} = {}) {
  const id =
    clean(
      invitationId
    );

  if (!id) {
    throw new Error(
      "invitationId is required."
    );
  }

  const timestamp =
    nowIso();

  return store.updateItem({
    key: {
      PK:
        store.invitePk(
          id
        ),

      SK:
        "PROFILE"
    },

    updateExpression:
      "SET deliveryState = :retrying, deliveryRetryStartedAt = :now, updatedAt = :now",

    conditionExpression:
      "#status = :pending",

    expressionAttributeNames: {
      "#status":
        "status"
    },

    expressionAttributeValues: {
      ":pending":
        IXI_INVITATION_STATUS
          .PENDING,

      ":retrying":
        "retrying",

      ":now":
        timestamp
    }
  });
}


module.exports = {
  getIdentityBySubject,
  getEmployeeIdentityLink,

  getMembership,
  listEntityMemberships,

  getInvitation,
  findInvitationsByEmailHash,

  createPendingMembershipAndInvitation,

  markInvitationDeliverySent,
  markInvitationDeliveryFailed,
  markInvitationDeliveryRetrying,

  acceptInvitationTransaction
};
