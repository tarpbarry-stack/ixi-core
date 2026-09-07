"use strict";

const {
  createObject,
  ensureObjectCapabilities,
  getObject,
  updateObject
} = require(
  "../objects/objectService"
);

const {
  MosError
} = require(
  "../errors/MosError"
);

const {
  validateProvisioningInput
} = require(
  "./aosObjectProvisioningValidator"
);

const {
  beginProvisioning,
  completeProvisioning,
  failProvisioning
} = require(
  "./aosObjectProvisioningLedger"
);

const {
  AOS_PASSPORT_IDENTITY_TYPE,
  ensurePassportForAosObject,
  verifyAosObjectPassport
} = require(
  "./aosObjectPassportService"
);

const AOS_UNIVERSAL_OPERATING_CAPABILITIES = Object.freeze({
  canMove: true,
  canContain: true,
  canCreate: true,
  canOpenStack: true,
  canMoveToBoard: true,
  canTransact: true,
  canHaveDocuments: true,
  canHaveExpenses: true,
  canHaveWorkOrders: true,
  editable: true,
  hasConsole: true,
  hasRail: true,
  hasRelationships: true
});


/* =========================================================
   HELPERS
   ========================================================= */

function safeObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}


function mergePassportIdentity(
  identities,
  passportIdentity
) {
  const existing =
    Array.isArray(identities)
      ? identities
      : [];

  const filtered =
    existing.filter(
      identity =>
        identity?.identityType !==
        AOS_PASSPORT_IDENTITY_TYPE
    );

  return [
    ...filtered,
    passportIdentity
  ];
}


function getObjectPassportIdentity(
  object
) {
  return (
    Array.isArray(
      object?.identities
    )
      ? object.identities
      : []
  ).find(
    identity =>
      identity?.identityType ===
        AOS_PASSPORT_IDENTITY_TYPE
  ) || null;
}


/* =========================================================
   PROVISION
   ========================================================= */

