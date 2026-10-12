---
name: verification
description: Select and run bounded Flowly repository verification, preserve accurate proof and complete change reports; use before review or commit.
---

# Verification
Inspect the current changed file set and package scripts before selecting commands. Prefer targeted tests for local leaves, broader tests for contracts/shared runtime, and full repository typecheck/test/build/smoke for integration milestones.
Do not mark `task.tests --passed=true` unless a real relevant verification completed successfully; attach concise actual evidence. Keep exact tested Git revision, command, exit code, test summary, and affected paths together. Failures remain failures with blocker details; do not generate false PASS data.
When required, use `engineering.implementation.report` with verified Git hashes, alternatives/trade-offs, actual changed paths and deviations. A clean commit alone does not establish Review, QA or Done. Preserve non-Git WIP and only cleanup verified merged worktrees.
