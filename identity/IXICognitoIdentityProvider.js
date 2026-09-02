"use strict";

/*
 * IXI COGNITO IDENTITY PROVIDER
 *
 * PURPOSE
 * -------
 *
 * Cognito authenticates IXI AOS users.
 *
 * This adapter owns only Cognito login-account
 * administration.
 *
 * It DOES NOT own:
 *
 * - Employee identity
 * - Company membership
 * - Roles
 * - Permissions
 * - Scope
 * - Financial authority
 *
 * Those remain IXI business records.
 */


const crypto =
  require(
    "crypto"
  );


const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminResetUserPasswordCommand,
  AdminUserGlobalSignOutCommand,
  AdminUpdateUserAttributesCommand,
  AdminSetUserPasswordCommand
} =
  require(
    "@aws-sdk/client-cognito-identity-provider"
  );


const {
  REGION,
  COGNITO_USER_POOL_ID
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


const client =
  new CognitoIdentityProviderClient({
    region:
      REGION
  });


function clean(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


function normalizeEmail(
  value
) {
  return clean(
    value
  ).toLowerCase();
}


function attributesToObject(
  attributes = []
) {
  const output =
    {};

  if (
    !Array.isArray(
      attributes
    )
  ) {
    return output;
  }

  attributes.forEach(
    attribute => {
      const name =
        clean(
          attribute?.Name
        );

      if (!name) {
        return;
      }

      output[name] =
        clean(
          attribute?.Value
        );
    }
  );

  return output;
}


function normalizeCognitoUser(
  user = {}
) {
  const attributes =
    attributesToObject(
      user.UserAttributes ||
      user.Attributes
    );

  return {
    username:
      clean(
        user.Username
      ),

    cognitoSubject:
      clean(
        attributes.sub
      ),

    email:
      normalizeEmail(
        attributes.email
      ),

    emailVerified:
      attributes.email_verified ===
        "true",

    enabled:
      user.Enabled ===
        undefined
        ? null
        : Boolean(
            user.Enabled
          ),

    status:
      clean(
        user.UserStatus
      ),

    createdAt:
      user.UserCreateDate
        ? new Date(
            user.UserCreateDate
          ).toISOString()
        : "",

    updatedAt:
      user.UserLastModifiedDate
        ? new Date(
            user.UserLastModifiedDate
          ).toISOString()
        : ""
  };
}


function createTemporaryPassword() {
  /*
   * Cognito requires the configured pool
   * password policy.
   *
   * 18 random bytes plus explicit character
   * classes provide high entropy while
   * guaranteeing policy compliance.
   */
  const random =
    crypto
      .randomBytes(18)
      .toString("base64url");

  return `Ix9!${random}aA1!`;
}


async function inviteCognitoUser({
  email,
  temporaryPassword = "",
  clientMetadata = {}
} = {}) {
  const normalizedEmail =
    normalizeEmail(
      email
    );

  if (!normalizedEmail) {
    throw identityError(
      "IXI_COGNITO_EMAIL_REQUIRED",
      "Employee email is required to create a Cognito login.",
      {},
      400
    );
  }


  const password =
    clean(
      temporaryPassword
    ) ||
    createTemporaryPassword();


  try {
    const result =
      await client.send(
        new AdminCreateUserCommand({
          UserPoolId:
            COGNITO_USER_POOL_ID,

          /*
           * This user pool uses email as
           * UsernameAttributes.
           *
           * Cognito accepts the email value
           * here and manages the internal
           * username identifier.
           */
          Username:
            normalizedEmail,

          TemporaryPassword:
            password,

          UserAttributes: [
            {
              Name:
                "email",

              Value:
                normalizedEmail
            },

            {
              Name:
                "email_verified",

              Value:
                "true"
            }
          ],

          /*
           * IXI owns employee communications.
           * Cognito authenticates only.
           */
          MessageAction:
            "SUPPRESS",

          ClientMetadata:
            clientMetadata &&
            typeof clientMetadata ===
              "object"
              ? clientMetadata
              : {}
        })
      );


    return {
      user:
        normalizeCognitoUser(
          result.User ||
          {}
        ),

      /*
       * IMPORTANT:
       *
       * Temporary password is returned only
       * to the server caller.
       *
       * IXI must never persist it in DynamoDB
       * or logs.
       */
      temporaryPassword:
        password
    };

  } catch (error) {
    if (
      error?.name ===
        "UsernameExistsException"
    ) {
      throw identityError(
        "IXI_COGNITO_USER_EXISTS",
        "A Cognito login already exists for this email.",
        {
          email:
            normalizedEmail
        },
        409
      );
    }

    throw error;
  }
}


async function getCognitoUser(
  usernameOrEmail
) {
  const username =
    clean(
      usernameOrEmail
    );

  if (!username) {
    return null;
  }

  try {
    const result =
      await client.send(
        new AdminGetUserCommand({
          UserPoolId:
            COGNITO_USER_POOL_ID,

          Username:
            username
        })
      );

    return normalizeCognitoUser(
      result
    );

  } catch (error) {
    if (
      error?.name ===
        "UserNotFoundException"
    ) {
      return null;
    }

    throw error;
  }
}


async function disableCognitoUser(
  usernameOrEmail
) {
  const username =
    clean(
      usernameOrEmail
    );

  if (!username) {
    throw identityError(
      "IXI_COGNITO_USERNAME_REQUIRED",
      "Cognito username is required.",
      {},
      400
    );
  }


  await client.send(
    new AdminDisableUserCommand({
      UserPoolId:
        COGNITO_USER_POOL_ID,

      Username:
        username
    })
  );


  /*
   * Force existing Cognito sessions out.
   */
  await client.send(
    new AdminUserGlobalSignOutCommand({
      UserPoolId:
        COGNITO_USER_POOL_ID,

      Username:
        username
    })
  );


  return getCognitoUser(
    username
  );
}


async function enableCognitoUser(
  usernameOrEmail
) {
  const username =
    clean(
      usernameOrEmail
    );

  if (!username) {
    throw identityError(
      "IXI_COGNITO_USERNAME_REQUIRED",
      "Cognito username is required.",
      {},
      400
    );
  }


  await client.send(
    new AdminEnableUserCommand({
      UserPoolId:
        COGNITO_USER_POOL_ID,

      Username:
        username
    })
  );


  return getCognitoUser(
    username
  );
}


async function resetCognitoPassword(
  usernameOrEmail
) {
  const username =
    clean(
      usernameOrEmail
    );

  if (!username) {
    throw identityError(
      "IXI_COGNITO_USERNAME_REQUIRED",
      "Cognito username is required.",
      {},
      400
    );
  }


  await client.send(
    new AdminResetUserPasswordCommand({
      UserPoolId:
        COGNITO_USER_POOL_ID,

      Username:
        username
    })
  );


  return getCognitoUser(
    username
  );
}


async function updateCognitoEmail({
  username,
  email
} = {}) {
  const user =
    clean(
      username
    );

  const normalizedEmail =
    normalizeEmail(
      email
    );

  if (
    !user ||
    !normalizedEmail
  ) {
    throw identityError(
      "IXI_COGNITO_EMAIL_UPDATE_REQUIRED",
      "Cognito username and email are required.",
      {},
      400
    );
  }


  await client.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId:
        COGNITO_USER_POOL_ID,

      Username:
        user,

      UserAttributes: [
        {
          Name:
            "email",

          Value:
            normalizedEmail
        },

        {
          Name:
            "email_verified",

          Value:
            "true"
        }
      ]
    })
  );


  return getCognitoUser(
    user
  );
}


