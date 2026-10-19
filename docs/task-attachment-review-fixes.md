# FLY-0043 backend review fixes

Verified 2026-10-19 in the isolated `flowly-review-fix-backend` worktree.
Read README, the Engineering Delivery Standard, attachment contract/QA documents,
and the actual HTTP, domain, SQLite, CLI and existing test paths. No live project,
task evidence, review, decision or QA approval was changed. All test evidence and
synthetic approvals below belong to disposable databases.

## Changes and reproductions

| Bug | Fix | Regression evidence |
| --- | --- | --- |
| Done caches approval before a concurrent attachment removal, then writes the stale task back | `Tasks.transition` enters SQLite `transactionImmediate` before reading the task, children, QA or engineering gates. Gate validation, task write and audit commit share the lock. Synchronous nested transactions use SQLite savepoints; no asynchronous work or process wait runs inside the production transaction. | Deterministically commit a real CLI removal immediately before the transition transaction acquires its lock. Done must fail and tests/review must remain invalidated. A separate process also holds an IMMEDIATE removal transaction while the actual CLI tries Done: it waits, reads the committed invalidation and rejects. The opposite ordering retains Done and rejects removal. Restart verifies durability; injected audit failure rolls back the task write. |
| 159 ASCII characters plus an emoji and `.png` splits a UTF-16 surrogate at the filename limit | Sanitize standalone surrogates, validate the original sanitized extension, then trim to 160 Unicode code points. | Real multipart upload returns 201; stored label retains the complete emoji; original and thumbnail both return 200 with decodable image bytes and Content-Disposition. An unpaired input surrogate and unsafe filename character become underscores. |
| Exact child create replay fails once its parent is Done | HTTP and domain still validate project/parent ownership before image ingestion or receipt lookup. The domain checks the project-scoped key and complete request hash before parent mutability; new writes still check mutability before decoding and again through `createTask` inside the IMMEDIATE transaction. | Complete both disposable child and parent, then replay the original domain and HTTP requests. HTTP returns 200 and the original receipt with `replayed: true`, without new tasks or audit. New keys fail `DONE_IS_TERMINAL`, changed payloads fail `IDEMPOTENCY_CONFLICT`, mismatched projects fail before image decoding, and hostile Origin remains forbidden. |
| APNG is accepted when Sharp reports one page | Walk length-bounded PNG chunks and reject any `acTL`, `fcTL` or `fdAT` chunk with `ANIMATED_IMAGE`, message `Animated PNG attachments are not supported`. Chunk contents are not searched for keywords. | Valid-CRC fixtures independently exercise all three chunk types plus a complete two-frame APNG with sequence numbers and compressed frame data. Sharp reports one page for each. Create and add reject them even after a valid first image, leaving no tasks, attachments, audit or replay receipts behind. |

Production changes are limited to `packages/core/src/taskAttachments.ts`,
`packages/core/src/tasks.ts` and `apps/api/src/server.ts`. Local filesystem reads
in `taskAttachmentFiles.ts` required no change. The only additions are
`tests/review-backend-regressions.test.ts` and this document. No UI or skill source
was edited.

The HTTP/domain replay correction does not change the separate CLI create wrapper
in `packages/core/src/app.ts`: that unowned file still makes an early mutable-parent
check and rejects a child-create CLI retry after parent Done. Fixing CLI replay
parity would require expanding the permitted file scope. CLI concurrency behavior
for transition/removal is covered by the fixes and regression tests above.

## Executed verification

Commands run from this worktree in PowerShell:

```powershell
node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/review-backend-regressions.test.ts
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
node node_modules/vite/bin/vite.js build --config apps/web/vite.config.ts --configLoader native
git -c safe.directory=C:/Users/tatar/Projects/flowly-review-fix-backend diff --check
```

- Before production edits, all **5 original regression tests failed**, exposing
  stale Done approval, the real process race, broken Unicode, replay rejection
  and accepted APNG. No existing tests were changed.
- After fixes, the final regression file has **6 passed, 0 failed, 0 skipped**.
  The sixth test additionally verifies commit-first ordering, restart and audit
  rollback; the APNG test also includes the complete two-frame fixture.
- Full `npm.cmd test`: **164 tests, 162 passed, 0 failed, 2 skipped**,
  exit 0, approximately 121 seconds. The two existing opt-in FLY45 UI checks were
  skipped. That run loaded the original five regression cases; the final expanded
  six-case file was separately run successfully.
- Typecheck passed on the final source/tests, including the typecheck phase of
  the final `npm.cmd run build` attempt.
- Default build loader failed because esbuild could not access parent directories
  through the shared node_modules junction (`Cannot read directory "../..":
  Access is denied`). Native config loading completed the production build,
  **1,948 modules transformed**, exit 0. The existing bundle-size advisory remains
  (JavaScript chunk approximately 505 kB). No build configuration was changed.
- `git diff --check`: passed.

These are automated verification results, not a QA verdict or approval. Process
contention, transaction rollback and clean restart were exercised; power-loss or
process-kill durability is not claimed.

## Commit limitation

Attempted to stage only the six permitted paths using a command-scoped
`safe.directory` setting; Git returned:

```text
fatal: Unable to create 'C:/Users/tatar/Projects/flowly/.git/worktrees/flowly-review-fix-backend/index.lock': Permission denied
```

The worktree's Git metadata is outside the sandbox writable root. No global Git
configuration, metadata workaround, commit or push was made. Once that metadata
is writable, the intended commit is
`FLY-0043 Fix attachment transition race, Unicode labels, child replay and APNG validation`.
