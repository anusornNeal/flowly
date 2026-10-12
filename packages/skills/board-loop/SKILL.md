---
name: board-loop
description: Keep processing eligible Flowly cards across fresh conversations and agent sessions; use when the user says continue, loop the board or finish the program.
---

# Board Loop
Treat 'continue' or 'finish' as instruction to advance safely through eligible work without repeated manual prompting, not permission to bypass gates. Choose and pin the exact Flowly project, then use `task.list` and `task.context` to inspect actionable cards and blockers. Prefer To-do unless the user explicitly included Backlog. A specific named card takes precedence.
Check whether an existing durable job is running/interrupted before launching another. Never fabricate a persisted claim or recover another agent's WIP; future FLY-0022 owns durable ownership semantics. If no claim API exists, coordinate scoped independent worktrees and report ambiguity. Parallel children can progress together when owned paths do not overlap and dependencies allow.
After verification update the actual card reports/next states, then reread the same project. Stop only when there is no safe eligible work in that scope or a genuine blocker, and report which card/condition remains.
