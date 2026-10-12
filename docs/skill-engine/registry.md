# FLY-0015 — Skill Registry and Validation

The registry uses trusted bundled `packages/skills/*/SKILL.md` entrypoints and an existing SQLite settings table for versioned, project-scoped custom Skill revisions. No new DB table or migration is necessary. Each installed revision has immutable content + SHA-256; duplicates with the same bytes are idempotent, but a hash mismatch at the same version is rejected.

`SkillRegistry(store)`: `list({projectId?,includeDisabled?})`, `get({id,projectId?,version?})`, `importProject({projectId,content,version?,triggers?},actor)`, `setEnabled({id,version?,projectId?,enabled},actor)`, `readReference(...)`.

Trusted builtins are loaded from code-distributed directory only. A project's imported YAML cannot claim builtin authority, shadow builtin names or read arbitrary filesystem paths. All project changes are explicit, transaction-protected and audited without logging complete Skill content. Disabling does not destroy immutable revisions; a previous version can be explicitly re-enabled for rollback. Local content never automatically executes scripts.

Strict limits prevent excessive content/indices. The registry distinguishes pure metadata listing from full body retrieval, enabling later progressive loading and exact version pinning.

CLI/API exposure is implemented in FLY-0021, routing in FLY-0017, guidance budgets in FLY-0018. Security validation remains backend-owned and Skills cannot permit restricted domain transitions.
