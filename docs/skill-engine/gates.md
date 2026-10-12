# FLY-0020 — Skill Preflight Delegates to Existing Gates

`preflightSkillAction(app,input)` returns bounded read-only advice, not an approval. For `task.transition`, it executes the **actual** existing `Tasks.transition` validator inside `LocalStore.dryRun`, rolling back all Task and audit writes. Thus the same engineering, test, review, bug, QA, preview and child gates apply and must be rechecked when a real mutation occurs. Unsupported/future actions never report passing authorization.

For Review, QA, Preview approval and engineering decisions/workstreams, the adapter reports `explicit-action-required`; it does not perform a verdict or invent screenshot evidence. The user/agent must intentionally call the existing audited operation with truthful evidence.

Typed blockers and current status are returned for navigation. Cross-project task lookups throw `PROJECT_MISMATCH`. This does not create another writable state machine or elevate Skill markdown over domain rules. FLY-0021's shared operation facade can expose the adapter as `skills.preflight` without changing existing transition semantics.
