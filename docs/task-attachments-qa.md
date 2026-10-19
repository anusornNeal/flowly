# FLY-0045 independent attachment QA

Status: **QA NOT PASSED**. Automated regression found; integrated desktop/mobile
flows pending App wiring. No task, decision, engineering, code-review or Visual
QA gate was approved in the real workspace. No push or production code changes.

## Scope and inputs

Execution: 2026-10-19, Windows PowerShell, Node v24.16.0, isolated worktree
`C:\Users\tatar\Projects\flowly-work-FLY-0045`, inspected HEAD `69377c3`.
Read README, ENGINEERING-STANDARD, task-attachments contract, existing domain/API/
CLI/component attachment tests, TaskComposer, TaskAttachmentGallery, App, API
multipart/file routes, image ingress and attachment services. Existing tests are
retained unchanged. Changes belong only to:

- `tests/task-attachments-e2e.test.ts`
- `tests/task-attachments-security.test.ts`
- `tests/fly45-qa-fixture.ts` (uniquely named shared test support)
- `docs/task-attachments-qa.md`

Authoritative live task context could not be obtained: read-only CLI invocation
`node bin/flowly.cjs project.list` returned exit 1, JSON
`{"schemaVersion":1,"ok":false,"code":"INTERNAL_ERROR","message":"Unexpected Flowly CLI error"}`.
`task.list --limit=100` correctly requires projectId; no project ID was invented.
The task description supplied for this workstream and checked-in attachment
contract define the QA scope. No real project/card/status/evidence was modified.
Relay should reconcile the live FLY-0045 context before integration sign-off.

## Independent regression matrix

| Area | Executed assertions | Actual outcome |
| --- | --- | --- |
| Real HTTP lifecycle | Bind fresh API to ephemeral loopback port; multipart-create Task, Subtask, Bug with PNG/JPEG/WebP, order/alt text/ownership; close/reopen database; context parity and binary SHA-256; delete only child's image | Passed |
| HTTP/CLI retry parity | Concurrent duplicate HTTP create; real spawned CLI exact replay after restart; changed title/alt text conflict through both transports; deleted receipt never resurrects BLOB; project-scoped keys; no duplicate audit/local path leak | Passed |
| External screenshot isolation | Token rejected before malformed multipart ingestion; authenticated unknown metadata enters inbox; same bytes and key for attachment stay separate; screenshot cleanup/restart retains capture receipt and leaves attachment readable | Passed |
| Actual pending QA case | Create/freeze/approve synthetic Preview through normal real Chromium quality gate; link external screenshot; comparison awaits verdict; add/remove requirement image; close/reopen; exact QA record unchanged, original screenshot active, required-QA blocker retained, no qa.verdict audit | Passed |
| Invalid binary create AND add | HTML/SVG, false MIME, executable extension, fake PNG header+IEND, truncation, appended script, zero bytes, 25 MiB+1, 16,385 width/height, actual 40,002,666 decoded pixels; valid first image plus invalid second image | Passed; records/BLOBs/audit/replays/capture keys unchanged |
| Limits and corrected retries | Failed create/add keys reusable after correction; 16,384 inclusive axis accepted; 11 files rejected | Passed |
| Manifest | Malformed JSON; unknown path/status/risk fields; blank/long key; alt count/type/length; wrong file field; 128 KiB overflow | Passed |
| Extra text field | Canonical input, then extra text field, then valid image must give 400 INVALID_ATTACHMENT_INPUT and persist nothing | **Failed: 500 INTERNAL_ERROR; persistence counts unchanged** |
| Ownership and Done | Wrong/missing/malformed project on list/file/thumbnail/delete; ownership before decode; real terminal transition in disposable fixture; reject old add retry/new add/delete/new child; reads remain allowed | Passed |
| File serving | Decode/re-encode JPEG orientation; strip EXIF/ICC/XMP; bounded WebP thumbnail; actual MIME/hash; inline encoded display label; nosniff/no-store/sandbox/same-origin; no paths/bytes/screenshot IDs in DTO | Passed |
| Local trust boundary | Host/Origin rejection on both file variants; traversal/malformed/missing IDs; generic HTTP operations cannot read CLI paths | Passed |
| Existing focused suites | Atomic rollback/storage/audit failures, quota races, metadata/size boundary, CLI commands and component browser harness | Passed |
| Integrated App 1440x900 and 390x844 | Real source App via Vite, fresh API/DB, picker/create/gallery/lightbox/zoom/Escape/reload/overflow/runtime checks | **Pending** by default; explicit run fails missing TaskComposer wiring |

The original API boundary test supplies a real valid JPEG of exactly 26,214,400
bytes; the new matrix exercises one byte over on create and add. Existing domain
tests retain concurrency/quota/storage-failure coverage. No assertion was weakened
to accept an observed production failure. Node counts the failing nested test
and its parent separately: two reported failures represent one regression.

