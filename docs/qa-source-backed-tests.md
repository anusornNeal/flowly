# Source-backed browser tests (FLY-0045)

`npm test` runs `tests/task-attachments-ui.test.ts` and
`tests/taskInspectorUx.test.ts` against a fresh isolated Vite build of
`apps/web` source. No separate `npm run build` is required.

Both suites use `startSourceWeb` from `tests/qa-source-build.test.ts`. It uses
the application's Vite configuration and plugins, builds into a new OS temporary
directory, and starts a loopback Vite preview server on an ephemeral port. Its
cache and output are disposable. The returned browser URL serves that exact
build; only `/api` requests proxy to the test's separate Fastify server and
disposable SQLite database. Neither browser entry points nor assets use the API
server's `apps/web/dist` fallback. Existing dist is never read, deleted, or rebuilt.
Build errors propagate as test failures. Cleanup closes servers and removes
temporary resources, including when browser startup or assertions fail.

The attachment workflow retains both 1440×900 and 390×844 runs; the inspector
workflow retains its desktop/mobile checks. Existing behavioral assertions and
explicit fixture review operations remain; running browser tests does not
automatically grant task PASS or review approval.

The normal test glob also runs the FLY-0045 regression directly. Its isolated
web fixture contains deliberately stale `dist/index.html`. It builds and renders
two successive TypeScript source versions in Chromium while asserting that stale
dist stays untouched and absent from the rendered page. It then introduces a
source syntax error and requires the fresh build to fail, preventing fallback to
the old passing output. Importing its helper does not register duplicate tests.

Focused verification:

```sh
node --import tsx --test --test-concurrency=1 tests/qa-source-build.test.ts tests/task-attachments-ui.test.ts tests/taskInspectorUx.test.ts
npm run typecheck
```

Run `npm test` for the standard suite, including source-edit regression coverage.
On Windows with PowerShell script execution disabled, use `npm.cmd`.
Chromium (or the Chrome/Edge executable supported by `openChromium`) is required;
missing browsers and build failures fail the tests rather than skipping them.