async function getCognitoProviderHealth() {
  /*
   * Deliberately uses no user mutation.
   *
   * Pool reachability itself is already
   * validated through IAM/runtime setup;
   * this reports local provider wiring.
   */

  return {
    provider:
      "amazon-cognito",

    region:
      REGION,

    userPoolId:
      COGNITO_USER_POOL_ID,

    configured:
      Boolean(
        clean(
          COGNITO_USER_POOL_ID
        )
      )
  };
}



/* =========================================================
   TEMPORARY PASSWORD ROTATION
   ========================================================= */

async function setTemporaryCognitoPassword(
  usernameOrEmail
) {
  const username =
    clean(
      usernameOrEmail
    );

  if (!username) {
    throw identityError(
      "IXI_COGNITO_USERNAME_REQUIRED",
      "Cognito username is required.",
      {},
      400
    );
  }


  const password =
    createTemporaryPassword();


  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId:
        COGNITO_USER_POOL_ID,

      Username:
        username,

      Password:
        password,

      Permanent:
        false
    })
  );


  return {
    user:
      await getCognitoUser(
        username
      ),

    temporaryPassword:
      password
  };
}


module.exports = {
  normalizeEmail,
  normalizeCognitoUser,

  inviteCognitoUser,
  getCognitoUser,

  disableCognitoUser,
  enableCognitoUser,

  resetCognitoPassword,
  setTemporaryCognitoPassword,
  updateCognitoEmail,

  getCognitoProviderHealth
};
