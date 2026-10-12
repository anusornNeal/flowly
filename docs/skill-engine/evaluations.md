# FLY-0026 — Offline Skill Engine Evaluation and Release Gates

Run `npm run verify:skill-engine` on the exact checked-out revision. It generates reproducible JSON metrics from a 31-case **Thai/English intent and Task-state** corpus plus real temporary SQLite FlowlyApp cold-start and cross-project behavior. Zero external calls, no LLM, no production DB mutation.

## Acceptance
- Accuracy: at least 95% correct first specialist on labelled representative fixtures (compare actual result count).
- Cold start: project ambiguity surfaced, explicit project selected, next-action respects a security/high-risk Decision Gate without Task/audit writes.
- Cross project: exact nonmatching Task/Project pair refused with a stable code.
- Gate bypass count: zero on the covered simulation; this is a **tested subset**, not proof no conceivable bypass exists.
- Measure and report route p95 millisecond latency, exact corpus size and failed cases, rather than inventing a performance estimate.
- Discovery target: 3 operations (bootstrap, next, guide) with actual CLI/HTTP parity covered by `tests/skills/integration.test.ts`.
- Mandatory release checks: `npm run typecheck`, `npm test` (includes **all** root and Skill tests), `npm run build`, `npm run smoke`, inspect changed Git files/reports and independent review. No automatic PASS from screenshots or route classification.

## Edge/safety coverage
Manifest hash/version validation, untrusted project skill prevention, on-demand content budgets, project isolation, ambiguous work, interrupted Job handling and QA/review blockers are exercised by the dedicated domain/integration/Skill tests. Faults or blockers must be reported honestly and not auto-waived.

## Follow-ups
FLY-0022 adds durable ownership, FLY-0023 enriches audit provenance, FLY-0024 governs learning, FLY-0025 adds monitoring UI; these are not considered complete solely because the P0 test suite passes.
