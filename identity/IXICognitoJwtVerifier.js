"use strict";

const {
  CognitoJwtVerifier
} =
  require(
    "aws-jwt-verify"
  );


const {
  COGNITO_USER_POOL_ID,
  COGNITO_WEB_CLIENT_ID
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


const accessTokenVerifier =
  CognitoJwtVerifier.create({
    userPoolId:
      COGNITO_USER_POOL_ID,

    tokenUse:
      "access",

    clientId:
      COGNITO_WEB_CLIENT_ID
  });


async function verifyAccessToken(
  token
) {
  const raw =
    clean(
      token
    );

  if (!raw) {
    throw identityError(
      "IXI_ACCESS_TOKEN_REQUIRED",
      "Cognito access token is required.",
      {},
      401
    );
  }


  try {
    const payload =
      await accessTokenVerifier
        .verify(
          raw
        );


    const subject =
      clean(
        payload.sub
      );

    if (!subject) {
      throw identityError(
        "IXI_COGNITO_SUBJECT_MISSING",
        "Verified Cognito token does not contain a subject.",
        {},
        401
      );
    }


    return {
      cognitoSubject:
        subject,

      username:
        clean(
          payload.username
        ),

      clientId:
        clean(
          payload.client_id
        ),

      tokenUse:
        clean(
          payload.token_use
        ),

      scope:
        clean(
          payload.scope
        ),

      issuedAt:
        Number(
          payload.iat ||
          0
        ),

      expiresAt:
        Number(
          payload.exp ||
          0
        ),

      rawPayload:
        payload
    };


  } catch (error) {
    if (
      error?.name ===
        "IXIIdentityError"
    ) {
      throw error;
    }

    throw identityError(
      "IXI_ACCESS_TOKEN_INVALID",
      "Cognito access token could not be verified.",
      {
        verifierError:
          clean(
            error?.message
          )
      },
      401
    );
  }
}


function getBearerTokenFromRequest(
  req
) {
  const header =
    clean(
      req
        ?.headers
        ?.authorization
    );

  if (!header) {
    return "";
  }


  const match =
    header.match(
      /^Bearer\s+(.+)$/i
    );


  return match
    ? clean(
        match[1]
      )
    : "";
}


async function verifyRequestAccessToken(
  req
) {
  const token =
    getBearerTokenFromRequest(
      req
    );

  return verifyAccessToken(
    token
  );
}


module.exports = {
  getBearerTokenFromRequest,
  verifyAccessToken,
  verifyRequestAccessToken
};
