---
name: agent-bootstrap
description: Discover Flowly projects, CLI capabilities, pending work and safe next actions for a first-time ChatGPT or external agent without prior conversation history.
---

# Agent Bootstrap
1. Discover the current supported operations with `node bin/flowly.cjs capabilities` (or the equivalent connected Flowly operation). When advertised, prefer a one-call `flowly bootstrap` command.
2. List projects. If multiple projects are plausible, ask for an exact project choice. Never silently switch projects.
3. For the selected project inspect `task.list`; for a named card load `task.context --id=...`, `task.blockers`, and the minimum relevant specialist guidance.
4. When a task has a durable pending operation, inspect its job status before launching an equivalent operation.
5. A next-action suggestion is read-only, not an implementation claim. Do not invent cross-session ownership, override foreign WIP, approve a decision, or mark QA PASS. If the current runtime does not expose a claim API, state that honestly and coordinate through the available domain actions.
Prefer a bounded discovery flow. Never depend on ChatGPT memory, Relay Learn, or a prior account to know Flowly's rules.
