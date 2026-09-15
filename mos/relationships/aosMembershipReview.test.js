"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { buildAosMembershipReview } = require("./aosMembershipReview");

test("authorized unresolved and invalid edges remain reviewable without becoming members", () => {
  const root = { objectId: "index", entityId: "tenant", objectType: "system-index" };
  const location = { objectId: "location", entityId: "tenant", objectType: "location" };
  const machine = { objectId: "machine", entityId: "tenant", objectType: "machine" };
  const edges = [location, machine].map(object => ({
    entityId: "tenant", relationshipId: `edge-${object.objectId}`, revision: 3,
    sourceObjectId: object.objectId, targetObjectId: root.objectId,
    status: "active", behaviorId: "aos.rail-membership.v1"
  }));
  const objects = [root, location, machine];
  const before = structuredClone({ objects, edges });
  const unresolved = buildAosMembershipReview(edges, objects).index;
  assert.equal(unresolved.state, "unresolved");
  assert.deepEqual(unresolved.issues.map(issue => issue.state), ["unresolved", "unresolved"]);
  const configured = { ...root, metadata: { systemIndexMembershipPolicy: {
    schema: "aos.system-index-membership.v1", enabled: true, defaultWorkspaceHome: false,
    allowedObjectTypes: ["location"], allowedDefinitionIds: []
  } } };
  const reviewed = buildAosMembershipReview(edges, [configured, location, machine]).index;
  assert.equal(reviewed.state, "resolved");
  assert.deepEqual(reviewed.issues.map(issue => [issue.objectId, issue.state, issue.membershipAllowed]), [["machine", "invalid", false]]);
  assert.deepEqual({ objects, edges }, before);
  assert.deepEqual(buildAosMembershipReview(edges, [root]).index.issues, []);
  assert.deepEqual(buildAosMembershipReview(edges, [root, { ...machine, entityId: "foreign" }]).index.issues, []);
  assert.deepEqual(buildAosMembershipReview(edges.map(edge => ({ ...edge, status: "ended" })), objects).index.issues, []);
});
