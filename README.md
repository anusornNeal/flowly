# Flowly V1

Single-user, localhost-only, agent-first project Task Board and interactive Preview / Visual QA workspace. React/Vite/Tailwind Web UI; Fastify API; SQLite/Drizzle; TypeScript strict. No embedded LLM, Relay, cloud or login required.

## Installation and launch

Run the following in C:\Users\tatar\Projects\flowly:

    npm install
    npm run build
    npm start

Open http://127.0.0.1:3210 on this PC. For development, run npm run dev (API port 3210 and Vite port 5173). Require Node.js 22+ and Chromium (or locally installed Chrome/Edge) for rendered Preview QA and Web Recorder.

## Agent CLI

CLI writes directly through the same domain services, validation, audit and SQLite database as Web UI. Every operation returns machine-readable JSON. Examples:

    node bin/flowly.cjs capabilities
    node bin/flowly.cjs project.create --name="My Project" --platform=web --baseUrl=http://127.0.0.1:4000
    node bin/flowly.cjs task.create --projectId=proj_xxx --title="Implement screen"
    node bin/flowly.cjs task.context --id=tsk_xxx
    node bin/flowly.cjs task.tests --id=tsk_xxx --passed=true --evidence="npm test passed"
    node bin/flowly.cjs task.transition --id=tsk_xxx --to=ready-for-review

Use --input=@my-input.json to send complex command parameters. Recorder Start/Stop/Replay/Capture commands connect to the persistent local Flowly API service, launching it automatically when needed. The Web UI need not be open. Set FLOWLY_DATA_DIR before launching to choose the shared database. task.batch accepts projectId, optional idempotencyKey and a list of Task operations. Batches are atomic and idempotent with conflict detection. Discover available operations using capabilities.

## Engineering reports and Parallel-first delivery

All projects use the [Engineering Delivery Standard](docs/ENGINEERING-STANDARD.md): parallel-first workstream planning, versioned pre-implementation alternatives and decision approval for Large/Critical work, and evidence-backed post-implementation reports before review. The CLI/API and Task Detail share enforced gates and audit history; no passive evidence auto-approves a decision, QA verdict or review.

## Preview / Quality workflow

Attach a Preview to a Task; author interactive HTML/CSS/JS, explicitly define Screen + State + Viewport tuples, save Draft, freeze Revision and explicitly Approve. Approved revisions and their UI-context snapshots are immutable. Approval runs real Chromium rendering checks: critical layout/runtime defects block approval; advisory warnings require explicit acceptance and a reason. QA Cases are created only from explicitly approved tuples.

After implementation and applicable tests are complete, move the Task explicitly to **Ready for review** even if Figma/Visual QA, device testing, human review or QA checklist entries are still pending. These are Done gates, never automatic PASS or approval. Flowly `skills.next` recommends the handoff only and cannot move cards automatically.

Manual Screenshot Upload works for Web/Desktop/Mobile even when external agents are offline. The optional controlled Web Recorder runs against localhost URLs and retains Cookies and Local Storage in a separate profile per Project, including after Flowly restarts. Reset Session affects only that Project. Screenshot comparison uses original evidence and frozen Approved revision, generating diff on demand. No screenshot, capture, replay, or comparison silently decides PASS/FAIL/WAIVED.

Explicit QA PASS/FAIL needs linked original screenshot evidence; WAIVED requires reason. FAIL creates Bug evidence; post-Done defects create a separate linked top-level Bug Task without reopening Done. Tests, mandatory current QA, open bugs, checklists, review and unfinished Subtasks block Done. Explicit Force Done with a nonblank reason only overrides unfinished Subtasks and preserves all child states.

## Optional external screenshot ingress

POST multipart/form-data binary image to http://127.0.0.1:3210/api/screenshots/external with Authorization: Bearer token. Fields: file (PNG/JPEG/WebP), optional sourceId, captureId, projectId, taskId, screenId, stateId, caseId. The token is shown only after explicit Reveal/Copy in Settings and regenerates only after user confirmation. External image size limit is 25 MiB inclusive; token authorization runs before file ingestion.

The sourceId+captureId tuple is durable and idempotent, including after restart and cleanup tombstone. Omit captureId to create a new capture for every authenticated request. Unknown Task/Screen metadata routes evidence into Unassigned Inbox without a QA verdict. Manual UI Upload has no token requirement.

Screenshot originals remain unchanged, with separate thumbnails; Visual Diff is created only on demand. No automatic deletion. User-selected cleanup deletes only evidence never referenced by any historical QA PASS/FAIL or Bug, skipping protected entries; Deleted History retains non-restorable receipt metadata.

## Resumable CLI Jobs and command contracts

The CLI exposes machine-readable operation contracts with `node bin/flowly.cjs describe task.transition` or `node bin/flowly.cjs capabilities`. `--input=-` or `--stdin` reads JSON from standard input; `--input=@file.json` accepts structured input from a file. `--limit=N --offset=N` pages list output with `items`, `total`, `hasMore`, and `schemaVersion:1`. A named validation or workflow failure emits stable `code` and exits non-zero.

For DB-only commands, `--dry-run` executes the SAME domain validators inside a rollback-only SQLite transaction, returning `simulation:true` and `committed:false` without persisting records or audit. File/Browser/network/token operations reject dry-run.

Long-running approved operations `recorder.replay`, `recorder.capture`, `preview.quality`, and `screenshot.compare` support `--async --projectId=... --jobKey=unique-key`. This submits a persistent local Job, returning a stable Job ID without requiring a Web UI session. Query with `flowly job.status --id=job_xxx`, retry explicitly with `flowly job.retry --id=job_xxx`. Jobs are serialized per project; job ID, actor, state, attempts, progress, errors, and result persist in SQLite and appear in the monitoring UI. A previously in-flight job is marked `interrupted` when the service restarts; it is NOT silently replayed. Explicit retry uses its original ID. Only queued jobs are cancellable. `flowly job.list --projectId=...` returns a paginated Job list.

## Verification

    npm run typecheck
    npm test
    npm run build
    npm run smoke

The Browser smoke test runs on Desktop and Mobile viewports and writes ignored visual QA artifacts under data/qa. SQLite data, originals, thumbnails and project browser profiles live in %USERPROFILE%\.flowly on Windows or ~/.flowly on macOS/Linux (or FLOWLY_DATA_DIR). These are local and must not be committed or published.

Original Devflow UI concept assets are preserved in design-preview/v1. User-approved Devflow FWL-0001..FWL-0024 specification snapshot is in docs/devflow-v1-spec.json.

Flowly API is loopback-only. Do not expose it through a tunnel or reverse proxy without additional protection.