# Task attachment backend contract (FLY-0043)

Task attachments are requirement/reference images. They never create Screenshot,
QA Case, comparison, inbox items, or verdicts. This contract is independent of QA
screenshot ingestion and cleanup. The backend is implemented; frontend composer,
gallery, lightbox, Markdown rendering, accessibility and device checks remain
FLY-0044/FLY-0045 integration work. No decision, review or QA gate is approved by
this implementation or by attachment presence.

## Canonical creation protocol

Use **atomic multipart create-with-images**, not upload drafts. Preview selected
files in browser memory before submission. There are no persistent draft tokens,
staging endpoints, draft expiry jobs, or temporary files to recover.

`POST /api/tasks/with-attachments`, Content-Type `multipart/form-data`:

1. Send exactly one text field **input** first, containing JSON:
   `{"task":{"projectId":"proj_UUID","title":"Requirements","description":"Markdown"},"idempotencyKey":"client-generated-unique-key","altTexts":["Reference design"]}`.
2. Send 1–10 binary fields, each named **files**, in gallery order. Each part must
   declare the actual image MIME and a matching filename extension (or no extension).
3. `altTexts` is optional; when supplied it must contain one string per file in
   the same order, at most 2000 characters each. This metadata is returned as text;
   consumers must render it as text, never HTML.

`task` accepts the existing domain create fields: projectId, title, description,
parentId, originTaskId, type (`task` or `bug`), priority (`low`, `medium`, `high`),
reviewMode, risk, acceptanceCriteria and verificationStep. The existing parent,
project, child depth, post-Done Bug and lifecycle rules apply. Use parentId for
Subtasks. Each child owns independent attachments. Unknown manifest/task fields,
missing keys, invalid IDs, malformed JSON, extra fields and files-before-input fail
without creating a task. The JSON field limit is 128 KiB.

Success: HTTP **201**, `{ok:true,result:{task,attachments,replayed:false}}`.
An identical retry returns **200**, with the same IDs and `replayed:true`.
`task` is the existing TaskRecord, without image bytes or embedded gallery data.

```ts
import type {
  TaskAttachmentRoutes, AttachmentCreateRequest, AttachmentAddRequest,
  AttachmentCreateResult, AttachmentAddResult, AttachmentRemoveResult,
  AttachmentEnvelope
} from '../packages/core/src/taskAttachments';
import type { TaskAttachmentDto } from '../packages/core/src/models';
```

These exported types and typed Fastify routes are the canonical DTO contracts.
Example browser submission:

```ts
const form = new FormData();
form.append('input', JSON.stringify({
  task: { projectId, title, description, parentId },
  idempotencyKey: crypto.randomUUID(),
  altTexts: files.map(file => file.name)
}));
files.forEach(file => form.append('files', file, file.name));
const response = await fetch('/api/tasks/with-attachments', {
  method: 'POST', body: form
}); // Let the browser supply the multipart Content-Type/boundary.
```

Retain the key and exact files/input on an interrupted request and retry the whole
request. Use a new key after editing the payload. Validation failures persist no
retry receipt, so a corrected request can reuse its failed key. Successful receipts
persist across restarts. Keys are project-scoped across attachment create/add
operations, with an internal namespace separate from task.batch; 1–180 trimmed
characters. Payload identity includes operation, task data/ID, ordered filenames,
declared MIME, alt text and SHA-256 of uploaded bytes. Object property order does
not matter. CLI callers that want to retry a browser request must supply identical
MIME/name/altText metadata as well as identical bytes.

An identical retry returns the original response snapshot, even if an attachment
was subsequently removed; it never resurrects images. Refresh the list/detail to
obtain current live state. A retry of add against a now-Done task is rejected.

## Routes and DTOs

All JSON success responses use `{ok:true,result:...}`. Errors use
`{ok:false,code,message,details?}`. Existing loopback Host/Origin checks apply.
Mutations accept optional `X-Flowly-Actor`; `X-Flowly-Channel: cli` selects CLI
audit channel, otherwise `web`. This is the existing single-user localhost trust
model, not a multi-user authorization API.

| Method / route | Request | result / response |
| --- | --- | --- |
| POST /api/tasks/with-attachments | Multipart above | 201 create result; 200 replay |
| POST /api/tasks/:id/attachments | Multipart `input` first: `{projectId,idempotencyKey,altTexts?}`, then `files` | 201 `{attachments:TaskAttachmentDto[],replayed:false}`; 200 replay; returns newly added items |
| GET /api/tasks/:id/attachments?projectId=... | Task ID, required project query | 200 ordered `TaskAttachmentDto[]` of active items |
| GET /api/task-attachments/:id/file?projectId=... | Attachment ID, required project query | 200 sanitized binary PNG/JPEG/WebP |
| GET /api/task-attachments/:id/thumbnail?projectId=... | Attachment ID, required project query | 200 binary WebP, fits 320×320 without enlargement |
| DELETE /api/task-attachments/:id?projectId=... | Attachment ID, required project query | 200 `{attachment:TaskAttachment,removed:boolean}`; tombstone includes deletedAt; repeat is removed:false |

