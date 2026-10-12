# FLY-0021 — Agent Skill Engine CLI/API Integration

Flowly exposes new shared JSON operations through **the same** `execute(app,op)` facade used by the existing local CLI and Fastify `/api/operations/:name` route. No duplicate permissions or workflow state machine.

| Operation | Purpose | Mutates? |
| --- | --- | --- |
| `bootstrap [--projectId]` | Versioned capabilities, project choice and initial hint | No |
| `next --projectId --taskId` | Blocker-aware next recommended action | No |
| `skills.list [--projectId]` | Bounded catalog metadata | No |
| `skills.get --id` | Exact versioned skill body/manifest | No |
| `skills.route --intent` | Version-pinned deterministic selection | No |
| `guide --intent --projectId` | Load selected full specialist bodies within budget | No |
| `skills.reference --id --reference` | Read declared safe references | No |
| `skills.import --projectId --content` | Import immutable project revision | Yes, audited |
| `skills.enable --id --enabled` | Explicit enable/disable with audit | Yes, audited |

All legacy operations remain available, including project.list whose discoverability contract is now repaired. A first-time agent can obtain a project choice, next action and matching Skill in <=3 discovery calls where scope is unambiguous. Read-only operations cannot acquire claims, approve changes or silently advance lanes. All actual Task/Engineering/Preview/QA/Review transitions remain validated by their existing domain services.

No cloud, built-in LLM, Relay dependency or authentication outside localhost is required. Manual CLI and HTTP act through the same app instance/service rules. For production evaluation, verify typecheck/tests/build/smoke, blank-install and cross-project isolation, version/hash mismatch, imported untrusted content and performance context budget. Do not claim deployment or release from integration unit tests alone.