function provisionAosObject(
  input = {},
  { adoptObjectId = "" } = {}
) {
  const {
    normalized,
    payloadHash
  } =
    validateProvisioningInput(
      input
    );

  const commandId =
    normalized.commandId;

  const begin =
    beginProvisioning({
      commandId,

      entityId:
        normalized.entityId,

      payloadHash
    });


  if (begin.replayed) {
    return {
      ...begin.result,
      replayed: true
    };
  }


  let object = null;
  let passport = null;


  try {

    /* -----------------------------------------------------
       1. CREATE AUTHORITATIVE MOS OBJECT

       objectService remains authoritative for:
       - customer definition resolution
       - required fields
       - business identifier policy
       - identifier uniqueness
       - capabilities
       - card template
       - customer-supplied name

       No customer business meaning is inferred here.
       ----------------------------------------------------- */

    if (adoptObjectId) {
      const existing = getObject(adoptObjectId);

      if (existing.entityId !== normalized.entityId) {
        throw new MosError(
          "AOS_PROVISION_ADOPTION_ENTITY_MISMATCH",
          "The existing AOS Object belongs to a different Entity.",
          { objectId: adoptObjectId, entityId: normalized.entityId },
          409
        );
      }

      if (
        normalized.objectType &&
        existing.objectType &&
        normalized.objectType !== existing.objectType
      ) {
        throw new MosError(
          "AOS_PROVISION_ADOPTION_TYPE_MISMATCH",
          "The existing AOS Object has a different object type.",
          {
            objectId: adoptObjectId,
            expectedObjectType: normalized.objectType,
            actualObjectType: existing.objectType
          },
          409
        );
      }

      const identityKeys = new Set();
      const identities = [
        ...(Array.isArray(existing.identities) ? existing.identities : []),
        ...normalized.identities
      ].filter(identity => {
        const key = JSON.stringify([
          identity?.identityType || "",
          identity?.sourceType || "",
          identity?.sourceId || "",
          identity?.passportId || ""
        ]);
        if (identityKeys.has(key)) return false;
        identityKeys.add(key);
        return true;
      });

      object = updateObject({
        objectId: existing.objectId,
        expectedRevision: existing.revision,
        commandId,
        displayName: normalized.displayName,
        businessIdentifiers: normalized.businessIdentifiers.length
          ? normalized.businessIdentifiers
          : existing.businessIdentifiers,
        value: normalized.value === null ? undefined : normalized.value,
        currency: normalized.currency,
        fields: {
          ...safeObject(existing.fields),
          ...normalized.fields
        },
        identities,
        media: normalized.media.length ? normalized.media : existing.media,
        cardTemplateSlug: normalized.cardTemplateSlug || existing.cardTemplateSlug,
        cardTemplateVersion:
          normalized.cardTemplateVersion ?? existing.cardTemplateVersion,
        actorId: normalized.actorId,
        metadata: {
          ...normalized.metadata,
          provisioning: {
            contractVersion: normalized.contractVersion,
            commandId,
            state: "object-adopted"
          }
        }
      });
    } else {
      object =
        createObject({
        entityId:
          normalized.entityId,

        definitionId:
          normalized.definitionId,

        definitionKey:
          normalized.definitionKey,

        objectType:
          normalized.objectType ||
          undefined,

        displayName:
          normalized.displayName,

        businessIdentifiers:
          normalized.businessIdentifiers,

        customerCategory:
          normalized.customerCategory,

        customerAssetId:
          normalized.customerAssetId,

        factualTitle:
          normalized.factualTitle,

        value:
          normalized.value,

        currency:
          normalized.currency,

        fields:
          normalized.fields,

        identities:
          normalized.identities,

        media:
          normalized.media,

        cardTemplateSlug:
          normalized.cardTemplateSlug,

        cardTemplateVersion:
          normalized.cardTemplateVersion,

        source:
          normalized.source,

        actorId:
          normalized.actorId,

        metadata: {
          ...normalized.metadata,

          provisioning: {
            contractVersion:
              normalized.contractVersion,

            commandId,

            state:
              "object-created"
          }
        }
        });
    }


    if (!object?.objectId) {
      throw new MosError(
        "AOS_PROVISION_OBJECT_CREATE_FAILED",
        "MOS object creation returned no objectId.",
        null,
        500
      );
    }

    object = ensureObjectCapabilities({
      objectId: object.objectId,
      requiredCapabilities: AOS_UNIVERSAL_OPERATING_CAPABILITIES,
      actorId: normalized.actorId
    });


    /* -----------------------------------------------------
       2. ENSURE IXI PASSPORT

       Technical identity only:
       sourceType = aos-object
       sourceId   = objectId
       ----------------------------------------------------- */

    const passportResult =
      ensurePassportForAosObject({
        objectId:
          object.objectId,

        entityId:
          object.entityId,

        trustedPassportId:
          normalized.trustedPassportId
      });


    passport =
      passportResult.passport;


    if (!passport?.passportId) {
      throw new MosError(
        "AOS_PROVISION_PASSPORT_CREATE_FAILED",
        "Passport provisioning returned no passportId.",
        {
          objectId:
            object.objectId
        },
        500
      );
    }


    /* -----------------------------------------------------
       3. PERSIST PASSPORT IDENTITY ON OBJECT
       ----------------------------------------------------- */

    const identities =
      mergePassportIdentity(
        object.identities,
        passportResult.identity
      );


    object =
      updateObject({
        objectId:
          object.objectId,

        identities,

        actorId:
          normalized.actorId,

        metadata: {
          ...safeObject(
            object.metadata
          ),

          transactEligible: true,

          provisioning: {
            contractVersion:
              normalized.contractVersion,

            commandId,

            state:
              "complete",

            passportProvisioned:
              true,

            passportId:
              passport.passportId,

            verified:
              true
          }
        }
      });


    /* -----------------------------------------------------
       4. VERIFY OBJECT-SIDE IDENTITY
       ----------------------------------------------------- */

    const objectIdentity =
      getObjectPassportIdentity(
        object
      );


    if (
      !objectIdentity ||
      objectIdentity.passportId !==
        passport.passportId ||
      objectIdentity.sourceType !==
        "aos-object" ||
      String(
        objectIdentity.sourceId ||
        ""
      ) !==
        String(
          object.objectId
        )
    ) {
      throw new MosError(
        "AOS_PROVISION_OBJECT_IDENTITY_FAILED",
        "Passport identity was not persisted correctly on the AOS Object.",
        {
          objectId:
            object.objectId,

          passportId:
            passport.passportId,

          objectIdentity:
            objectIdentity ||
            null
        },
        500
      );
    }


    /* -----------------------------------------------------
       5. VERIFY PASSPORT-SIDE IDENTITY
       ----------------------------------------------------- */

    const verifiedPassport =
      verifyAosObjectPassport({
        objectId:
          object.objectId,

        passportId:
          passport.passportId,

        entityId:
          object.entityId
      });


    /* -----------------------------------------------------
       6. RE-READ AUTHORITATIVE OBJECT
       ----------------------------------------------------- */

    const persistedObject =
      getObject(
        object.objectId
      );


    if (!persistedObject) {
      throw new MosError(
        "AOS_PROVISION_OBJECT_VERIFY_FAILED",
        "Provisioned AOS Object could not be re-read.",
        {
          objectId:
            object.objectId
        },
        500
      );
    }


    const persistedIdentity =
      getObjectPassportIdentity(
        persistedObject
      );


    if (
      !persistedIdentity ||
      persistedIdentity.passportId !==
        verifiedPassport.passportId
    ) {
      throw new MosError(
        "AOS_PROVISION_PERSISTENCE_VERIFY_FAILED",
        "Persisted AOS Object does not contain the verified IXI Passport identity.",
        {
          objectId:
            persistedObject.objectId,

          passportId:
            verifiedPassport.passportId
        },
        500
      );
    }


    /* -----------------------------------------------------
       7. COMPLETE PROVISIONING

       TRAN$ACT eligibility means financially addressable.
       It does not mean financial facts already exist.
       ----------------------------------------------------- */

    const result = {
      ok: true,

      contractVersion:
        normalized.contractVersion,

      commandId,

      replayed: false,

      object:
        persistedObject,

      passport:
        verifiedPassport,

      identity: {
        objectId:
          persistedObject.objectId,

        passportId:
          verifiedPassport.passportId
      },

      transact: {
        eligible: true,

        passportId:
          verifiedPassport.passportId,

        objectId:
          persistedObject.objectId
      },

      provisioning: {
        state:
          "complete",

        objectCreated:
          !adoptObjectId,

        objectAdopted:
          !!adoptObjectId,

        passportCreated:
          passportResult.created ===
          true,

        passportLinked:
          true,

        verified:
          true
      }
    };


    completeProvisioning({
      commandId,
      result
    });


    return result;

  } catch (error) {

    /*
     * Never silently create another permanent object
     * after a partial provisioning failure.
     */
    failProvisioning({
      commandId,
      error
    });


    throw error;
  }
}


/* =========================================================
   EXPORTS
   ========================================================= */

module.exports = {
  AOS_UNIVERSAL_OPERATING_CAPABILITIES,
  mergePassportIdentity,
  getObjectPassportIdentity,
  provisionAosObject
};
