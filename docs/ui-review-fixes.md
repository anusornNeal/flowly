# Frontend independent review fixes

Worktree: `flowly-review-fix-ui`, based on `7cd0e5f`. Only the assigned UI files,
this document, and `tests/review-ui-regressions.test.ts` are owned here.

## FLY-0044 — retry identity

- Rejected/empty file selections show validation without changing the draft.
- Retry keys rotate only when accepted request fields, ordered files, or alt text
  change. Trimming the title does not change the submitted payload.
- Image create/add retain their canonical multipart contract. Text-only composer
  and Board quick-create use one `task.create` operation inside the existing idempotent `task.batch`
  transaction: this base rejects zero-image multipart creation with `IMAGE_REQUIRED`.
- Browser regressions drop successful server responses, reject a subsequent file,
  retry, and assert one persisted task/image and the same key. An accepted alt-text
  change after a request that never reached the server must rotate the key.

## FLY-0027 — exact-task editing

Edit remains disabled until detail belongs to the selected task. Entering Edit
copies all four fields from that exact detail; Save also checks task identity.
The delayed-response regression loads A, navigates to B while B's GET is held,
verifies editing is blocked, then saves B and verifies A and B's other fields.

## FLY-0039 — focus after confirmed navigation

Body scroll locking still follows modal visibility. Focus follows selected task
identity in a layout effect after the DOM commit, targeting the visible tabpanel
or loading shell. A second layout effect handles detail arrival for a task absent
from the snapshot without stealing focus from controls already inside the modal.
There are no timeout guesses. Both child and linked Bug regressions dismiss and
accept native discard confirmation, hold the target GET, and assert Overview
focus before and after loading plus keyboard containment and the themed select.
The modal retains all four tabs. Completed-parent test setup uses normal workflow
operations on temporary fixtures, never forced completion or QA waivers.

The regression file rebuilds the current checkout with Vite before serving it;
it cannot silently exercise an old dist bundle. It uses native config loading
because esbuild config bundling cannot enumerate parent directories in the
restricted Windows workspace. No QA approval or workflow gates are bypassed.

## Verification

- `npm.cmd test`: 166 tests, 164 passed, 2 skipped, 0 failed. All seven new
  source-backed browser regressions passed, as did the existing desktop/mobile
  image workflows and modal/hierarchy/themed-select regression.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run build -- --configLoader native`: passed (includes typecheck).
  Vite reports the existing bundle-size warning; generated JS is about 506 kB.
- `git diff --check`: passed. Protected QA tests, backend, and skills have no edits.
- This verifies the isolated checkout. It is not independent reviewer approval
  or a claim that the changes have been integrated into main.

## Commit limitation

The requested card commits were attempted, but this sandbox cannot create
`C:/Users/tatar/Projects/flowly/.git/worktrees/flowly-review-fix-ui/index.lock`.
The worktree's Git metadata is outside its writable root. Changes remain local
and uncommitted; nothing has been pushed. Intended commit subjects:

- `FLY-0044 Preserve idempotent create and image retries`
- `FLY-0027 Initialize edits only from the selected task detail`
- `FLY-0039 Restore tabpanel focus on confirmed task navigation`
