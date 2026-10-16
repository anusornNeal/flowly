---
name: implementation
description: Implement Flowly cards using guarded workflow decisions, repo edits, tests, card-numbered commits and evidence; use for coding and fixes.
---

# Implementation
Pin project/card before editing. Inspect the current repo and safe working tree, choose a scoped branch/worktree and avoid foreign WIP. For large/critical cards first submit a meaningful `engineering.decision.report` with alternatives and impacts; deliberately resolve the choice with `engineering.decision.resolve`, then record `engineering.parallel.plan` before moving In Progress.
Implement the requested delta in repository-native tools; do not run through Flowly as a file-edit proxy. Use the actual Flowly domain/CLI to record milestones; tests and screenshots do not automatically change workflow state. Run risk-appropriate verification after code is ready, commit with the card ID, and publish only on explicit user instruction.
Before Ready for Review, send `engineering.implementation.report` with changed paths, decisions, trade-offs, actual verification, deviations and verified commit hashes when required. Mark parallel streams done only with evidence.

**Implementation handoff:** After code and applicable implementation tests pass, required reports/parallel streams finish, and no unfinished implementation remains, explicitly run `task.transition --to=ready-for-review`. Do this even if Figma screenshots, Visual QA verdicts, physical-device QA, human review or QA checklist items are still pending; those are **Done** gates, not reasons to leave finished code In Progress. Record the pending QA truthfully and never auto-PASS, auto-review or auto-Done. `skills.next` recommends the handoff; it does not move the task for you.

Keep a task In Progress when code, integration, tests, open implementation defects or required workstreams are actually incomplete. Do not claim Done before every QA, review and child gate passes.
