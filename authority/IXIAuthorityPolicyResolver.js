"use strict";

/*
 * IXI AUTHORITY POLICY RESOLVER
 *
 * Loads the effective policy chain in
 * specificity order:
 *
 * target
 * nearest ancestor
 * next ancestor
 * ...
 *
 * Ancestor policy participates only when its
 * propagateToChildren flag is enabled.
 */


const store =
  require(
    "./IXIAuthorityDynamoStore"
  );


const {
  normalizeAuthorityPolicy
} =
  require(
    "./IXIAuthorityContract"
  );


const {
  resolveAuthorityGraph
} =
  require(
    "./IXIAuthorityGraphResolver"
  );


function clean(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


async function loadPolicy(
  passportId
) {
  const id =
    clean(
      passportId
    );


  if (!id) {
    return null;
  }


  const record =
    await store
      .getCurrentPolicyRecord(
        id
      );


  if (!record?.policy) {
    return null;
  }


  return {
    record,

    policy:
      normalizeAuthorityPolicy(
        record.policy
      )
  };
}


async function resolveAuthorityPolicyChain(
  targetPassportId
) {
  const targetId =
    clean(
      targetPassportId
    );


  const graph =
    resolveAuthorityGraph(
      targetId
    );


  const chain =
    [];


  const targetPolicy =
    await loadPolicy(
      targetId
    );


  if (targetPolicy) {
    chain.push({
      relationship:
        "target",

      distance:
        0,

      passportId:
        targetId,

      policy:
        targetPolicy.policy,

      revision:
        Number(
          targetPolicy
            .record
            .revision ||
          0
        )
    });
  }


  for (
    let index = 0;
    index <
      graph.ancestorPassportIds.length;
    index += 1
  ) {
    const passportId =
      graph
        .ancestorPassportIds[
          index
        ];


    const resolved =
      await loadPolicy(
        passportId
      );


    if (!resolved) {
      continue;
    }


    if (
      resolved
        .policy
        .inheritance
        .propagateToChildren !==
      true
    ) {
      continue;
    }


    chain.push({
      relationship:
        "ancestor",

      distance:
        index + 1,

      passportId,

      policy:
        resolved.policy,

      revision:
        Number(
          resolved
            .record
            .revision ||
          0
        )
    });
  }


  return {
    targetPassportId:
      targetId,

    graph,

    chain,

    policies:
      chain.map(
        item =>
          item.policy
      )
  };
}


module.exports = {
  loadPolicy,
  resolveAuthorityPolicyChain
};
