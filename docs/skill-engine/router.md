# FLY-0017 — Context-aware Skill Router

`routeSkills(manifests,input)` is a pure deterministic selector. It evaluates explicit user intent (Thai and English), optional pinned project, known Task state/risk and trusted manifest metadata. It emits <=3 version/hash-pinned Skill IDs and reason codes, without loading specialist bodies or mutating Task state.

Selection precedence: explicit user intent before Task status; status fallback covers Backlog Authoring, To-do/In Progress Implementation and Ready for Review; cold start chooses agent-bootstrap. Parallel board-loop composes implementation; visual QA composes verification when needed.

Builtin instructions are trusted only because packaged by the application, not because YAML claims privilege. Project guidance is excluded unless the caller explicitly allows it with a matching project ID; it always remains advisory. The router does not parse untrusted task descriptions as instructions. Unsupported/ambiguous requests safely route to a minimal router or return NO_MATCH.

Progressive content loading belongs to FLY-0018; the CLI/HTTP adapter belongs to FLY-0021. Agent actions still run through Flowly's existing domain validators.