## Reproduction and evidence

From this worktree, run in PowerShell:

```powershell
New-Item -ItemType Directory -Force data/qa/fly45 | Out-Null
node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/task-attachments.test.ts tests/task-attachments-api.test.ts tests/task-attachments-cli.test.ts tests/task-attachment-ui.test.ts tests/task-attachments-e2e.test.ts tests/task-attachments-security.test.ts 2>&1 | Tee-Object -FilePath data/qa/fly45/focused-tests.txt
$LASTEXITCODE
npm.cmd run typecheck 2>&1 | Tee-Object -FilePath data/qa/fly45/typecheck.txt
$LASTEXITCODE
```

Expected: all non-optional attachment regressions pass, UI tests explicitly
pending until opted in, typecheck exits 0. Actual focused run: exit 1,
58 tests, 54 pass, 2 fail (one failing leaf plus parent), 2 skipped, 0 cancelled;
23.5 seconds. Typecheck exited 0. Bare `npm run typecheck` was initially blocked
by PowerShell's npm.ps1 execution policy; `npm.cmd` completed without policy changes.

Minimal failing case is named
`extra multipart text field (contract regression)` in the security suite:
send `input` first, an additional `extra=unexpected` text part, then a valid
`files` PNG. Expected 400 / INVALID_ATTACHMENT_INPUT. Actual response:

```json
{"ok":false,"code":"INTERNAL_ERROR","message":"Flowly could not process the request"}
```

The suite asserts database counts unchanged before checking the failing status.
Fix belongs to the backend owner; this QA workstream leaves the test red.

Opt-in real UI verification (fresh local server only; no production URL option):

```powershell
$env:FLOWLY_FLY45_UI='1'
try {
  node node_modules/tsx/dist/cli.mjs --test --test-name-pattern='FLY45 real App' tests/task-attachments-e2e.test.ts 2>&1 | Tee-Object -FilePath data/qa/fly45/ui-prerequisites.txt
  $LASTEXITCODE
} finally {
  Remove-Item Env:FLOWLY_FLY45_UI
}
```

Actual: exit 1, both viewports fail
`Prerequisite missing: App.tsx does not render TaskComposer`.
No screenshot of integrated attachment UI was captured or claimed. Failure
receipts are under `data/qa/fly45/1792371915674-1440/failure.txt` and
`data/qa/fly45/1792371915802-390/failure.txt`. The opt-in test checks both Composer
and Gallery rendering before starting Vite. On a completed UI flow it writes
composer/gallery PNGs and assertion metadata with `visualQaVerdict: PENDING`.
Screenshot files and test runner output are ignored local evidence, not committed
QA verdicts. Existing isolated component harness passed with a real browser;
that does not establish App integration readiness.

## Isolation, cleanup and integration handoff

Every fixture creates a unique `flowly-fly45-qa-*` temporary root. CLI children
receive explicit FLOWLY_DATA_DIR, have a deadline, and never use production DB.
APIs close before reopen; all finalizers close handles and remove their own exact
temporary directory. Optional UI uses an ephemeral API port, Vite with an isolated
temporary cache, and a fresh browser context. Browser/Vite/API cleanup runs even
on failure; only ignored evidence remains. No screenshots or live token values
are logged, no SourceId/CaptureId is reused against real data, and no test invokes
qa.verdict or mutates the actual FLY-0045 card. Synthetic task.tests and terminal
transitions exist solely to arrange Done guards in the disposable test database.

After cherry-picking with the integration worktree, rerun focused tests,
typecheck, and opt-in UI against the actual combined source. Resolve the backend
manifest failure first. UI selectors follow the current shared components and
may need test-only adjustment to approved shell wiring. These flows have not
been exercised beyond their prerequisite in this worktree. Browser failure,
missing wiring or request errors remain failures when opted in, never silent
skips. Keyboard/mobile component coverage is automated; final integrated
Subtask/Bug composer navigation, Markdown malicious/deleted-reference behavior,
paste/drop/reorder, full keyboard/focus behavior and human visual review remain
integration verification obligations. Process-kill/power-loss durability is not
claimed: this suite tests clean close/reopen and the existing fault-injection
rollback tests. No repository-wide build/smoke or full npm test run was performed.

Final review, decision resolution, QA verdicts and all Done gates remain explicit
actions for the owning workflow. This document is evidence, never QA PASS.

Git metadata can be read with a command-scoped safe.directory setting. Staging
the four owned files was attempted and failed:
`fatal: Unable to create 'C:/Users/tatar/Projects/flowly/.git/worktrees/flowly-work-FLY-0045/index.lock': Permission denied`.
No global Git configuration was changed. No commit or push was made. Relay must
stage these four files and commit, for example
`FLY-0045 Add independent task attachment regression matrix`, retaining the red
regression and pending integration evidence. The shared Git metadata lies outside
this sandbox's writable root; no approval escalation or workaround was attempted.
