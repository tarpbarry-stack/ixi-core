# IX-Core working rules

- Preserve the settled Object/Passport, relationship and session contracts in docs/AOS_STABILIZATION_2026-09.md.
- Keep identity resolution read-only; reuse a listing Passport through its verified AOS binding.
- Run npm test and the frontend's required paired gate against the intended backend commit.
- Deploy complete immutable runtime releases through the frontend repository's complete-release workflow.
  Feature-specific file overlays cannot establish a release and must not be reintroduced.
- Before production installation, require verified private recovery, bounded health checks and
  post-install manifest/canonical-data verification. Preserve runtime data during source rollback.
- Use the AWS audit connector for read-only inspection. Use the authorized deployment workflow for changes.
- Report source tests, deployment verification and remaining business-flow checks separately.

## Interactive read performance contract

- AOS/TRAN$ACT reads must not reread full Object/Passport registries for each card,
  edge or capability. Use the explicit canonical read scope and the existing
  Authority policy read scope; preserve every identity conflict and tenant check.
- Scopes end with the read operation. Never cache permission decisions, registry
  snapshots or inventory availability across requests to make a benchmark pass.
- Provisioning and financial commands cannot execute inside canonical read scopes.
  Keep fresh authority at every server request and reject writes within snapshots.
- Maintain the cold HTTP bootstrap registry budget (at most two reads of each
  registry including authentication) and the 200-object regression in npm test.
  Changing either budget requires a measured explanation, not deleting the check.
- Report fresh browser directory and worksheet readiness and gateway timings after
  deployment. A warm tab, a loading skeleton or a successful build is not proof.
