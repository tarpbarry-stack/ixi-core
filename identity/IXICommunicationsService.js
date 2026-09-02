"use strict";

/*
 * IXI COMMUNICATIONS SERVICE
 *
 * PURPOSE
 * -------
 *
 * IXI owns transactional communication.
 *
 * SES is only the current delivery provider.
 *
 * Cognito does NOT own IXI employee email.
 */


const {
  SESv2Client,
  SendEmailCommand
} =
  require(
    "@aws-sdk/client-sesv2"
  );


const {
  REGION
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


const SES_FROM_EMAIL =
  process.env.IXI_SES_FROM_EMAIL ||
  "access@ironxchange.com";


const SES_FROM_NAME =
  process.env.IXI_SES_FROM_NAME ||
  "IXI AOS";


const SES_REPLY_TO =
  process.env.IXI_SES_REPLY_TO ||
  "access@ironxchange.com";


const SES_CONFIGURATION_SET =
  process.env.IXI_SES_CONFIGURATION_SET ||
  "my-first-configuration-set";


const AOS_ACCESS_SETUP_URL =
  process.env.IXI_AOS_ACCESS_SETUP_URL ||
  "https://preview.ironxchange.com/aos/access/setup";


const client =
  new SESv2Client({
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


function escapeHtml(
  value
) {
  return clean(
    value
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}


function buildEmployeeAccessUrl({
  invitationId
} = {}) {
  /*
   * The employee-facing URL contains only the
   * non-secret invitation ID.
   *
   * Authority comes from:
   *
   * - cryptographically verified Cognito JWT
   * - verified Cognito email
   * - exact invitation-email match
   * - pending/unexpired invitation state
   *
   * No reusable claim secret is exposed in
   * email URLs.
   */

  const query =
    new URLSearchParams({
      invite:
        clean(
          invitationId
        )
    });

  return (
    `${AOS_ACCESS_SETUP_URL}` +
    `?${query.toString()}`
  );
}


function buildEmployeeInvitationEmail({
  email,
  temporaryPassword,
  invitationId,
  invitationToken,
  companyName = "Your Company"
} = {}) {
  const normalizedEmail =
    normalizeEmail(
      email
    );

  const password =
    clean(
      temporaryPassword
    );

  if (
    !normalizedEmail ||
    !password ||
    !clean(invitationId)
  ) {
    throw identityError(
      "IXI_EMPLOYEE_EMAIL_INPUT_REQUIRED",
      "Employee invitation email requires email, temporary password and invitation ID.",
      {},
      400
    );
  }


  const accessUrl =
    buildEmployeeAccessUrl({
      invitationId
    });


  const safeCompany =
    escapeHtml(
      companyName
    );


  const safeEmail =
    escapeHtml(
      normalizedEmail
    );


  const safePassword =
    escapeHtml(
      password
    );


  const safeUrl =
    escapeHtml(
      accessUrl
    );


  const subject =
    `You've been invited to IXI AOS`;


  const text =
`IXI AOS

IDENTITY + ACCESS

You've been invited to IXI AOS.

Company:
${clean(companyName)}

Email:
${normalizedEmail}

Temporary password:
${password}

Set up your access:
${accessUrl}

You will be required to choose a permanent password when you first sign in.

This invitation expires in 7 days.

If you weren't expecting this invitation, you can ignore this email.

IronXchange · IXI AOS`;


  const html =
`<!doctype html>
<html>
<body style="
  margin:0;
  background:#f4f5f7;
  font-family:Arial,Helvetica,sans-serif;
  color:#16181d;
">
  <div style="
    max-width:620px;
    margin:40px auto;
    background:#ffffff;
    border:1px solid #dfe2e7;
  ">
    <div style="
      padding:24px 32px;
      background:#111318;
      color:#ffffff;
    ">
      <div style="
        font-size:13px;
        letter-spacing:2px;
        font-weight:700;
      ">
        IRONXCHANGE
      </div>

      <div style="
        margin-top:8px;
        font-size:28px;
        font-weight:700;
      ">
        IXI AOS
      </div>
    </div>

    <div style="padding:36px 32px;">
      <div style="
        font-size:12px;
        font-weight:700;
        letter-spacing:1.5px;
        color:#656b76;
      ">
        IDENTITY + ACCESS
      </div>

      <h1 style="
        margin:10px 0 18px;
        font-size:25px;
      ">
        You've been invited to IXI AOS.
      </h1>

      <p style="
        font-size:16px;
        line-height:1.6;
      ">
        Your company administrator created
        access for you in IXI AOS.
      </p>

      <div style="
        margin:26px 0;
        padding:18px;
        background:#f5f6f8;
        border-left:4px solid #111318;
      ">
        <div style="margin-bottom:12px;">
          <strong>Company</strong><br>
          ${safeCompany}
        </div>

        <div style="margin-bottom:12px;">
          <strong>Email</strong><br>
          ${safeEmail}
        </div>

        <div>
          <strong>Temporary password</strong><br>
          <span style="
            font-family:monospace;
            font-size:15px;
          ">
            ${safePassword}
          </span>
        </div>
      </div>

      <a
        href="${safeUrl}"
        style="
          display:inline-block;
          padding:13px 20px;
          background:#111318;
          color:#ffffff;
          text-decoration:none;
          font-weight:700;
        "
      >
        SET UP ACCESS
      </a>

      <p style="
        margin-top:24px;
        font-size:14px;
        line-height:1.5;
        color:#656b76;
      ">
        You will be required to choose a permanent
        password when you first sign in.
      </p>

      <p style="
        font-size:14px;
        color:#656b76;
      ">
        This invitation expires in 7 days.
      </p>

      <p style="
        margin-top:28px;
        font-size:12px;
        color:#777d87;
      ">
        If you weren't expecting this invitation,
        you can ignore this email.
      </p>
    </div>

    <div style="
      padding:20px 32px;
      border-top:1px solid #e4e6ea;
      color:#777d87;
      font-size:12px;
    ">
      IronXchange · IXI AOS
    </div>
  </div>
</body>
</html>`;


  return {
    subject,
    text,
    html,
    accessUrl
  };
}


async function sendTransactionalEmail({
  to,
  subject,
  text,
  html,
  messageTags = []
} = {}) {
  const recipient =
    normalizeEmail(
      to
    );

  if (
    !recipient ||
    !clean(subject)
  ) {
    throw identityError(
      "IXI_EMAIL_INPUT_REQUIRED",
      "Transactional email requires recipient and subject.",
      {},
      400
    );
  }


  const commandInput = {
    FromEmailAddress:
      `${SES_FROM_NAME} <${SES_FROM_EMAIL}>`,

    Destination: {
      ToAddresses: [
        recipient
      ]
    },

    ReplyToAddresses: [
      SES_REPLY_TO
    ],

    Content: {
      Simple: {
        Subject: {
          Data:
            clean(
              subject
            ),

          Charset:
            "UTF-8"
        },

        Body: {
          Text: {
            Data:
              String(
                text ??
                ""
              ),

            Charset:
              "UTF-8"
          },

          Html: {
            Data:
              String(
                html ??
                ""
              ),

            Charset:
              "UTF-8"
          }
        }
      }
    }
  };


  if (
    clean(
      SES_CONFIGURATION_SET
    )
  ) {
    commandInput.ConfigurationSetName =
      SES_CONFIGURATION_SET;
  }


  if (
    Array.isArray(
      messageTags
    ) &&
    messageTags.length
  ) {
    commandInput.EmailTags =
      messageTags;
  }


  const response =
    await client.send(
      new SendEmailCommand(
        commandInput
      )
    );


  return {
    provider:
      "amazon-ses",

    messageId:
      clean(
        response.MessageId
      ),

    accepted:
      Boolean(
        clean(
          response.MessageId
        )
      ),

    recipient
  };
}


async function sendEmployeeInvitation({
  email,
  temporaryPassword,
  invitationId,
  invitationToken,
  employeeId,
  entityId,
  companyName = "Your Company"
} = {}) {
  const content =
    buildEmployeeInvitationEmail({
      email,
      temporaryPassword,
      invitationId,
      invitationToken,
      companyName
    });


  const delivery =
    await sendTransactionalEmail({
      to:
        email,

      subject:
        content.subject,

      text:
        content.text,

      html:
        content.html,

      messageTags: [
        {
          Name:
            "ixi-message-type",

          Value:
            "employee-invite"
        },

        {
          Name:
            "ixi-entity",

          Value:
            clean(
              entityId
            ).replace(
              /[^A-Za-z0-9_-]/g,
              "_"
            ).slice(
              0,
              200
            ) || "unknown"
        }
      ]
    });


  return {
    ...delivery,

    invitationId:
      clean(
        invitationId
      ),

    employeeId:
      clean(
        employeeId
      ),

    entityId:
      clean(
        entityId
      )
  };
}


module.exports = {
  SES_FROM_EMAIL,
  SES_CONFIGURATION_SET,
  AOS_ACCESS_SETUP_URL,

  buildEmployeeAccessUrl,
  buildEmployeeInvitationEmail,

  sendTransactionalEmail,
  sendEmployeeInvitation
};
