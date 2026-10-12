---
name: card-authoring
description: Create precise implementation-ready Flowly tasks, subtasks and bug cards, with scope, acceptance criteria and verification; use when writing or editing cards.
---

# Card Authoring
Inspect the selected repository and existing task context before stating implementation details. Separate confirmed requirements from unresolved product decisions; do not invent APIs, paths, UI copy or acceptance evidence. Use `task.create` and `task.subtask` with an explicit project ID, title, description, priority, risk, acceptanceCriteria and verificationStep. Use `task.update` for scoped corrections; preserve existing work and history.
Describe current behavior, expected change, non-goals, edge cases, target code areas, dependencies and observable acceptance tests. One child card should own one independently implementable scope. Do not create unnecessary cards for trivial local changes when the existing Task/workflow is sufficient.
Draft cards begin in Backlog. Start work only after explicit intent, ownership/risk checks and the relevant engineering decision gate. Do not manufacture tests, reference URLs, screenshots or review approvals.
