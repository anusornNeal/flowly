import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { fixture, headers, image, multipart, type ImagePart } from './fly45-qa-fixture.js';

// Read-only database evidence detects partial commits, including receipts/audit
// that would be invisible in a gallery-only assertion. Always a disposable DB.
function counts(root: string) {
  const db = new Database(path.join(root, 'flowly.db'), { readonly: true });
  try {
    return Object.fromEntries(['records', 'task_attachment_files', 'operation_replays', 'audit_log', 'capture_keys'].map(table =>
      [table, (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n]));
  } finally { db.close(); }
}

test('FLY45 hostile decoded images fail atomically on both create and add; corrected retry key is reusable', { timeout: 60_000 }, async t => {
  const f = await fixture();
  try {
    const projectId = (await f.op('project.create', { name: 'Binary validation' })).id;
    const task = await f.op('task.create', { projectId, title: 'Existing attachment target' });
    const png = await image();
    const wide = await image('png', 16_385, 1);
    const tall = await image('png', 1, 16_385);
    const pixels = await image('png', 6_001, 6_666); // 40,002,666 pixels; both axes legal.
    const cases: Array<{ name: string; file: ImagePart; code: string; status?: number }> = [
      { name: 'HTML declared PNG', file: { ...png, bytes: Buffer.from('<html><script>alert(1)</script></html>') }, code: 'UNSUPPORTED_IMAGE' },
      { name: 'SVG declared PNG', file: { ...png, bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>') }, code: 'UNSUPPORTED_IMAGE' },
      { name: 'SVG MIME', file: { ...png, name: 'reference.svg', mime: 'image/svg+xml' }, code: 'IMAGE_MIME_MISMATCH' },
      { name: 'valid PNG with JPEG MIME', file: { ...png, mime: 'image/jpeg' }, code: 'IMAGE_MIME_MISMATCH' },
      { name: 'double executable extension', file: { ...png, name: 'reference.png.html' }, code: 'IMAGE_MIME_MISMATCH' },
      { name: 'header-only fake PNG with IEND', file: { ...png, bytes: Buffer.concat([png.bytes.subarray(0, 33), png.bytes.subarray(-12)]) }, code: 'INVALID_IMAGE' },
      { name: 'truncated PNG', file: { ...png, bytes: png.bytes.subarray(0, 40) }, code: 'INVALID_IMAGE' },
      { name: 'appended HTML', file: { ...png, bytes: Buffer.concat([png.bytes, Buffer.from('<script>evil()</script>')]) }, code: 'INVALID_IMAGE' },
      { name: 'zero bytes', file: { ...png, bytes: Buffer.alloc(0) }, code: 'IMAGE_REQUIRED' },
      { name: '25 MiB plus one', file: { ...png, bytes: Buffer.alloc(26_214_401) }, code: 'IMAGE_TOO_LARGE', status: 413 },
      { name: 'width above 16384', file: wide, code: 'IMAGE_DIMENSIONS' },
      { name: 'height above 16384', file: tall, code: 'IMAGE_DIMENSIONS' },
      { name: 'above 40 million actual pixels', file: pixels, code: 'INVALID_IMAGE' },
    ];
    for (const mode of ['create', 'add']) {
      const input = mode === 'create' ? { task: { projectId, title: 'Must roll back' }, idempotencyKey: 'failed-create' }
        : { projectId, idempotencyKey: 'failed-add' };
      const url = mode === 'create' ? '/api/tasks/with-attachments' : `/api/tasks/${task.id}/attachments`;
      for (const entry of cases) await t.test(`${mode}: ${entry.name}`, async () => {
        const before = counts(f.root);
        // A valid first file makes partial-commit bugs observable.
        const response = await f.api.inject({ method: 'POST', url, ...multipart({ input }, [png, entry.file]) });
        assert.equal(response.statusCode, entry.status ?? 400, response.body);
        assert.equal(response.json().code, entry.code, response.body);
        assert.deepEqual(counts(f.root), before, 'No task, BLOB, audit, sequence record or retry receipt may leak');
      });
      const corrected = await f.api.inject({ method: 'POST', url, ...multipart({ input }, [png]) });
      assert.equal(corrected.statusCode, 201, corrected.body);
    }
    const edge = await f.api.inject({ method: 'POST', url: '/api/tasks/with-attachments', ...multipart({ input: {
      task: { projectId, title: 'Inclusive axis boundary' }, idempotencyKey: 'axis-boundary',
    } }, [await image('png', 16_384, 1)]) });
    assert.equal(edge.statusCode, 201, edge.body);
    assert.equal(edge.json().result.attachments[0].width, 16_384);
  } finally { await f.close(); }
});

test('FLY45 manifest injection, field confusion and quota failures leave no receipt or task', async t => {
  const f = await fixture();
  try {
    const projectId = (await f.op('project.create', { name: 'Manifest validation' })).id;
    const file = await image();
    const input = { task: { projectId, title: 'Invalid manifest' }, idempotencyKey: 'manifest' };
    const cases = [
      multipart({ input: '{malformed' }, [file]),
      multipart({ input: { ...input, path: 'C:/Windows/win.ini' } }, [file]),
      multipart({ input: { ...input, task: { ...input.task, status: 'done' } } }, [file]),
      multipart({ input: { ...input, task: { ...input.task, risk: { bypass: true } } } }, [file]),
      multipart({ input: { ...input, idempotencyKey: ' ' } }, [file]),
      multipart({ input: { ...input, idempotencyKey: 'x'.repeat(181) } }, [file]),
      multipart({ input: { ...input, altTexts: [] } }, [file]),
      multipart({ input: { ...input, altTexts: ['x'.repeat(2001)] } }, [file]),
      multipart({ input: { ...input, altTexts: [123] } }, [file]),
      multipart({ input, extra: 'unexpected' }, [file]),
      multipart({ input }, [file], 'file'),
      multipart({ input: { ...input, task: { ...input.task, description: 'x'.repeat(128 * 1024) } } }, [file]),
    ];
    const names = ['malformed JSON', 'unknown manifest path', 'injected task status', 'unknown risk flag',
      'blank key', 'long key', 'alt text count', 'long alt text', 'non-string alt text',
      'extra multipart text field (contract regression)', 'wrong file field', '128 KiB manifest overflow'];
    for (const [index, body] of cases.entries()) await t.test(names[index]!, async () => {
      const before = counts(f.root);
      const response = await f.api.inject({ method: 'POST', url: '/api/tasks/with-attachments', ...body });
      assert.deepEqual(counts(f.root), before);
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.json().code, 'INVALID_ATTACHMENT_INPUT', response.body);
    });
    const before = counts(f.root);
    const quota = await f.api.inject({ method: 'POST', url: '/api/tasks/with-attachments', ...multipart({ input }, Array(11).fill(file)) });
    assert.equal(quota.statusCode, 409, quota.body); assert.equal(quota.json().code, 'ATTACHMENT_LIMIT');
    assert.deepEqual(counts(f.root), before);
  } finally { await f.close(); }
});

test('FLY45 project ownership on every route; Done rejects successful add replay and new writes but permits reads', async () => {
  const f = await fixture();
  try {
    const projectId = (await f.op('project.create', { name: 'Owner' })).id;
    const other = (await f.op('project.create', { name: 'Intruder project' })).id;
    const file = await image();
    const response = await f.api.inject({ method: 'POST', url: '/api/tasks/with-attachments', ...multipart({ input: {
      task: { projectId, title: 'Terminal requirements', risk: { localScope: true, reversible: true, expectedOutcome: true, acceptanceCriteria: true, verificationStep: true } }, idempotencyKey: 'owner',
    } }, [file]) });
    assert.equal(response.statusCode, 201, response.body);
    const { task, attachments: [a] } = response.json().result;
    for (const query of [`?projectId=${other}`, '', '?projectId=../../settings']) {
      const expected = query.includes(other) ? 'PROJECT_MISMATCH' : 'INVALID_ID';
      for (const url of [`/api/tasks/${task.id}/attachments`, `/api/task-attachments/${a.id}/file`, `/api/task-attachments/${a.id}/thumbnail`]) {
        const denied = await f.api.inject({ url: url + query, headers });
        assert.equal(denied.json().code, expected, denied.body);
      }
      const denied = await f.api.inject({ method: 'DELETE', url: `/api/task-attachments/${a.id}${query}`, headers });
      assert.equal(denied.json().code, expected, denied.body);
    }
    const wrongProject = await f.api.inject({ method: 'POST', url: `/api/tasks/${task.id}/attachments`, ...multipart({ input: { projectId: other, idempotencyKey: 'bad-owner' } }, [{ ...file, bytes: Buffer.from('invalid') }]) });
    assert.equal(wrongProject.json().code, 'PROJECT_MISMATCH', wrongProject.body);
    const add = multipart({ input: { projectId, idempotencyKey: 'add-before-done' } }, [file]);
    assert.equal((await f.api.inject({ method: 'POST', url: `/api/tasks/${task.id}/attachments`, ...add })).statusCode, 201);
    // Only test setup in a disposable DB; this is never task/Visual QA evidence.
    await f.op('task.tests', { id: task.id, passed: true, evidence: 'Synthetic terminal-state fixture' });
    await f.op('task.transition', { id: task.id, to: 'done' });
    const before = counts(f.root);
    for (const input of [{ projectId, idempotencyKey: 'add-before-done' }, { projectId, idempotencyKey: 'new-after-done' }]) {
      const denied = await f.api.inject({ method: 'POST', url: `/api/tasks/${task.id}/attachments`, ...multipart({ input }, [file]) });
      assert.equal(denied.statusCode, 409, denied.body); assert.equal(denied.json().code, 'DONE_IS_TERMINAL');
    }
    const denied = await f.api.inject({ method: 'DELETE', url: `/api/task-attachments/${a.id}?projectId=${projectId}`, headers });
    assert.equal(denied.json().code, 'DONE_IS_TERMINAL', denied.body);
    const child = await f.api.inject({ method: 'POST', url: '/api/tasks/with-attachments', ...multipart({ input: {
      task: { projectId, title: 'Forbidden new child', parentId: task.id }, idempotencyKey: 'done-parent',
    } }, [file]) });
    assert.equal(child.json().code, 'DONE_IS_TERMINAL', child.body);
    for (const url of [a.fileUrl, a.thumbnailUrl]) assert.equal((await f.api.inject({ url, headers })).statusCode, 200);
    assert.equal((await f.op('task.attachment.list', { id: task.id, projectId })).length, 2);
    assert.deepEqual(counts(f.root), before);
  } finally { await f.close(); }
});

test('FLY45 sanitized binary/thumbnail responses strip metadata and block Host, Origin, path and local-file attacks', async () => {
  const f = await fixture();
  try {
    const projectId = (await f.op('project.create', { name: 'File serving' })).id;
    const file = await image('jpeg', 640, 480);
    file.bytes = await sharp(file.bytes).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    file.name = '../../reference.jpg';
    const response = await f.api.inject({ method: 'POST', url: '/api/tasks/with-attachments', ...multipart({ input: {
      task: { projectId, title: 'Safe serving' }, idempotencyKey: 'serving', altTexts: ['<script>untrusted text</script>'],
    } }, [file]) });
    assert.equal(response.statusCode, 201, response.body);
    const { task, attachments: [a] } = response.json().result;
    assert.equal(a.name, 'reference.jpg'); assert.equal(a.altText, '<script>untrusted text</script>');
    for (const key of ['path', 'data', 'originalPath', 'thumbnailPath', 'screenshotId']) assert.equal(key in a, false);
    for (const [url, thumbnail] of [[a.fileUrl, false], [a.thumbnailUrl, true]] as const) {
      const served = await f.api.inject({ url, headers });
      assert.equal(served.statusCode, 200);
      assert.equal(served.headers['content-type'], thumbnail ? 'image/webp' : 'image/jpeg');
      assert.equal(served.headers['x-content-type-options'], 'nosniff');
      assert.equal(served.headers['cache-control'], 'no-store');
      assert.equal(served.headers['cross-origin-resource-policy'], 'same-origin');
      assert.equal(served.headers['content-security-policy'], "default-src 'none'; sandbox");
      assert.equal(served.headers['content-disposition'], `inline; filename="image"; filename*=UTF-8''${thumbnail ? 'thumbnail.webp' : 'reference.jpg'}`);
      const meta = await sharp(served.rawPayload).metadata();
      assert.equal(meta.exif, undefined); assert.equal(meta.icc, undefined); assert.equal(meta.xmp, undefined);
      assert.equal(meta.orientation, undefined);
      if (thumbnail) assert.ok(meta.width! <= 320 && meta.height! <= 320);
      else {
        assert.equal(meta.width, 480); assert.equal(meta.height, 640);
        assert.equal(createHash('sha256').update(served.rawPayload).digest('hex'), a.sha256);
      }
      for (const attack of [{ ...headers, host: 'evil.example' }, { ...headers, origin: 'https://evil.example' }]) {
        const denied = await f.api.inject({ url, headers: attack }); assert.equal(denied.statusCode, 403, denied.body);
      }
    }
    for (const operation of ['task.create-with-attachments', 'task.attachment.add']) {
      const denied = await f.api.inject({ method: 'POST', url: `/api/operations/${operation}`, headers,
        payload: { id: task.id, projectId, task: { projectId, title: 'Must not read' }, files: ['C:/Windows/win.ini'], idempotencyKey: 'path-attack' } });
      assert.equal(denied.json().code, 'MULTIPART_REQUIRED', denied.body);
    }
    for (const id of ['..%2F..%2Fsettings', 'att_not-a-uuid', 'att_00000000-0000-0000-0000-000000000000']) {
      const denied = await f.api.inject({ url: `/api/task-attachments/${id}/file?projectId=${projectId}`, headers });
      assert.ok([400, 404].includes(denied.statusCode), denied.body);
      assert.ok(['INVALID_ID', 'NOT_FOUND'].includes(denied.json().code), denied.body);
      assert.ok(!denied.body.includes(f.root));
    }
    assert.deepEqual(await f.op('screenshot.list'), []);
    assert.deepEqual(await f.op('qa.list', { projectId }), []);
  } finally { await f.close(); }
});
