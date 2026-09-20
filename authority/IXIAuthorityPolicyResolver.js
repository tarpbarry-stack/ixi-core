"use strict";

const {
  AsyncLocalStorage
} = require("node:async_hooks");

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


const { createPolicyReadQueue } = require("./IXIAuthorityBatchRead");

const authorityPolicyReadScope =
  new AsyncLocalStorage();


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


  const scope = authorityPolicyReadScope.getStore();
  const scopedRecords = scope?.records;

  let recordRequest =
    scopedRecords?.get(id);

  if (!recordRequest) {
    recordRequest =
      scope ? scope.readPolicy(id) : store.getCurrentPolicyRecord(id);

    scopedRecords?.set(id, recordRequest);
  }

  let record;

  try {
    record = await recordRequest;
  } catch (error) {
    if (scopedRecords?.get(id) === recordRequest) {
      scopedRecords.delete(id);
    }

    throw error;
  }


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


function withAuthorityPolicyReadScope(callback) {
  if (typeof callback !== "function") {
    throw new TypeError(
      "Authority policy read scope requires a callback."
    );
  }

  if (authorityPolicyReadScope.getStore()) {
    return callback();
  }

  return authorityPolicyReadScope.run(
    { records: new Map(), chains: new Map(),
      readPolicy: createPolicyReadQueue(ids => store.getCurrentPolicyRecords(ids)) },
    callback
  );
}


async function resolveAuthorityPolicyChainUncached(
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


  // Request the complete chain together, then retain specificity order below.
  const [targetPolicy, ...ancestorPolicies] = await Promise.all(
    [targetId, ...graph.ancestorPassportIds].map(loadPolicy)
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


    const resolved = ancestorPolicies[index];


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


function resolveAuthorityPolicyChain(targetPassportId) {
  const targetId = clean(targetPassportId);
  const chains = authorityPolicyReadScope.getStore()?.chains;
  if (!chains) return resolveAuthorityPolicyChainUncached(targetId);

  let request = chains.get(targetId);
  if (!request) {
    // Only the graph and policy inputs are shared. Decisions remain specific
    // to each principal and capability, and nothing survives this read scope.
    request = resolveAuthorityPolicyChainUncached(targetId).catch(error => {
      if (chains.get(targetId) === request) chains.delete(targetId);
      throw error;
    });
    chains.set(targetId, request);
  }
  return request;
}

module.exports = {
  loadPolicy,
  resolveAuthorityPolicyChain,
  withAuthorityPolicyReadScope
};
