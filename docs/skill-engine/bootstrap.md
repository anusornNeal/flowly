# FLY-0016 — Zero-context Agent Bootstrap

`getAgentBootstrap(app,{projectId?,sessionId?})` provides bounded advisory discovery for fresh agents with no prior conversation.

- No projects: `NO_PROJECTS` / `project.create` hint, never automatic creation.
- Exactly one project: deterministic selection.
- Multiple projects: `PROJECT_SELECTION_REQUIRED`, return a bounded list; no implicit picking.
- Explicit unknown project: typed `NOT_FOUND`; never silently switch projects.
- Project contains one top-level unfinished task: `task.context` hint.
- Multiple unfinished tasks: `TASK_SELECTION_REQUIRED`, candidates ordered by lane/priority/age for display only; never auto-claim.
- No unfinished tasks: `NO_UNFINISHED_TASKS` / `task.list` hint, not fabricated work.

Bootstrap is strictly read-only and calls Flowly's current authoritative domain services. Neither `task.transition`, evidence/QA judgments, ownership nor engineering approval is implied by a suggestion. The CLI/API exposure is reserved for FLY-0021 and richer blocker-aware recommendations for FLY-0019. Durable ownership is reserved for FLY-0022; until then, an agent must not assume a claim exists.

Verification uses empty/one/multiple projects, explicit ID, cross-project isolation, stable ordering and no audit mutation; later integration must measure cold-start toolcall count and security regression.
