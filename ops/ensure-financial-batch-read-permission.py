#!/usr/bin/env python3
"""Ensure the approved single-table read capability through the release operator."""
import fnmatch
import json
import pathlib
import subprocess

ACCOUNT = "459212966383"
ROLE = "EC2-SSM-Role"
POLICY_NAME = "IXITransactFinancialBatchRead"
TABLE = f"arn:aws:dynamodb:us-east-2:{ACCOUNT}:table/ixi-financial-v1"
EXPECTED_POLICY = {"Version": "2012-10-17", "Statement": [{
    "Sid": "ReadCurrentFinancialRecordsInBatches", "Effect": "Allow",
    "Action": "dynamodb:BatchGetItem", "Resource": TABLE
}]}


def aws(*args):
    result = subprocess.run(["aws", *args, "--output", "json"], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout or "{}")


def items(value):
    return value if isinstance(value, list) else [value]


def existing_table_read(document):
    for statement in items(document.get("Statement", [])):
        if statement.get("Effect") != "Allow" or statement.get("Condition"):
            continue
        actions = items(statement.get("Action", []))
        resources = items(statement.get("Resource", []))
        if (any(fnmatch.fnmatchcase("dynamodb:getitem", action.lower()) for action in actions)
                and any(fnmatch.fnmatchcase(TABLE, resource) for resource in resources)):
            return True
    return False


def ensure_permission(call=aws, desired=EXPECTED_POLICY):
    if desired != EXPECTED_POLICY:
        raise RuntimeError("Permission differs from the approved single-table read policy")
    if call("sts", "get-caller-identity").get("Account") != ACCOUNT:
        raise RuntimeError("Unexpected AWS account; no permission changed")
    role = call("iam", "get-role", "--role-name", ROLE)["Role"]
    if role.get("Arn") != f"arn:aws:iam::{ACCOUNT}:role/{ROLE}":
        raise RuntimeError("Unexpected runtime role; no permission changed")
    names = call("iam", "list-role-policies", "--role-name", ROLE)["PolicyNames"]
    documents = {name: call("iam", "get-role-policy", "--role-name", ROLE,
                            "--policy-name", name)["PolicyDocument"] for name in names}
    if POLICY_NAME in documents and documents[POLICY_NAME] != desired:
        raise RuntimeError("Existing named policy differs; refusing to overwrite it")
    attached = call("iam", "list-attached-role-policies", "--role-name", ROLE)["AttachedPolicies"]
    existing = list(documents.values())
    for policy in attached:
        arn = policy["PolicyArn"]
        version = call("iam", "get-policy", "--policy-arn", arn)["Policy"]["DefaultVersionId"]
        existing.append(call("iam", "get-policy-version", "--policy-arn", arn,
                             "--version-id", version)["PolicyVersion"]["Document"])
    if POLICY_NAME not in documents and (role.get("PermissionsBoundary") or any(
            statement.get("Effect") == "Deny" or "NotAction" in statement or "NotResource" in statement
            for document in existing for statement in items(document.get("Statement", [])))):
        raise RuntimeError("Existing denies, exclusions or permission boundary require administrator review; no permission changed")
    # Do not widen a condition-limited record scope. Existing explicit denies,
    # boundaries, managed policies and the role trust policy are never edited.
    if not any(existing_table_read(document) for document in existing):
        raise RuntimeError("Unconditional existing GetItem authority on this table was not proven; no permission changed")
    changed = POLICY_NAME not in documents
    if changed:
        call("iam", "put-role-policy", "--role-name", ROLE, "--policy-name", POLICY_NAME,
             "--policy-document", json.dumps(desired, separators=(",", ":")))
    installed = call("iam", "get-role-policy", "--role-name", ROLE,
                     "--policy-name", POLICY_NAME)["PolicyDocument"]
    if installed != desired:
        raise RuntimeError("Installed batch-read policy did not match the approved policy")
    return {"ok": True, "changed": changed, "role": ROLE, "policyName": POLICY_NAME,
            "table": TABLE, "existingReadScopePreserved": True, "otherPoliciesUnchanged": True}


if __name__ == "__main__":
    policy = json.loads(pathlib.Path(__file__).with_name("iam").joinpath("transact-financial-batch-read.json").read_text())
    print(json.dumps(ensure_permission(desired=policy)))
