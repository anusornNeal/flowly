---
name: ui-ux
description: Design or verify Flowly preview and actual app UI including responsive layout, screenshot evidence and explicit QA; use for visual or interaction changes.
---

# UI/UX & Visual QA
For UI feature changes inspect project context, screen states, responsive constraints, typography and interaction behavior before editing. Preserve Flowly's monitoring-first Agent-CLI architecture and avoid requiring agents to click the UI for routine workflow.
Use Preview draft, explicit Screen/State/Viewport tuples, frozen revisions, and `preview.approve` only after real rendered quality evidence. Browser capture/replay applies to permitted localhost targets; other screenshots may be ingested manually or through authenticated local ingress. QA comparisons alone do not decide PASS/FAIL/WAIVED: invoke `qa.verdict` explicitly with linked evidence and reason when appropriate.
Verify desktop and mobile screenshots, layout overflow, accessibility, empty/error states and interaction. Do not fabricate a successful browser capture or publish a publicly accessible preview without confirmed privacy controls.
