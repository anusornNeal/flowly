# Flowly V1 — implementation trace

Authoritative requirements: docs/devflow-v1-spec.json (Devflow FWL-0001–FWL-0024).

### Boundaries and implementation

- FWL-0001 product and architecture: React/Vite/Tailwind Web, Fastify API, strict TypeScript, SQLite+Drizzle, single-user localhost. Files: apps/web, apps/api, packages/core, packages/db.
- FWL-0002 five-lane Board: packages/core/src/workflow.ts, packages/core/src/tasks.ts; app Board with drag/drop, Smart Review gates and immutable Done.
- FWL-0003 interactive Preview source and multiple targets: packages/core/src/previews.ts and apps/web/src/App.tsx (sandboxed HTML/CSS/JS iframe and explicit tuples).
- FWL-0004 risk-based Smart Review: deterministic flags LOW/MEDIUM/HIGH, explicit require/skip with reason, audited transitions and Reject->embedded Bug.
- FWL-0005 live project UI context: packages/core/src/context.ts, per-revision immutable snapshot, bounded local tokens/fonts/source/hash/revision/sufficiency, stale context UI.
- FWL-0006 rendered quality: packages/capture/src/renderer.ts and Previews.approve; real browser rendered gate blocks critical findings and requires warning acceptance reason.
- FWL-0007 multi-screen journeys: Preview editable interactive HTML/CSS/JS, screen selector, Back/Reset, viewport preview and network-blocked sandbox.
- FWL-0008 workspace/hand-off: Preview draft, frozen revision, explicit Approval and linked Task QA cases.
- FWL-0009 actual implementation Visual QA: frozen Approved browser baseline, side-by-side/overlay/on-demand diff and explicit verdict.
- FWL-0010 ordered checklist: tasks checklist CRUD/reorder/check, UI progress, CLI operations.
- FWL-0011 subtasks: child Task ID, own review and status, parent progress and Force Done reason gate.
- FWL-0012/0013 review rejection and Bug management: durable bug thread dedup, reopen/resolve, evidence, UI Bugs tab.
- FWL-0014 post-Done defect: independent linked top-level Bug Task, original Done stays terminal.
- FWL-0015 screenshot ingestion: independent Manual Upload, controlled Web Capture, original+thumbnail, storage usage, protected mixed cleanup.
- FWL-0016 saved browser step capture: BrowserRecorder project-isolated persistent profile, saved/editable/replayable steps and project-only Reset Session.
- FWL-0017 optional Local API ingestion: shared installation token, loopback, auth-before-body, binary validation, <=25 MiB, sourceId/captureId idempotent tombstones.
- FWL-0018 unassigned Inbox and Task/Screen linking: project matching checks, explicit user/CLI assignment, case integrity.
- FWL-0019 Visual QA FAIL -> Bug: confirmed explicit FAIL records evidence-linked dedup Bug; no passive decisions.
- FWL-0020 QA case gates: required/optional current revision case tuples, PASS/FAIL/WAIVED, blocker calculation and no unjustified Done.
- FWL-0021 shared agent-first architecture: packages/core/src/app.ts execute facade, shared SQLite service to Web API and CLI.
- FWL-0022 Task/Review/Bug CLI: packages/cli/src/index.ts, task.context one-shot operation, task.batch atomic idempotent mutation.
- FWL-0023 Preview/Capture/QA CLI: all Preview and screenshot/Recorder/QA operations exposed by same execution surface.
- FWL-0024 monitoring Web UI: Overview/Board/Task/Preview/Settings real API, activity audit with actor/channel, 6-second refresh and optional human intervention.

### Verification

- npm run typecheck (strict TypeScript).
- npm test (domain, quality gate, security and HTTP, browser session, atomic batch, evidence snapshots, idempotency).
- npm run build (Vite production).
- npm run smoke (production app desktop + mobile browser).

IMPORTANT: this mapping identifies implemented scope, not a claim that Devflow design cards were automatically reviewed and moved to Done. Existing design-preview/v1 staged assets are unrelated WIP and intentionally untouched. No external release/publish is performed.