#!/usr/bin/env bash
# Run through the authenticated deployment workflow, never through a read-only audit connector.
set -Eeuo pipefail
: "${AWS_REGION:?AWS_REGION is required}"
: "${IXI_EXPECTED_ACCOUNT_ID:?Expected AWS account is required}"
: "${IXI_RECOVERY_BUCKET:?Private backup bucket is required}"
: "${IXI_RUNTIME_ROLE:?Existing runtime role is required}"
actual_account="$(aws sts get-caller-identity --query Account --output text)"
test "$actual_account" = "$IXI_EXPECTED_ACCOUNT_ID"
work="$(mktemp -d)"
trap 'rm "$work"/*.json; rmdir "$work"' EXIT

if ! aws s3api head-bucket --bucket "$IXI_RECOVERY_BUCKET" --expected-bucket-owner "$actual_account" 2>/dev/null; then
  aws s3api create-bucket --bucket "$IXI_RECOVERY_BUCKET" --region "$AWS_REGION" \
    --create-bucket-configuration "LocationConstraint=$AWS_REGION"
fi
aws s3api put-public-access-block --bucket "$IXI_RECOVERY_BUCKET" --expected-bucket-owner "$actual_account" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket "$IXI_RECOVERY_BUCKET" --expected-bucket-owner "$actual_account" \
  --versioning-configuration Status=Enabled
cat > "$work/encryption.json" <<'JSON'
{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}
JSON
aws s3api put-bucket-encryption --bucket "$IXI_RECOVERY_BUCKET" --expected-bucket-owner "$actual_account" \
  --server-side-encryption-configuration "file://$work/encryption.json"
cat > "$work/lifecycle.json" <<'JSON'
{"Rules":[{"ID":"RecoveryRetention","Status":"Enabled","Filter":{"Prefix":"recovery/"},"Expiration":{"Days":35},"NoncurrentVersionExpiration":{"NoncurrentDays":35},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}]}
JSON
aws s3api put-bucket-lifecycle-configuration --bucket "$IXI_RECOVERY_BUCKET" --expected-bucket-owner "$actual_account" \
  --lifecycle-configuration "file://$work/lifecycle.json"

jq -n --arg bucket "$IXI_RECOVERY_BUCKET" '{
  Version:"2012-10-17",Statement:[
    {Sid:"VerifyPrivateRecoveryBucket",Effect:"Allow",
     Action:["s3:GetBucketPublicAccessBlock","s3:GetBucketVersioning"],
     Resource:("arn:aws:s3:::"+$bucket)},
    {Sid:"WriteAndVerifyRecoveryVersions",Effect:"Allow",
     Action:["s3:PutObject","s3:GetObject","s3:GetObjectVersion"],
     Resource:("arn:aws:s3:::"+$bucket+"/recovery/*")}
  ]}' > "$work/recovery-policy.json"
aws iam put-role-policy --role-name "$IXI_RUNTIME_ROLE" --policy-name IXI-Verified-Recovery \
  --policy-document "file://$work/recovery-policy.json"

financial_arn="arn:aws:dynamodb:$AWS_REGION:$actual_account:table/ixi-financial-v1"
jq -n --arg table "$financial_arn" '{
  Version:"2012-10-17",Statement:[{
    Sid:"AtomicTreasuryBalanceUpdates",Effect:"Allow",Action:"dynamodb:UpdateItem",
    Resource:$table,Condition:{"ForAnyValue:StringEquals":{"dynamodb:EnclosingOperation":["TransactWriteItems"]}}
  }]}' > "$work/treasury-policy.json"
aws iam put-role-policy --role-name "$IXI_RUNTIME_ROLE" --policy-name IXI-Financial-Atomic-Treasury \
  --policy-document "file://$work/treasury-policy.json"
for table in ixi-financial-v1 IXIFreight IXITickets; do
  aws dynamodb update-continuous-backups --region "$AWS_REGION" --table-name "$table" \
    --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true,RecoveryPeriodInDays=35 >/dev/null
  status="$(aws dynamodb describe-continuous-backups --region "$AWS_REGION" --table-name "$table" \
    --query ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus --output text)"
  test "$status" = ENABLED
done
aws iam simulate-principal-policy --policy-source-arn "arn:aws:iam::$actual_account:role/$IXI_RUNTIME_ROLE" \
  --action-names dynamodb:UpdateItem --resource-arns "$financial_arn" \
  --context-entries ContextKeyName=dynamodb:EnclosingOperation,ContextKeyValues=TransactWriteItems,ContextKeyType=stringList \
  --query EvaluationResults > "$work/permission-check.json"
jq -e 'length == 1 and .[0].EvalDecision == "allowed"' "$work/permission-check.json" >/dev/null
echo "Private recovery storage, DynamoDB PITR, and atomic Treasury permission verified."
