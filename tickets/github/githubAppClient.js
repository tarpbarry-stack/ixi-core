"use strict";

const crypto = require("crypto");

const {
  SecretsManagerClient,
  GetSecretValueCommand
} = require(
  "@aws-sdk/client-secrets-manager"
);

const {
  TicketError
} = require("../TicketError");

const {
  clean,
  safeArray
} = require("../util");

const REGION =
  process.env.AWS_REGION ||
  process.env.AWS_DEFAULT_REGION ||
  "us-east-2";

const SECRET_ID =
  process.env.IXI_TICKET_GITHUB_SECRET_ID ||
  "ixi/tickets/github-app";

const secrets =
  new SecretsManagerClient({
    region: REGION
  });

let secretCache = null;
let secretCacheAt = 0;

let tokenCache = null;
let tokenExpiresAt = 0;

function base64url(value) {
  return Buffer
    .from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createAppJwt({
  appId,
  privateKey
}) {
  const now =
    Math.floor(
      Date.now() / 1000
    );

  const header = {
    alg: "RS256",
    typ: "JWT"
  };

  const payload = {
    iat: now - 30,
    exp: now + 540,
    iss: String(appId)
  };

  const unsigned =
    `${base64url(JSON.stringify(header))}.` +
    `${base64url(JSON.stringify(payload))}`;

  const signer =
    crypto.createSign(
      "RSA-SHA256"
    );

  signer.update(unsigned);
  signer.end();

  const signature =
    signer.sign(
      privateKey
    );

  return (
    `${unsigned}.` +
    `${base64url(signature)}`
  );
}

async function loadGitHubSecret() {
  if (
    secretCache &&
    Date.now() - secretCacheAt <
      5 * 60 * 1000
  ) {
    return secretCache;
  }

  let response;

  try {
    response =
      await secrets.send(
        new GetSecretValueCommand({
          SecretId:
            SECRET_ID
        })
      );

  } catch (error) {
    throw new TicketError(
      "TICKET_GITHUB_SECRET_UNAVAILABLE",
      "IXI Ticket GitHub App secret could not be loaded.",
      {
        secretId:
          SECRET_ID,

        awsError:
          clean(
            error?.name
          )
      },
      503
    );
  }

  let parsed;

  try {
    parsed =
      JSON.parse(
        response.SecretString ||
        "{}"
      );

  } catch {
    throw new TicketError(
      "TICKET_GITHUB_SECRET_INVALID",
      "IXI Ticket GitHub App secret is not valid JSON.",
      {},
      500
    );
  }

  const config = {
    appId:
      clean(parsed.appId),

    installationId:
      clean(
        parsed.installationId
      ),

    privateKey:
      clean(
        parsed.privateKey
      ).replace(
        /\\n/g,
        "\n"
      ),

    owner:
      clean(
        parsed.owner
      ),

    repositories:
      safeArray(
        parsed.repositories
      )
        .map(clean)
        .filter(Boolean)
  };

  if (
    !config.appId ||
    !config.installationId ||
    !config.privateKey ||
    !config.owner
  ) {
    throw new TicketError(
      "TICKET_GITHUB_SECRET_INCOMPLETE",
      "IXI Ticket GitHub App secret is incomplete.",
      {},
      500
    );
  }

  secretCache =
    config;

  secretCacheAt =
    Date.now();

  return config;
}

async function githubFetch(
  path,
  {
    method = "GET",
    token = "",
    body = undefined,
    appJwt = ""
  } = {}
) {
  if (
    typeof fetch !==
    "function"
  ) {
    throw new TicketError(
      "TICKET_GITHUB_FETCH_UNAVAILABLE",
      "Node fetch is unavailable.",
      {},
      500
    );
  }

  const auth =
    clean(token)
      ? `Bearer ${clean(token)}`
      : `Bearer ${clean(appJwt)}`;

  const response =
    await fetch(
      `https://api.github.com${path}`,
      {
        method,

        headers: {
          Accept:
            "application/vnd.github+json",

          Authorization:
            auth,

          "X-GitHub-Api-Version":
            "2022-11-28",

          "User-Agent":
            "IXI-Ticket-Engine",

          ...(body !== undefined
            ? {
                "Content-Type":
                  "application/json"
              }
            : {})
        },

        body:
          body === undefined
            ? undefined
            : JSON.stringify(body)
      }
    );

  let payload = null;

  try {
    payload =
      await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error =
      new TicketError(
        "TICKET_GITHUB_REQUEST_FAILED",
        `GitHub API returned HTTP ${response.status}.`,
        {
          path,
          method,
          githubMessage:
            clean(
              payload?.message
            )
        },
        response.status >= 500
          ? 503
          : 502
      );

    error.githubStatus =
      response.status;

    throw error;
  }

  return payload;
}

async function getInstallationToken() {
  if (
    tokenCache &&
    Date.now() <
      tokenExpiresAt - 5 * 60 * 1000
  ) {
    return tokenCache;
  }

  const config =
    await loadGitHubSecret();

  const jwt =
    createAppJwt({
      appId:
        config.appId,

      privateKey:
        config.privateKey
    });

  const result =
    await githubFetch(
      `/app/installations/${encodeURIComponent(
        config.installationId
      )}/access_tokens`,
      {
        method:
          "POST",

        appJwt:
          jwt,

        body: {}
      }
    );

  const token =
    clean(
      result?.token
    );

  if (!token) {
    throw new TicketError(
      "TICKET_GITHUB_INSTALLATION_TOKEN_FAILED",
      "GitHub App installation token was not returned.",
      {},
      503
    );
  }

  tokenCache =
    token;

  tokenExpiresAt =
    Date.parse(
      result.expires_at ||
      ""
    ) ||
    (
      Date.now() +
      50 * 60 * 1000
    );

  return token;
}

async function getRepositoryConfig(
  repository
) {
  const config =
    await loadGitHubSecret();

  const repo =
    clean(repository);

  if (!repo) {
    throw new TicketError(
      "TICKET_REPOSITORY_REQUIRED",
      "Ticket repository is required.",
      {},
      400
    );
  }

  if (
    config.repositories.length &&
    !config.repositories.includes(
      repo
    )
  ) {
    throw new TicketError(
      "TICKET_REPOSITORY_NOT_ALLOWED",
      "Ticket repository is not allowed for this GitHub App.",
      {
        repository:
          repo
      },
      403
    );
  }

  return {
    owner:
      config.owner,
    repository:
      repo
  };
}

async function ensureLabel({
  owner,
  repository,
  name,
  description = ""
}) {
  const token =
    await getInstallationToken();

  try {
    await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/labels`,
      {
        method:
          "POST",

        token,

        body: {
          name:
            clean(name),

          description:
            clean(description),

          color:
            "ededed"
        }
      }
    );

  } catch (error) {
    if (
      error.githubStatus ===
      422
    ) {
      return;
    }

    throw error;
  }
}

async function findTicketIssue({
  repository,
  ticketId
}) {
  const {
    owner,
    repository: repo
  } =
    await getRepositoryConfig(
      repository
    );

  const token =
    await getInstallationToken();

  const marker =
    `IXI-TICKET:${clean(ticketId)}`;

  const query =
    `repo:${owner}/${repo} ` +
    `is:issue ` +
    `"${marker}" in:body`;

  const result =
    await githubFetch(
      `/search/issues?q=${encodeURIComponent(
        query
      )}&per_page=10`,
      {
        token
      }
    );

  const issue =
    safeArray(
      result?.items
    ).find(item => {
      return (
        clean(
          item?.body
        ).includes(
          marker
        )
      );
    });

  return issue || null;
}

async function createIssue({
  repository,
  title,
  body,
  labels = []
}) {
  const {
    owner,
    repository: repo
  } =
    await getRepositoryConfig(
      repository
    );

  const token =
    await getInstallationToken();

  const uniqueLabels =
    [
      ...new Set(
        safeArray(labels)
          .map(clean)
          .filter(Boolean)
      )
    ];

  for (
    const label
    of uniqueLabels
  ) {
    await ensureLabel({
      owner,
      repository:
        repo,
      name:
        label,
      description:
        "Managed by IXI Ticket Engine"
    });
  }

  return githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
    {
      method:
        "POST",

      token,

      body: {
        title:
          clean(title),

        body:
          clean(body),

        labels:
          uniqueLabels
      }
    }
  );
}

function describeGitHubAppClient() {
  return {
    provider:
      "github-app",

    secretId:
      SECRET_ID,

    region:
      REGION,

    authentication:
      "GitHub App installation token",

    credentialLocation:
      "AWS Secrets Manager",

    browserCredentialExposure:
      false
  };
}

module.exports = {
  loadGitHubSecret,
  getInstallationToken,
  getRepositoryConfig,
  findTicketIssue,
  createIssue,
  describeGitHubAppClient
};
