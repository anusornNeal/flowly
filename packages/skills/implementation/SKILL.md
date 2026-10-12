---
name: implementation
description: Implement Flowly cards using guarded workflow decisions, repo edits, tests, card-numbered commits and evidence; use for coding and fixes.
---

# Implementation
Pin project/card before editing. Inspect the current repo and safe working tree, choose a scoped branch/worktree and avoid foreign WIP. For large/critical cards first submit a meaningful `engineering.decision.report` with alternatives and impacts; deliberately resolve the choice with `engineering.decision.resolve`, then record `engineering.parallel.plan` before moving In Progress.
Implement the requested delta in repository-native tools; do not run through Flowly as a file-edit proxy. Use the actual Flowly domain/CLI to record milestones; tests and screenshots do not automatically change workflow state. Run risk-appropriate verification after code is ready, commit with the card ID, and publish only on explicit user instruction.
Before Ready for Review, send `engineering.implementation.report` with changed paths, decisions, trade-offs, actual verification, deviations and verified commit hashes. Mark parallel streams done only with evidence. Do not claim Done before every test, QA, review and child gate passes.
