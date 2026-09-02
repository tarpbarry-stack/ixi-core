"use strict";

/*
 * IXI EMPLOYEE ACCESS ORCHESTRATOR
 *
 * PURPOSE
 * -------
 *
 * Coordinates IXI business identity state
 * with Cognito authentication provisioning.
 *
 * IMPORTANT:
 *
 * DynamoDB and Cognito are separate systems.
 * We DO NOT pretend they are one transaction.
 *
 * IXI records provisioning/delivery lifecycle
 * explicitly so failures are visible and
 * retryable.
 */


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


const communications =
  require(
    "./IXICommunicationsService"
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


function errorCode(
  error
) {
  return clean(
    error?.code ||
    error?.name ||
    "IXI_COGNITO_INVITE_FAILED"
  );
}


function errorMessage(
  error
) {
  return clean(
    error?.message ||
    "Cognito employee invitation failed."
  );
}


/* =========================================================
   CREATE + DISPATCH EMPLOYEE ACCESS
   ========================================================= */

async function createAndDispatchEmployeeAccess({
  employeeId,
  entityId,
  email,

  roleIds = [],
  directGrants = [],
  directDenies = [],
  scopes = [],

  createdByEmployeeId = "",
  companyName = "Your Company"
} = {}) {

  /*
   * PHASE 1
   *
   * Establish IXI business truth first.
   *
   * This transaction creates:
   *
   * - pending membership
   * - pending invitation
   * - active invitation uniqueness guard
   */

  const created =
    await invitationService
      .createEmployeeInvitation({
        employeeId,
        entityId,
        email,

        roleIds,
        directGrants,
        directDenies,
        scopes,

        createdByEmployeeId
      });


  const invitationId =
    created.invitationId;


  /*
   * PHASE 2
   *
   * Provision authentication separately.
   *
   * Membership remains PENDING regardless
   * of Cognito delivery success.
   */

  try {

    const provisioned =
      await cognitoProvider
        .inviteCognitoUser({
          email,

          clientMetadata: {
            invitationId:
              invitationId,

            employeeId:
              clean(
                employeeId
              ),

            entityId:
              clean(
                entityId
              )
          }
        });


    const user =
      provisioned.user ||
      {};


    /*
     * Cognito has created authentication,
     * but IXI still considers delivery
     * incomplete until SES accepts the
     * employee invitation.
     */

    const delivery =
      await communications
        .sendEmployeeInvitation({
          email,

          temporaryPassword:
            provisioned
              .temporaryPassword,

          invitationId,

          invitationToken:
            created.token,

          employeeId:
            clean(
              employeeId
            ),

          entityId:
            clean(
              entityId
            ),

          companyName:
            clean(
              companyName
            ) ||
            "Your Company"
        });


    const updatedInvitation =
      await repository
        .markInvitationDeliverySent({
          invitationId,

          cognitoUsername:
            user.username,

          messageId:
            delivery.messageId,

          deliveryProvider:
            delivery.provider
        });


    return {
      ok:
        true,

      invitationId,

      expiresAtEpoch:
        created.expiresAtEpoch,

      membership:
        created.membership,

      invitation:
        updatedInvitation,

      delivery,

      cognito: {
        username:
          clean(
            user.username
          ),

        cognitoSubject:
          clean(
            user.cognitoSubject
          ),

        email:
          clean(
            user.email
          ),

        status:
          clean(
            user.status
          ),

        enabled:
          user.enabled
      }
    };


  } catch (error) {

    /*
     * Do not delete the IXI records.
     *
     * They are valid pending business state.
     *
     * Record failure for deterministic retry.
     */

    try {
      await repository
        .markInvitationDeliveryFailed({
          invitationId,

          errorCode:
            errorCode(
              error
            ),

          errorMessage:
            errorMessage(
              error
            )
        });
    } catch (
      lifecycleError
    ) {
      /*
       * Preserve the original provisioning
       * error but surface lifecycle failure
       * as structured detail.
       */

      throw identityError(
        "IXI_EMPLOYEE_INVITE_PROVISION_AND_STATE_FAILED",

        "Cognito provisioning failed and IXI could not record the delivery failure state.",

        {
          invitationId,

          provisioningError: {
            code:
              errorCode(
                error
              ),

            message:
              errorMessage(
                error
              )
          },

          lifecycleError: {
            code:
              errorCode(
                lifecycleError
              ),

            message:
              errorMessage(
                lifecycleError
              )
          }
        },

        500
      );
    }


    throw identityError(
      "IXI_EMPLOYEE_INVITE_PROVISION_FAILED",

      "IXI employee access was created in pending state, but Cognito invitation provisioning failed.",

      {
        invitationId,

        retryable:
          true,

        errorCode:
          errorCode(
            error
          ),

        errorMessage:
          errorMessage(
            error
          )
      },

      502
    );
  }
}


/* =========================================================
   RETRY COGNITO DELIVERY
   ========================================================= */

async function retryEmployeeAccessInvitation({
  invitationId
} = {}) {
  const id =
    clean(
      invitationId
    );

  if (!id) {
    throw identityError(
      "IXI_INVITATION_ID_REQUIRED",
      "Invitation ID is required.",
      {},
      400
    );
  }


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
      "Only pending invitations can be retried.",
      {
        invitationId:
          id,

        status:
          invitation.status
      },
      409
    );
  }


  await repository
    .markInvitationDeliveryRetrying({
      invitationId:
        id
    });


  try {

    /*
     * If Cognito already created the user,
     * do not create a second identity.
     *
     * Read first.
     */

    let user =
      await cognitoProvider
        .getCognitoUser(
          invitation.emailNormalized
        );


    if (!user) {
      const provisioned =
        await cognitoProvider
          .inviteCognitoUser({
            email:
              invitation
                .emailNormalized,

            clientMetadata: {
              invitationId:
                id,

              employeeId:
                clean(
                  invitation.employeeId
                ),

              entityId:
                clean(
                  invitation.entityId
                )
            }
          });

      user =
        provisioned.user;
    }


    const updated =
      await repository
        .markInvitationDeliverySent({
          invitationId:
            id,

          cognitoUsername:
            user.username
        });


    return {
      ok:
        true,

      invitation:
        updated,

      cognito: {
        username:
          clean(
            user.username
          ),

        cognitoSubject:
          clean(
            user.cognitoSubject
          ),

        email:
          clean(
            user.email
          ),

        status:
          clean(
            user.status
          ),

        enabled:
          user.enabled
      }
    };


  } catch (error) {

    await repository
      .markInvitationDeliveryFailed({
        invitationId:
          id,

        errorCode:
          errorCode(
            error
          ),

        errorMessage:
          errorMessage(
            error
          )
      });


    throw identityError(
      "IXI_EMPLOYEE_INVITE_RETRY_FAILED",

      "Cognito invitation retry failed.",

      {
        invitationId:
          id,

        retryable:
          true,

        errorCode:
          errorCode(
            error
          ),

        errorMessage:
          errorMessage(
            error
          )
      },

      502
    );
  }
}


module.exports = {
  createAndDispatchEmployeeAccess,
  retryEmployeeAccessInvitation
};
