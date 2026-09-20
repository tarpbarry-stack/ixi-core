"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const harness = `
import importlib.util, json, sys
spec=importlib.util.spec_from_file_location("grant",sys.argv[1])
grant=importlib.util.module_from_spec(spec); spec.loader.exec_module(grant)
class Fixture:
    def __init__(self, account=grant.ACCOUNT, existing=None, conditioned=False, managed=False):
        self.calls=[]; self.account=account; self.managed=managed
        self.read={"Statement":[{"Effect":"Allow","Action":["dynamodb:GetItem"],"Resource":grant.TABLE}]}
        if conditioned: self.read["Statement"][0]["Condition"]={"ForAllValues:StringEquals":{"dynamodb:LeadingKeys":["limited"]}}
        self.policies={} if managed else {"ExistingFinancialRead":self.read}
        if existing is not None: self.policies[grant.POLICY_NAME]=existing
    def __call__(self,*args):
        self.calls.append(args); operation=args[1]
        if operation=="get-caller-identity": return {"Account":self.account}
        if operation=="get-role": return {"Role":{"Arn":f"arn:aws:iam::{grant.ACCOUNT}:role/{grant.ROLE}","PermissionsBoundary":{"PermissionsBoundaryArn":"unchanged"}}}
        if operation=="list-role-policies": return {"PolicyNames":list(self.policies)}
        if operation=="get-role-policy": return {"PolicyDocument":self.policies[args[args.index("--policy-name")+1]]}
        if operation=="list-attached-role-policies": return {"AttachedPolicies":[{"PolicyArn":"managed-read"}] if self.managed else []}
        if operation=="get-policy": return {"Policy":{"DefaultVersionId":"v1"}}
        if operation=="get-policy-version": return {"PolicyVersion":{"Document":self.read}}
        if operation=="put-role-policy":
            assert args[args.index("--role-name")+1]==grant.ROLE
            name=args[args.index("--policy-name")+1]
            assert name==grant.POLICY_NAME
            self.policies[name]=json.loads(args[args.index("--policy-document")+1]); return {}
        raise AssertionError(args)
    def writes(self): return [call for call in self.calls if call[1].startswith(("put-","delete-","attach-","update-"))]
def blocked(fixture, desired=grant.EXPECTED_POLICY):
    try: grant.ensure_permission(fixture,desired)
    except RuntimeError: pass
    else: raise AssertionError("Expected permission change to be rejected")
    assert not fixture.writes()
`;

function check(code) {
  const result = spawnSync("python3", ["-c", harness + "\n" + code,
    path.join(__dirname, "ensure-financial-batch-read-permission.py")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("approved batch-read provisioning writes only the exact new table policy", () => check(`
fixture=Fixture(); result=grant.ensure_permission(fixture)
assert result["changed"] is True
assert len(fixture.writes())==1
assert fixture.policies[grant.POLICY_NAME]==grant.EXPECTED_POLICY
assert fixture.policies["ExistingFinancialRead"]==fixture.read
`));
test("an already correct read policy is verified without another IAM write", () => check(`
fixture=Fixture(existing=grant.EXPECTED_POLICY)
assert grant.ensure_permission(fixture)["changed"] is False
assert not fixture.writes()
`));
test("wrong account, policy collisions and broader requested grants cannot write IAM", () => check(`
blocked(Fixture(account="other-account"))
blocked(Fixture(existing={"Statement":[]}))
blocked(Fixture(),{"Statement":[{"Effect":"Allow","Action":"*","Resource":"*"}]})
`));
test("conditional existing record permissions cannot be widened by batch-read provisioning", () => check(`
blocked(Fixture(conditioned=True))
`));
test("existing managed table-read authority is inspected before adding the approved operation", () => check(`
fixture=Fixture(managed=True)
assert grant.ensure_permission(fixture)["changed"] is True
assert any(call[1]=="get-policy-version" for call in fixture.calls)
assert len(fixture.writes())==1
`));
test("unrelated action or table authority is insufficient to grant financial batch reads", () => check(`
for statement in [{"Effect":"Allow","Action":"dynamodb:GetItem","Resource":"other-table"},
                  {"Effect":"Allow","Action":"dynamodb:Query","Resource":grant.TABLE}]:
    fixture=Fixture(); fixture.policies={"Unrelated":{"Statement":[statement]}}; blocked(fixture)
`));
