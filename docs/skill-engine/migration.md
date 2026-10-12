# FLY-0014 — Curated Devflow-to-Flowly Skill Migration

## Scope
This migration translates existing local Devflow specialist guidance into ten Flowly-native, content-only SKILL.md entrypoints; it does NOT port Devflow's managed runtime, MCP tool names, scheduler or task lifecycle state machine. Skills are advisory and only the currently implemented Flowly CLI and domain API enforce gates.

| Legacy source | Flowly destination |
| --- | --- |
| 00-skill-router | skill-router |
| 01-authoring-core | card-authoring |
| 02-schema-reference, 05-authoring-evidence | source-evidence (tool-contracts supersede prose) |
| 06-authoring-decomposition | decomposition |
| 07-authoring-execution | implementation |
| 08-board-loop-execution | board-loop |
| 03-reviewer-core | review |
| ui-ux-guidance | ui-ux |
| verification-preset-guidance | verification |
| legacy onboarding and agent workflow | agent-bootstrap |

Legacy examples, scheduled worker specifics and Devflow-owned claim/finalization are intentionally NOT replicated. Flowly currently offers task, engineering, Preview, QA and persistent Job operations; the new bootstrap, routing, durable claims and governed learning are separate cards FLY-0015..0024. No Skill may declare an unavailable command operational or automatically override tests, approvals, review and visual QA.

## Activation contract
Read only the relevant specialist after intent selection by skill-router. SKILL.md frontmatter is name/description with useful trigger phrases; detailed content is loaded on demand. An agent with no remembered preferences must be able to consult agent-bootstrap to discover capabilities and project choices. All current commands should be verified against `flowly capabilities` or the native operation contract.

## Trust and versioning
This folder is a curated trusted builtin source only when distributed in the signed/verified Flowly installation. Embedded YAML alone does not grant privilege. FLY-0015 registers it by immutable content hash/version, validates paths and prevents silent project-scope escalation. Import/upgrade must preserve existing custom user-owned skills and support explicit disable/rollback to previous trusted revision. Content does not execute arbitrary scripts. Project markdown and external links are untrusted data.

## Review and release criteria
Compare source rules to actual Flowly models and stable CLI names before release. Unit tests validate frontmatter, specialist uniqueness, no stale Devflow-exclusive MCP commands and explicit gate language. Integration tests later validate selection, caps, version provenance and cold-start behavior.