An attachment DTO has:

```ts
type TaskAttachmentDto = {
  id: string; projectId: string; taskId: string;
  name: string; mime: 'image/png' | 'image/jpeg' | 'image/webp';
  sizeBytes: number; width: number; height: number; sha256: string;
  sortOrder: number; altText?: string; createdAt: string; createdBy: string;
  deletedAt?: string; fileUrl: string; thumbnailUrl: string;
};
```

`sizeBytes`, dimensions and sha256 describe the **sanitized display image**, not
the input. File URLs are relative same-origin API URLs including projectId. No
disk paths, BLOBs, base64 or screenshot IDs are exposed. `task.detail`,
`task.context`, and GET /api/tasks/:id include a top-level `attachments` array.
Snapshot/task.list retain their existing metadata-only contract.

Initial order follows multipart/CLI file order, and adds append. Deletion can leave
gaps in sortOrder. V1 provides no reorder/rename/alt-text update operation: reorder
before initial submission, or remove and re-add later using a new key. Mutating
attachments clears previous task tests/review/current decision approval, as a
substantive requirements edit does; it does not change QA verdicts or task lane.

## Security, storage and limits

- PNG, JPEG and WebP only. Magic header, declared MIME (when supplied to the
  domain/CLI), filename extension and decoded format must agree. Reject SVG,
  HTML, unknown formats, corrupt/truncated images, appended payloads, animated
  images, and unsupported dimensions. Never fetch remote URLs.
- Maximum **26,214,400 bytes (25 MiB), inclusive**, per input and sanitized image;
  maximum **10 active attachments per task**, independent of screenshot quotas.
  Maximum 40,000,000 decoded pixels and 16,384 pixels on either axis. Sharp fully
  decodes/re-encodes under strict warning handling, strips EXIF/ICC/XMP metadata,
  applies orientation and derives a separate WebP thumbnail. Originals here mean
  full-size sanitized images; raw uploads are deliberately not retained.
- A request buffers at most ten bounded images, decoding them sequentially.
  Admission/ownership checks happen before binary buffering; quota and Done state
  are checked again under SQLite's write lock after asynchronous decoding.
- Project existence, exact Task/Attachment ownership and ID shape are validated
  before attachment reads/writes/deletes. Task Done blocks add/remove; reading
  Done evidence remains supported. Missing/deleted items never resolve to another
  file. Filenames are normalized, reduced to the basename, stripped of dangerous
  control/path/header characters and bounded to 160 characters. Names are labels,
  never storage paths. Local paths are accepted only by the trusted CLI.
- File responses set actual image MIME, Content-Disposition inline with an encoded
  display name, Cache-Control no-store, X-Content-Type-Options nosniff,
  Content-Security-Policy `default-src 'none'; sandbox` and
  Cross-Origin-Resource-Policy same-origin.
- Additive migration: metadata is the new `taskAttachment` records kind;
  `task_attachment_files` stores image/thumbnail BLOBs with a foreign key to
  metadata. Existing databases migrate on open without changing screenshot data.
  New task, parent child IDs, sequence, metadata, BLOBs, audit and retry receipt
  commit together in one SQLite IMMEDIATE transaction. Process interruption rolls
  back through SQLite/WAL. There is no second filesystem commit and no orphan
  cleanup window. Removal deletes BLOBs transactionally and retains only metadata
  tombstone and audit. SQLite may retain freed pages/WAL until checkpoint/reuse;
  logical deletion is not a secure disk erasure claim.
- Concurrent requests serialize at commit. Successful retry creates no extra
  audit/images; conflicting keys fail. Per-task quotas and Done status cannot be
  bypassed by concurrent decode. Audit records attach/remove IDs/hash/size plus
  actor/channel, never image bytes or local input paths.

