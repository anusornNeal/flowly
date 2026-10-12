# FLY-0025 — Skill Engine Monitoring & Admin UX

The new "Skill Engine" left navigation entry uses the existing Flowly monitoring-first layout, self-hosted LINE Seed Sans TH + Inter fonts, accessible labels and responsive single-column mobile fallback. No external network or extra dependency.

## UI behavior
- Catalog: verified Skill ID, immutable version and SHA preview, scope/trust, enable/disable action. UI mutations call existing audited CLI/API validators rather than inventing client-side permissions.
- Agent guidance: read-only `next` recommendation and a reason-coded `skills.route` preview for the current project/intent. Neither action starts execution or passes QA.
- Learning: pending/historical proposals, details, explicit approve/reject and rollback with revision-hash confirmation; server requires a separate reviewer actor for approval.
- Provenance: limited real history from `skills.audit.list`, never invented usage counts.
- Project selector is shared with rest of Flowly; changing projects reloads all backend data and clears stale selection. Mobile panels become vertically stacked; list scrolling is contained.

Tests verify nav wiring, operation contracts and responsive styles. Full E2E review must open the actual served page, confirm keyboard and mobile display, exercise real API mutations and inspect screenshots; a static source check alone is not sufficient for visual QA PASS.
