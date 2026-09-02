"use strict";

/*
 * IXI ENTITY BINDING SERVICE
 *
 * Bridges IXI Identity entity context to the
 * authoritative AOS/MOS Entity.
 *
 * No customer-name matching.
 * No browser-trusted entity selection.
 */


const {
  entityPk,
  getItem,
  putItem
} =
  require(
    "./IXIIdentityDynamoStore"
  );


function clean(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


function bindingSk() {
  return "AOS_ENTITY_BINDING";
}


async function getEntityBinding(
  identityEntityId
) {
  const id =
    clean(
      identityEntityId
    );

  if (!id) {
    return null;
  }


  return getItem({
    PK:
      entityPk(
        id
      ),

    SK:
      bindingSk()
  });
}


async function bindIdentityEntityToAosEntity({
  identityEntityId,
  aosEntityId,
  actorId = ""
} = {}) {
  const identityId =
    clean(
      identityEntityId
    );

  const aosId =
    clean(
      aosEntityId
    );


  if (!identityId) {
    throw new Error(
      "identityEntityId is required."
    );
  }


  if (!aosId) {
    throw new Error(
      "aosEntityId is required."
    );
  }


  const timestamp =
    new Date()
      .toISOString();


  const item = {
    PK:
      entityPk(
        identityId
      ),

    SK:
      bindingSk(),

    entityType:
      "ixi-entity-binding",

    identityEntityId:
      identityId,

    aosEntityId:
      aosId,

    status:
      "active",

    createdAt:
      timestamp,

    updatedAt:
      timestamp,

    updatedBy:
      clean(
        actorId
      )
  };


  await putItem({
    item,

    conditionExpression:
      "attribute_not_exists(PK) AND attribute_not_exists(SK)"
  });


  return item;
}


async function resolveAosEntityId(
  identityEntityId
) {
  const binding =
    await getEntityBinding(
      identityEntityId
    );


  if (
    !binding ||
    clean(
      binding.status
    ) !==
      "active"
  ) {
    return "";
  }


  return clean(
    binding.aosEntityId
  );
}


module.exports = {
  getEntityBinding,
  bindIdentityEntityToAosEntity,
  resolveAosEntityId
};
