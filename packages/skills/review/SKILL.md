---
name: review
description: Review ready-for-review Flowly changes, verify evidence, reject defects and reach guarded completion; use for code/QA review and Bug follow-up.
---

# Review & Defect Handling
Ready for Review is the **QA and reviewer handoff lane**, not a claim that QA has already passed. Implementation may be finished while Figma/Visual QA, device QA, reviewer approval, preview approval and QA checklist remain pending. Those gates block **Done**, not the handoff. Inspect `task.detail`, `task.blockers`, actual code/commit diff, tests, implementation report and current QA evidence. Do not accept self-reported PASS without valid proof. Medium/high risk requires explicit reviewer action; `task.review --verdict=approve|reject` must be invoked deliberately with reason.
Reject with a specific actionable defect; Flowly keeps an embedded Bug thread and returns a task to In Progress for fixes. `task.bug.create` and resolve require scoped evidence; post-Done defects become a linked separate top-level Bug via `task.post-done-bug`, never a reopened Done card.
Only invoke `task.transition --to=done` after current domain gates verify tests, QA, Review, open bugs, engineering reports and unfinished children. No screenshot receipt may auto-PASS or approve Preview.
