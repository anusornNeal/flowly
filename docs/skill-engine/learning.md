# FLY-0024 — Human-governed Adaptive Skill Learning

Learning suggestions are **versioned proposals**, never self-executing instructions. The Skill Engine continues working normally with learning disabled/unused.

`skills.learning.propose` accepts a project-owned Skill, next semantic version, complete candidate SKILL.md, concise correction rationale and optional evidence identifiers. It deduplicates equivalent proposals (same base+candidate hash/version). Project content never edits trusted builtin files.

`skills.learning.list/get` returns pending/closed proposals and a bounded preview. `skills.learning.decide` requires a distinct reviewer actor, an explicit reason and **exact hash confirmation** `APPLY:<first 12 hex>` to approve. Approval rechecks the pinned base digest and imports an immutable project-scoped revision transactionally. Rejection makes no Skill change. `skills.learning.rollback` requires `ROLLBACK:<proposal ID>` and a reason, disables the approved revision and enables the prior version; it never deletes history.

All actions generate bounded audit with proposal IDs, digests, actor and reason; never log complete candidate SKILL.md or secrets in audit. Approval does not change Task, QA or engineering approval authority. Builtin changes require a reviewed repository patch and independent code review; no runtime proposal may promote arbitrary content into trusted global policy.

Current Flowly is a localhost single-user workspace. Reviewer actor separation is a procedural auditable guard, not a substitute for an authenticated multi-user permissions framework. Full CLI/API contract tests, restart/rollback and UI approval checks are integration release criteria.
