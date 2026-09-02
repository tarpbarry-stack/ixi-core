"use strict";

const express =
  require("express");

const store =
  require(
    "./IXIAuthorityDynamoStore"
  );

const service =
  require(
    "./IXIAuthorityService"
  );

const {
  ixiAuthenticatedAuthorityRequest
} =
  require(
    "./IXIAuthorityRequest"
  );


const router =
  express.Router();


function clean(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


function sendError(
  res,
  operation,
  error
) {
  const statusCode =
    Number(
      error?.statusCode
    ) ||
    500;


  return res
    .status(
      statusCode >= 400 &&
      statusCode <= 599
        ? statusCode
        : 500
    )
    .json({
      ok:
        false,

      contract:
        "ixi-authority",

      contractVersion:
        "1.0.0",

      operation,

      data:
        null,

      errors: [
        {
          name:
            clean(
              error?.name
            ) ||
            "IXIAuthorityError",

          code:
            clean(
              error?.code
            ) ||
            "IXI_AUTHORITY_ERROR",

          message:
            clean(
              error?.message
            ) ||
            "IXI Authority request failed.",

          details:
            error?.details &&
            typeof error.details ===
              "object"
              ? error.details
              : {}
        }
      ],

      warnings:
        []
    });
}


/* =========================================================
   HEALTH
   ========================================================= */

router.get(
  "/health",
  async (
    req,
    res
  ) => {
    try {
      const health =
        await store
          .getAuthorityHealth();


      return res.json({
        ok:
          true,

        contract:
          "ixi-authority-health",

        contractVersion:
          "1.0.0",

        operation:
          "authority.health",

        data:
          health,

        errors:
          [],

        warnings:
          []
      });

    } catch (error) {
      return sendError(
        res,
        "authority.health",
        error
      );
    }
  }
);


/* =========================================================
   AUTHENTICATED ROUTES
   ========================================================= */

router.use(
  ixiAuthenticatedAuthorityRequest
);


router.get(
  "/access-context",
  async (
    req,
    res
  ) => {
    const principal =
      req.ixiAuthorityPrincipal;


    return res.json({
      ok:
        true,

      contract:
        "ixi-authority-access-context",

      contractVersion:
        "1.0.0",

      operation:
        "authority.access-context.read",

      data: {
        principal,

        capabilities: {
          directGrants:
            principal.directGrants,

          directDenies:
            principal.directDenies
        }
      },

      errors:
        [],

      warnings: [
        {
          name:
            "IXIAuthorityGraphDiscoveryPending",

          message:
            "Server-side ancestor/container policy discovery is not connected yet."
        }
      ]
    });
  }
);


router.get(
  "/policies/:passportId",
  async (
    req,
    res
  ) => {
    try {
      const record =
        await service
          .getPolicy(
            req.params.passportId
          );


      return res.json({
        ok:
          true,

        contract:
          "ixi-authority-policy",

        contractVersion:
          "1.0.0",

        operation:
          "authority.policy.read",

        data: {
          policy:
            record
              ?.policy ||
            null,

          revision:
            Number(
              record?.revision ||
              0
            )
        },

        errors:
          [],

        warnings:
          []
      });

    } catch (error) {
      return sendError(
        res,
        "authority.policy.read",
        error
      );
    }
  }
);


router.put(
  "/policies/:passportId",
  async (
    req,
    res
  ) => {
    try {
      const record =
        await service
          .savePolicy({
            passportId:
              req.params.passportId,

            policy:
              req.body,

            principal:
              req.ixiAuthorityPrincipal
          });


      return res.json({
        ok:
          true,

        contract:
          "ixi-authority-policy",

        contractVersion:
          "1.0.0",

        operation:
          "authority.policy.write",

        data: {
          policy:
            record.policy,

          revision:
            record.revision
        },

        errors:
          [],

        warnings:
          []
      });

    } catch (error) {
      return sendError(
        res,
        "authority.policy.write",
        error
      );
    }
  }
);


router.post(
  "/evaluate",
  async (
    req,
    res
  ) => {
    try {
      const decision =
        await service
          .evaluate({
            principal:
              req.ixiAuthorityPrincipal,

            capability:
              req.body?.capability,

            targetPassportId:
              req.body
                ?.targetPassportId,

            entityPassportId:
              req.body
                ?.entityPassportId,

            locationPassportId:
              req.body
                ?.locationPassportId
          });


      return res.json({
        ok:
          true,

        contract:
          "ixi-authority-decision",

        contractVersion:
          "1.0.0",

        operation:
          "authority.evaluate",

        data:
          decision,

        errors:
          [],

        warnings:
          []
      });

    } catch (error) {
      return sendError(
        res,
        "authority.evaluate",
        error
      );
    }
  }
);


module.exports =
  router;
