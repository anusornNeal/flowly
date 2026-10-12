# Flowly Engineering Delivery Standard

## Scope
These are product-level rules across all Flowly projects, not a project-specific agent memory or an optional external Devflow convention. Use the same persisted state, CLI, API and Task Detail UX.

## Parallel-first by default
1. Before implementation, break a large task into independent, clearly owned child cards/workstreams. Run independent investigation, implementation and tests concurrently; serialize only actual dependencies and shared resources.
2. Record each stream's stable ID, title, owned file paths, explicit dependency IDs and execution status using `engineering.parallel.plan`. Acyclic graphs are required. Two independent streams may not claim the same file path (case-insensitive on Windows); files may be shared only between dependency-ordered streams.
3. `engineering.parallel.next` returns the entire wave of unblocked pending streams, not just one item. Run the entire available wave concurrently when agent capacity allows, with separate worktrees or exclusive file ownership.
4. Status changes are explicit: pending -> in-progress -> done, and completing work requires concrete evidence. Plan topology locks once execution has started. Do not infer PASS from a screenshot or a passive status update.
5. Combine independent changes at integration time, run repository-wide checks, review together and clean up temporary worktrees after verified merge.

## Report policy
Small: compact optional pre-analysis; normal test/review rules remain. Medium: abbreviated decision comparison when alternatives materially differ. Large (explicit or >=3 child cards) and Critical (high-risk security, migrations, contracts, irreversible actions) require a current approved Decision Report and a recorded parallel plan **before entering In Progress**. Risk cannot be down-classified with a size override. Implementation Report is required for Large/Critical before Ready for Review or Done. For smaller work, agents should still record a compact post-implementation summary; the domain does not block completion for its absence.

### Pre-Implementation Decision Report
Required fields: requirements, current architecture, at least two alternative approaches (each with benefits, drawbacks and effort), impacts across maintainability/performance/API/risk, and a recommended approach. Use `engineering.decision.report` for versioned drafts. An actual decision maker deliberately invokes `engineering.decision.resolve` with APPROVE / REQUEST CHANGES / REJECT, selects a valid option for approval, and records a reason. Never auto-approve from file generation. A new report revision or material scope edit invalidates previous approval.

### Post-Implementation Report
Required fields: requirements summary, concrete changed files with summaries (or a reason for no code changes), technical decisions, alternatives/trade-offs, verification references, deviations and Git commit hashes. Use `engineering.implementation.report`; each saved version is numbered and audited. Only enter real test results. Changing the implementation report clears the previous code-review approval. Mark material deviations explicitly to require the decision maker to approve the decision again.

## Review and completion
Flowly retains existing explicit test, review, visual QA, preview approval, bug and child-task gates. Large/Critical cards additionally require the approved current decision, a parallel plan with all streams complete, and a valid implementation report. UI and CLI invoke the same domain rules. Existing historical Done cards remain immutable. Never bypass gates with false claims or inferred testing results.

## CLI/API operations
- `engineering.size`: set explicit size (auto / small / medium / large / critical).
- `engineering.decision.report`: save draft via `--report` JSON object.
- `engineering.decision.resolve`: approve or reject with reason and chosen approach ID.
- `engineering.parallel.plan`: save `workstreams` JSON array.
- `engineering.parallel.next`: read next independent runnable wave.
- `engineering.parallel.status`: update stream with `--evidence` when marking Done.
- `engineering.implementation.report`: save evidence-backed implementation report.
- `engineering.git.inspect`: read verified commit subject and file statuses from the configured local sourcePath, without inventing code explanations. Use the results to seed the post-implementation report.

All operations are also available through the loopback HTTP API and Task Detail tabs (Decision, Parallel, Implementation). Programmatic agents can send nested JSON via CLI `--input=@path.json`, avoiding shell quoting problems. Workflow reports never modify Jira or external systems.