| Status | Stable code | Meaning |
| --- | --- | --- |
| 400 | INVALID_ATTACHMENT_INPUT | Invalid multipart manifest/task schema/field ordering/count/altTexts |
| 400 | INVALID_ID | Missing/malformed project, task or attachment UUID ID |
| 400 | IMAGE_REQUIRED | No image bytes/files |
| 400 | UNSUPPORTED_IMAGE | Unsupported magic/type (including SVG/HTML) |
| 400 | IMAGE_MIME_MISMATCH | Declared MIME or extension differs from decoded type |
| 400 | INVALID_IMAGE | Corruption/truncation, appended payload or decoder/pixel rejection |
| 400 | IMAGE_DIMENSIONS | Dimension limit exceeded or animated image |
| 400 | INVALID_ALT_TEXT | Domain alt text is not a string or exceeds 2000 chars |
| 400 | INVALID_IDEMPOTENCY_KEY | Missing/blank/too-long key in direct domain/CLI; HTTP uses INVALID_ATTACHMENT_INPUT |
| 400 | ATTACHMENT_FILE_UNREADABLE | CLI local path missing, unreadable or not a regular file |
| 400 | MULTIPART_REQUIRED | HTTP generic operation tried file-based create/add; use canonical multipart routes |
| 403 | LOCAL_ONLY / ORIGIN_FORBIDDEN | Existing loopback protections |
| 404 | NOT_FOUND | Project/task/attachment does not exist |
| 404 | ATTACHMENT_FILE_MISSING | Metadata exists but stored bytes are missing; show placeholder |
| 409 | PROJECT_MISMATCH | Task/attachment belongs to another project |
| 409 | DONE_IS_TERMINAL | Attachment mutation of a Done task |
| 409 | ATTACHMENT_LIMIT | More than ten active images or more than ten upload files |
| 409 | IDEMPOTENCY_CONFLICT | Successful key reused for different content/operation/target |
| 409 | ATTACHMENT_FILE_CHANGED | Local CLI file grew during bounded read; retry |
| 410 | ATTACHMENT_DELETED | Attachment was removed; show placeholder |
| 413 | IMAGE_TOO_LARGE | Input or sanitized image exceeds 25 MiB |
| 500 | INTERNAL_ERROR | Unexpected infrastructure failure; no partial transaction committed |

Task creation also retains existing domain validation codes (title, priority,
review mode, parent depth/Done, origin validation). Malformed HTTP multipart uses
the existing INVALID_REQUEST envelope when rejected by Fastify before the handler.

## Agent CLI parity

All commands use the same TaskAttachments service, SQLite transaction, decoded
image validation and audit as HTTP. Discover them using `capabilities` and
`describe task.create-with-attachments`. CLI output retains schemaVersion:1.

```powershell
node bin/flowly.cjs task.create-with-attachments --input=@create.json --actor=my-agent
node bin/flowly.cjs task.attachment.add --input=@add.json --actor=my-agent
node bin/flowly.cjs task.attachment.list --id=tsk_UUID --projectId=proj_UUID
node bin/flowly.cjs task.attachment.remove --id=att_UUID --projectId=proj_UUID
```

`create.json`:

```json
{
  "task": {"projectId":"proj_UUID","title":"Screen requirements","parentId":"tsk_UUID"},
  "idempotencyKey":"my-create-001",
  "files":[{"path":"C:/references/design.png","mime":"image/png","altText":"Design reference"}]
}
```

Omit parentId for a top-level Task/Bug; set type:bug to create a Bug Task.
`add.json`: `{"id":"tsk_UUID","projectId":"proj_UUID","idempotencyKey":"my-add-001","files":["C:/references/design.png"]}`.
Files may be local path strings or `{path,name?,mime?,altText?}` objects. Paths can
be absolute or relative to the CLI working directory. When omitted, name defaults
to the basename and MIME is inferred through magic/decoder validation. Size is
checked before bounded local reads. Generic HTTP operations explicitly reject
local file-based create/add to prevent arbitrary local file reads.

List supports the existing `--limit`/`--offset` pagination. All attachment operations
reject `--dry-run` under the existing CLI simulation allowlist; no false simulated
image success is advertised. Use FLOWLY_DATA_DIR or --dataDir for an isolated DB.

## Markdown integration boundary

Persist links using `![descriptive alt text](<fileUrl>)`, with the exact DTO fileUrl.
Frontend must parse URLs and allow only same-origin
`/api/task-attachments/att_UUID/file?projectId=proj_UUID` (and thumbnail equivalents),
verify the referenced item belongs to the current task's returned attachment list,
disable raw HTML, and render 404/410 images as a safe accessible placeholder.
No arbitrary local file path, data URL, SVG, remote fetch or raw HTML should be
enabled by this feature. The API implements safe image serving; implementing the
Markdown allowlist/rendering and testing keyboard/mobile/a11y remain frontend work.

## Verification and handoff

Focused tests are `tests/task-attachments.test.ts`, `tests/task-attachments-api.test.ts`
and `tests/task-attachments-cli.test.ts`. They exercise actual Sharp decoding,
SQLite rollback/restart, canonical Fastify multipart responses and spawned CLI
processes; no mock attachment service. Fault injection verifies storage/audit
failure rollback. Tests cover MIME/header/extension/corrupt/pixel/size/count checks,
the exact inclusive 25 MiB JPEG upload, ownership/Done, duplicate concurrent
requests/quota races, deletion tombstones, sanitized thumbnails/EXIF, audit,
task-detail parity and absence of QA evidence side effects.

Atomic multipart was selected per the implementation request. SQLite BLOBs trade
larger DB backups and bounded request memory for eliminating filesystem orphan
recovery and staging-token lifecycle complexity. Staged uploads would improve
per-image progress/retry but require durable expiry and cleanup; screenshot reuse
would violate domain ownership. Remaining integration gates are FLY-0044 UI,
FLY-0045 full desktop/mobile/a11y/E2E and independent decision/review/QA approval.
