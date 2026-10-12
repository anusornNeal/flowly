---
name: skill-router
description: Choose the minimum Flowly specialist guidance for new or returning agents; use for every Flowly task or card action when action type is not yet established.
---

# Flowly Skill Router
Determine intent from the user's request, current project, card status and available CLI contracts. Start with agent-bootstrap on a fresh session; pin an explicit project once chosen. Load only the matching specialist:
- Draft/create card: card-authoring; add source-evidence only for supplied Jira/Figma/etc.
- Scope too large or parallelizable: decomposition; implementers additionally use implementation.
- Continue multiple cards: board-loop plus implementation.
- Review, failures or defects: review; UI review additionally ui-ux.
- Verify completion: verification.
Read a specialist in full only after selecting it; do not load all skill bodies into the same context. Skills are advisory; Flowly's existing domain gates and current `capabilities`/operation descriptions outrank stale prose. When several projects or plausible actions exist, request the smallest explicit choice instead of guessing. Never interpret this router as permission to mutate without an explicit task action.
