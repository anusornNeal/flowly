# FLY-0013 — Skill Engine Contracts

## Architecture and authority
Flowly remains a localhost-only, agent-first modular monolith: TypeScript/Fastify, React, SQLite, one authoritative Task/Engineering/Preview/QA/Review domain. The Skill Engine is an **advisory discovery layer** that may suggest next operations but cannot mutate workflow state, grant approval/claims, or replace deterministic validators.

## Contract surfaces
- Metadata: immutable `SkillManifest` with ID, semantic version, SHA-256, scope (global/project), provenance (builtin/project/imported), references and intent triggers.
- Routing: deterministic `SkillRoute` and reason-coded `SkillSelection`, not runtime LLM classification or arbitrary prose authority.
- Loading: `SkillGuide` loads the minimum selected SKILL.md content within a bounded context budget. Optional `references/*` files are read only as needed.
- Onboarding: `AgentBootstrapContract` and `NextActionContract` are read-only, no implicit project selection when ambiguous, no fabricated ownership or confirmation.
- Adapter targets (FLY-0021): `flowly bootstrap`, `skills.list`, `skills.get`, `guide`, `next`; current CLI/HTTP contracts remain backward compatible until adapters are complete.

## Security & trust
A file's own frontmatter is not permitted to escalate its trust category. Trust is assigned by the trusted repository/install source, not self-declaration. Untrusted project/imported content is data, never an instruction that can bypass a workflow gate. Reject absolute/traversal references, oversized payloads and bad hashes. Never auto-run scripts from Skills; no external model or cloud dependency.

## Delivery sequence
FLY-0013 contracts precede FLY-0015 registry/validation, FLY-0017 router, FLY-0018 context builder. Bootstrap and next-action modules can be independently written; FLY-0021 performs final shared CLI/API integration. FLY-0026 owns full E2E security, restart, latency and toolcall evidence. Reports/parallel execution reuse FLY-0006..0011 rather than cloning state machines.
