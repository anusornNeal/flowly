# FWL-0002 — Flowly V1 Task Board workflow

This is the approved five-lane behavior implemented by `packages/core/src/workflow.ts` and `packages/core/src/tasks.ts`. It documents user-visible rules and verification, not additional permission to bypass them.

## Canonical lanes and transitions

| ID | Label | Meaning |
| --- | --- | --- |
| `backlog` | Backlog | Captured work not yet prioritized |
| `todo` | To-do | Work ready to start |
| `in-progress` | In Progress | Active implementation |
| `ready-for-review` | Ready for Review | Submitted implementation awaiting explicit review |
| `done` | Done | Terminal accepted work; cannot be reopened |

Task status is mutated only by deliberate CLI/Web commands. Invalid status IDs are rejected. The domain currently permits manually requested movement between nonterminal lanes; it does not silently advance lanes after tests, screenshot receipt, QA comparison, or subtask completion. `done` is immutable: drag-and-drop, CLI, and API attempts to move a Done card back are rejected (`DONE_IS_TERMINAL`). A post-Done issue creates a new linked top-level Bug Task in Backlog, preserving the original Task's immutable history.

## Smart Review decision

- Risk is **HIGH** if any security/permissions, destructive-data, schema-migration, public-contract, shared-runtime-config, system-wide or irreversible flag is set.
- Risk is **LOW** only when scope is local and reversible with explicit expected outcome, acceptance criteria and verification step, and without any high-risk flag.
- All other or unknown cases are **MEDIUM**. There is no numeric scoring.
- `auto`: LOW can finish without explicit Review; MEDIUM/HIGH require explicit reviewer approval. `require-review`: always require approval. `skip-review`: deliberate override, requiring a nonblank reason at MEDIUM/HIGH. Skip Review never bypasses tests, current Required QA, active Bugs or unfinished children.
- Explicit Review rejection (before Done) creates/reopens an embedded Review-origin Bug and returns the same Task from Ready for Review to In Progress. Fixing a Bug does not automatically approve or move the Task; it must be deliberately resubmitted and reviewed.

## Done gates and error feedback

All ordinary completion requests must satisfy actual recorded passing tests, completed checklist, and no unresolved embedded Bugs. Any linked Preview must be Approved. Every active Required QA Case for the current immutable Approved revision must have its own explicit current `PASS` or `WAIVED` (Optional cases do not block). Screenshot delivery, automatic comparison, or Awaiting User Review **never** counts as QA PASS. A still-effective WAIVED case stays WAIVED when new evidence arrives in the same revision; only an explicit PASS/FAIL or Cancel WAIVED changes that outcome.

Linked subtasks are independent Tasks, each with their own lane, Review and QA. An unfinished child normally blocks parent Done and shows child status. An explicit **Force Done** with a trimmed nonblank reason may bypass *only* that child-completion gate; children are not moved, and the audited parent transition records their IDs/statuses and the reason. Other independent Done gates still apply. Parent never auto-completes when children finish.

Validation failures return structured domain error codes and blocker lists where applicable (including `INVALID_LANE`, `DONE_IS_TERMINAL`, `TESTS_NOT_PASSED`, `REQUIRED_QA_NOT_CURRENT`, `REVIEW_NOT_APPROVED`, `REVIEW_SKIP_REASON_REQUIRED`, `UNFINISHED_SUBTASKS`, `FORCE_DONE_REASON_REQUIRED`, and `DONE_BLOCKED`). Actor/channel, before/after lane, timestamp, decisions and evidence are appended to the local audit history.

## Regression evidence

`tests/domain.test.ts`, `tests/advanced.test.ts` and `tests/revisions.test.ts` cover deterministic risk and Done, Force Done audit, Review reject/Bug roundtrip, Approved revision case refresh, WAIVED case receipt semantics and immutable post-Done behavior. `npm test`, `npm run typecheck`, `npm run build` and `npm run smoke` are the repository-wide checks.

**V1 exclusions:** No multi-user permissions, RBAC, cloud approval service, mandatory remote agent or auto-approval from passive evidence.
