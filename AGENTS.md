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
