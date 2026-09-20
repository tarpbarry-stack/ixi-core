# Authority batch read runtime capability

Fresh production tracing on 2026-09-20 measured 3503.6 ms in policy reads during
TRAN$ACT bootstrap. The request-scoped reader now batches the same policy keys,
using consistent reads, bounded concurrency and retries, and unchanged decisions.

The complete release probes BatchGetItem on `ixi-aos-authority-v1` before stopping
the service. If denied, an authorized AWS administrator must add the adjacent
single-table policy as `IXITransactAuthorityBatchRead` on `EC2-SSM-Role`, account
459212966383. This grants one read operation on one table. It grants no writes,
other tables or IAM administration. Do not broaden the release operator or change
trust policies, boundaries or explicit denies. Existing authorization remains.

Console: IAM → Roles → EC2-SSM-Role → Add permissions → Create inline policy →
JSON. Paste the adjacent JSON, name it IXITransactAuthorityBatchRead, and create.
Only do this when the runtime preflight establishes the missing permission.
Then rerun the exact paired complete release and verify recovery, source, identity,
health and fresh browser timing. A successful build alone does not prove speed.
