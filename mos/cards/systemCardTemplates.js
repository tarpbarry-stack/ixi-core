/*
 * =========================================================
 * IXI MOS
 * SYSTEM CARD TEMPLATE LIBRARY
 * =========================================================
 *
 * This file contains IXI-owned factory Card Templates.
 *
 * IMPORTANT:
 *
 * - Customer object names NEVER belong here.
 * - Customer container names NEVER belong here.
 * - Parent names NEVER determine template identity.
 * - Generic MOS engines must not add card-specific logic.
 *
 * Card definitions will be registered here only after
 * the generic Card Template engine is complete and tested.
 *
 * Example future entries:
 *
 * IXI Card #001
 * IXI Card #002
 * ...
 *
 * For now this registry is intentionally empty.
 * =========================================================
 */


const SYSTEM_CARD_TEMPLATES =
  Object.freeze([
    Object.freeze({
      templateSlug:
        "location-standard",

      templateNumber:
        1,

      version:
        1,

      baseObjectType:
        "location",

      label:
        "Location",

      librarySection:
        "LOCATIONS & FACILITIES",

      /*
       * Card-specific capability overrides only.
       *
       * Base MOS Location capabilities still come from
       * mos/objects/objectTemplates.js.
       */
      capabilities: {
        canContain:
          true
      },

      /*
       * Instance fields owned by the created Object.
       *
       * displayName is already a core MOS Object field
       * and therefore does not belong in this schema.
       */
      fieldSchema: [
        {
          field:
            "address1",

          label:
            "Address",

          type:
            "text"
        },

        {
          field:
            "address2",

          label:
            "Address 2",

          type:
            "text"
        },

        {
          field:
            "city",

          label:
            "City",

          type:
            "text"
        },

        {
          field:
            "state",

          label:
            "State",

          type:
            "text"
        },

        {
          field:
            "postalCode",

          label:
            "ZIP / Postal Code",

          type:
            "text"
        }
      ],

      /*
       * Presentation identities are slugs/contracts.
       *
       * The backend does not import React files.
       * The frontend renderer registry resolves these.
       */


      faceSchema: [
        {
          face:
            1,

          rendererSlug:
            "location-face-1"
        }
      ],

      presentation: {
        faceOneLayout: [
          {
            slotId:
              "container-preview",

            moduleType:
              "container-collection-preview"
          }
        ]
      },

      modules: [
        "asset-count",
        "asset-value",
        "employees",
        "relationships"
      ],

      worksheets: [],

      metadata: {
        source:
          "ixi-system-card-library",

        nativeWidth:
          298,

        nativeHeight:
          471
      }
    })
  ]);


function listSystemCardTemplates() {
  return [
    ...SYSTEM_CARD_TEMPLATES
  ];
}


module.exports = {
  SYSTEM_CARD_TEMPLATES,
  listSystemCardTemplates
};
