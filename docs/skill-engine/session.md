# FLY-0022 — Durable Sessions and Parallel Ownership

`SkillSessions` persists scoped workstream leases transactionally in existing Flowly SQLite. The API deliberately **does not launch code editors, modify Tasks, or implicitly take work from another actor**.

## Operations
- `skills.session.claim` requires projectId, taskId, active workstream streamId, and stable sessionId; returns immutable lease ID, normalized ownedPaths and expiration.
- `skills.session.list` is read-only; includes active and expired entries (optionally released).
- `skills.session.renew` requires exact owning actor/session, updates the expiration.
- `skills.session.release` requires exact owning actor/session, writes auditable release; idempotent for repeated owner release.
- Same actor and same session can reclaim/reconnect idempotently; different actor/session cannot steal even an expired lease.
- Expired lease is a **blocker**, not proof that source/WIP is safe to overwrite. Owner must reconnect and release, or a future human-reviewed recovery workflow may be separately introduced.

Paths are normalized relative ownership from the validated existing engineering plan. Independent overlapping paths (including directory ancestor/child) cannot be concurrently claimed. All writes acquire SQLite IMMEDIATE lock before reading shared state. No cloud, cron or background network. Import, file deletion and rebase do not happen in claim operations.

A pending Job remains a distinct persisted Job contract; a lease is guidance/coordination, not actual OS/worktree filesystem lock. FLY-0023 records optional provenance. Future review must verify restart/concurrency/TTL/actor project isolation before release.
