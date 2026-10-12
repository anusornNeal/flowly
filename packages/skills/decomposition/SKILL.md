---
name: decomposition
description: Split substantial Flowly work into independent child cards and parallel workstreams with explicit ownership and dependency DAGs.
---

# Decomposition & Parallel Planning
Inspect the parent task and source tree, then create child scopes with clear acceptance and tests. For large/critical work write `engineering.decision.report`, compare at least two credible approaches, then request an actual explicit `engineering.decision.resolve` before implementation.
Define `engineering.parallel.plan` with >=2 workstreams, stable IDs, exclusive ownedPaths, acyclic dependsOn, status pending. Use `engineering.parallel.next` to identify a wave of independent work, then run separate worktrees. Never let concurrent agents own overlapping files unless dependency-ordered and coordination is explicit.
Preserve uncommitted foreign work. Sync integration only after branches are verified and reviewed. FLY-0008 is the existing parallel domain; do not implement a competing scheduler.
