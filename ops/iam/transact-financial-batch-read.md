# Approved runtime read permission

Status: user authorized proceeding with the single-table read permission on
2026-09-20 after the deployment denial was explained. Application completed by the administrator on 2026-09-20; complete release
35523278167 attempt 2 proved financialBatchReadAuthorized=true.
The release operator was subsequently denied iam:GetRole in run 35522733627;
no IAM permission or runtime installation occurred.

Production release run 35521181449 stopped before service shutdown on 2026-09-20.
AWS denied `dynamodb:BatchGetItem` to the runtime role `EC2-SSM-Role` for
`arn:aws:dynamodb:us-east-2:459212966383:table/ixi-financial-v1`.
That failure left backend 0c2e80dd590258309ff4d1823b8c35cb433d50f4 installed;
the subsequent successful complete release installed the financial batch reader.

Proposed change: attach the adjacent policy as a dedicated inline policy named
`IXITransactFinancialBatchRead` on `EC2-SSM-Role` in account 459212966383.
It adds one read operation on one table. It grants no writes, deletes, other tables,
or IAM administration. Application authorization and consistent-read behavior remain.

An authorized AWS administrator can run `ops/ensure-financial-batch-read-permission.py`
with the adjacent policy. Routine deployments do not administer IAM, and the
release account must not be expanded to do so. The script checks the account, role and existing
policies, proves pre-existing unrestricted GetItem access to this same table, and
refuses to replace a different policy under the chosen name. Existing explicit
denies, permission boundaries and trust policies are never edited. A new grant
also stops for any existing deny, exclusion or permission boundary so an
administrator can review their effect on batch access. An identical
installed policy is verified without another write. The runtime capability probe
still must independently succeed; this step does not bypass it.
Do not use the read-only AWS audit connector to make the change.

After application, continue the complete paired release with its exact tested core
pin. The batch reader was first tested at core 2a684ff2e6e8ee1bbc0a87654ea9ac96678213e5.
The existing capability probe must pass before service shutdown. Require complete
recovery, source, data-integrity and health evidence, then measure fresh TRAN$ACT
directory and worksheet readiness. The exact paired candidate passed 1,007 tests.
Do not report the performance work complete before live measurements pass.
