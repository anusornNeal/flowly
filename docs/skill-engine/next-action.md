# FLY-0019 — Next Best Action

`getNextAction(app,{projectId?,taskId?,sessionId?})` is **read-only** and deterministic. It queries the real Flowly project, Task, Engineering and persistent Job state. It never invokes transition, review, QA or commit actions.

Priority: exact user-project pinning -> ambiguous project resolution -> explicit card/project Job recovery -> current engineering Decision and Plan gates -> status (Backlog to To-do / To-do to In Progress) -> runnable workstreams -> Bugs/Preview/QA/checklist/subtasks -> tests -> Implementation Report -> explicit Review/Done.

Responses contain operation, reason code, named blockers, required params, prerequisites and an explicit `ownership.status=UNSUPPORTED` marker until FLY-0022 adds durable claims. An interrupted job requires explicit inspection and retry. A suggestion is not an approval, an acquired lock, or an instruction to fabricate evidence.

FLY-0021 integrates this service into shared CLI/API. FLY-0026 measures correct-route, latency and cross-project security E2E.
