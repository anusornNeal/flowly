# Flowly V1 — Locked product and engineering baseline

**Status:** scope consolidated from the approved FWL-0001 through FWL-0024 requirements. This document records decisions; it does not independently certify acceptance or visual QA.

## Product boundary

Flowly is a **single-user, localhost-only browser application** for coordinating development Tasks and visual QA of **Web, native Desktop and Mobile** applications. The Web application is the human monitoring and intervention surface. A **first-class, noninteractive local CLI** is the primary agent operating surface and must remain usable while the Web UI is closed. Both use the **same domain commands, SQLite state, validation, workflow gates and audit events**. An agent or user may deliberately execute valid Preview Approval, QA PASS/FAIL/WAIVED, Review and Done; no automatic decision follows from a screenshot or computed diff.

Five authoritative lanes: `backlog`, `todo`, `in-progress`, `ready-for-review`, `done`. Done is terminal. New defects after Done create independent linked top-level Bug Tasks, not reopened originals. Embedded checklist items and linked child Tasks coexist; children have independent identity and gates. An explicit Force Done reason may override only the unfinished-child condition, never the other gates.

### Review and visual QA

- Deterministic Smart Review uses **HIGH** for security, destructive, schema, public-contract, shared-config, system-wide or irreversible risk; **LOW** only for local, reversible, fully specified/verifiable work with no high-risk signal; **MEDIUM** otherwise. No arbitrary scoring.
- Require Review always reviews; Auto permits only LOW to skip explicit review; explicit Skip Review at MEDIUM/HIGH requires a reason. All modes preserve test, Preview, current QA, Bug and child gates.
- Interactive HTML/CSS/JS Preview uses a sandbox, revisioned drafts, explicit immutable freeze and approval. Critical rendered defects prevent approval; nonblocking warnings require an explicitly recorded justification.
- The QA matrix consists **only of explicitly defined Screen + UI State + viewport/window/device tuples**. Approval generates current Required cases; Optional does not block Done. Old-revision PASS/WAIVED never transfers automatically.
- For each active current Required case, only explicit PASS or case-scoped WAIVED satisfies its QA gate. Screenshot receipt, replay, visual comparison and automation only prepare evidence. New evidence does not silently cancel an existing waiver in the same revision. Explicit Cancel WAIVED returns a case to pending.

### Evidence and security

- Manual browser UI upload is independent of optional Local API, Relay, Computer Use, cloud or access tokens, and supports Web/Desktop/Mobile screenshot evidence.
- The optional external screenshot API is **loopback-only** and validates a single installation-wide generated token **before ingestion, deduplication or lookup**. Token persists across restarts; only confirmed regeneration revokes the old token. Never log or leak credentials/cookies.
- External image payloads are real PNG/JPEG/WebP binary multipart data, at most **25 MB** for this API. Invalid, corrupt, oversized or unauthorized submissions have no Screenshot/Inbox/QA/Bug/Capture-ID side effects.
- External `sourceId` is sender-declared, not authentication. Authenticated `sourceId + captureId` retries are idempotent. Cleanup retains the deleted key as a tombstone; retry cannot recreate it.
- Keep a single original, separate thumbnail, and compute visual Diff **on demand**. Cleanup is manual, per-original, and refuses deletion of evidence referenced by QA PASS/FAIL or Bug. Deleted History retains metadata without an openable image or restore.
- Built-in controlled-browser Recorder/Replay/Capture is **Web targets only**. Browser login Cookies and localStorage persist separately by Project, even if URLs match. Reset Session applies only to the selected Project, not other sessions or saved evidence.

## Engineering boundary

TypeScript strict mode, React + Vite, Node.js + Fastify, SQLite + Drizzle ORM, Tailwind tooling; a local-first modular monolith with domain services shared by CLI and Web API. CLI supports discovery/schemas, structured JSON, bounded pagination, input via flags/stdin/files, dry-run where safe, stable error codes, and durable asynchronous jobs for long captures/replays. The human UI is responsive and monitoring-first; user intervention is optional, not a mandatory agent handoff. Audit actions record actor/channel/time/revision and before/after states.

**Explicit exclusions:** multi-user accounts, login/RBAC, mandatory hosted service or cloud worker, mandatory ChatGPT/Relay/MCP, native Electron/Tauri/Rust shell, embedded LLM, automatic QA PASS or Review Approval, unrestricted LAN/public screenshot API.

## Open items and readiness (not scope changes)

There are **no remaining undecided V1 product policies** in this baseline. Release is still conditional on the actual Devflow implementation cards, test results, child evidence, independent visual-review outcomes and accepted gates being completed. The Cloudflare Pages **external preview website** is a separate optional distribution action: verify privacy/access policy before publishing. This baseline never authorizes publishing, bypassing a gate, inventing evidence, or changing a user-approved security boundary.
