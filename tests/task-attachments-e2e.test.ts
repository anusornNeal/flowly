import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fixture, headers, image, multipart, cli } from './fly45-qa-fixture.js';
import type { AttachmentCreateResult } from '../packages/core/src/taskAttachments.js';
import { openChromium } from '../packages/capture/src/renderer.js';

test('FLY45 real HTTP Task/Subtask/Bug multipart lifecycle and independent galleries survive restart', async () => {
  const f = await fixture();
  try {
    let base = await f.api.listen({ host: '127.0.0.1', port: 0 });
    const projectId = (await f.op('project.create', { name: 'FLY45 isolated matrix' })).id;
    const files = await Promise.all([image(), image('jpeg'), image('webp')]);
    const results: AttachmentCreateResult[] = [];
    for (const kind of ['task', 'subtask', 'bug']) {
      const input = { task: { projectId, title: `FLY45 ${kind}`, description: '**Reference** <script>never execute</script>',
        ...(kind === 'subtask' ? { parentId: results[0]!.task.id } : {}), ...(kind === 'bug' ? { type: 'bug' } : {}) },
        idempotencyKey: kind, altTexts: ['PNG reference', 'JPEG reference', '<img src=x onerror=alert(1)>'] };
      const form = multipart({ input }, files);
      const response = await fetch(base + '/api/tasks/with-attachments', { method: 'POST', headers: { 'content-type': form.headers['content-type'] }, body: new Uint8Array(form.payload) });
      assert.equal(response.status, 201, await response.clone().text());
      const { result } = await response.json() as { result: AttachmentCreateResult };
      results.push(result);
      assert.equal(result.task.parentId, kind === 'subtask' ? results[0]!.task.id : undefined);
      assert.equal(result.task.type, kind === 'bug' ? 'bug' : 'task');
      assert.deepEqual(result.attachments.map(a => a.sortOrder), [0, 1, 2]);
      assert.deepEqual(result.attachments.map(a => a.name), files.map(a => a.name));
      assert.equal(result.attachments[2]!.altText, input.altTexts[2]);
      assert.ok(result.attachments.every(a => a.taskId === result.task.id && a.projectId === projectId));
    }
    assert.equal(new Set(results.flatMap(r => r.attachments.map(a => a.id))).size, 9);
    await f.restart();
    base = await f.api.listen({ host: '127.0.0.1', port: 0 });
    for (const result of results) {
      const detail = await f.op('task.context', { id: result.task.id });
      assert.deepEqual(detail.attachments, result.attachments);
      for (const a of result.attachments) {
        const response = await fetch(base + a.fileUrl);
        assert.equal(response.status, 200);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(createHash('sha256').update(bytes).digest('hex'), a.sha256);
        assert.equal(bytes.length, a.sizeBytes);
      }
    }
    const child = results[1]!;
    const removed = await f.api.inject({ method: 'DELETE', url: `/api/task-attachments/${child.attachments[0]!.id}?projectId=${projectId}`, headers });
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal((await f.op('task.attachment.list', { id: child.task.id, projectId })).length, 2);
    assert.equal((await f.op('task.attachment.list', { id: results[0]!.task.id, projectId })).length, 3);
    assert.equal((await f.op('task.attachment.list', { id: results[2]!.task.id, projectId })).length, 3);
    assert.deepEqual(await f.op('screenshot.list'), []);
    assert.deepEqual(await f.op('screenshot.inbox'), []);
    assert.deepEqual(await f.op('qa.list', { projectId }), []);
  } finally { await f.close(); }
});

test('FLY45 HTTP/CLI exact retry parity, changed payload conflicts, deletion receipts and project key namespace', { timeout: 90_000 }, async () => {
  const f = await fixture();
  try {
    const projectId = (await f.op('project.create', { name: 'Retry matrix' })).id;
    const file = await image();
    const localPath = path.join(f.root, file.name); fs.writeFileSync(localPath, file.bytes);
    const task = { projectId, title: 'Lost response retry', description: 'Exact metadata' };
    const input = { task, idempotencyKey: 'cross-transport', altTexts: ['reference'] };
    const send = () => f.api.inject({ method: 'POST', url: '/api/tasks/with-attachments', ...multipart({ input }, [file]) });
    const [one, two] = await Promise.all([send(), send()]);
    assert.deepEqual([one.statusCode, two.statusCode].sort(), [200, 201]);
    const created = one.json().result as AttachmentCreateResult;
    assert.equal(created.task.id, two.json().result.task.id);
    await f.restart();
    const cliInput = { task, idempotencyKey: input.idempotencyKey, files: [{ path: localPath, name: file.name, mime: file.mime, altText: 'reference' }] };
    const replay = await cli(f.root, 'task.create-with-attachments', cliInput);
    assert.equal(replay.exit, 0, JSON.stringify(replay.result));
    assert.deepEqual(replay.result.result, { ...created, replayed: true });
    for (const changed of [
      { ...input, altTexts: ['changed'] }, { ...input, task: { ...task, title: 'changed' } },
    ]) {
      const conflict = await f.api.inject({ method: 'POST', url: '/api/tasks/with-attachments', ...multipart({ input: changed }, [file]) });
      assert.equal(conflict.statusCode, 409, conflict.body); assert.equal(conflict.json().code, 'IDEMPOTENCY_CONFLICT');
    }
    const conflict = await cli(f.root, 'task.create-with-attachments', { ...cliInput, files: [{ ...cliInput.files[0], altText: 'changed' }] });
    assert.notEqual(conflict.exit, 0); assert.equal(conflict.result.code, 'IDEMPOTENCY_CONFLICT');
    const a = created.attachments[0]!;
    const removed = await cli(f.root, 'task.attachment.remove', { id: a.id, projectId });
    assert.equal(removed.exit, 0, JSON.stringify(removed.result));
    await f.restart();
    assert.equal((await send()).statusCode, 200);
    assert.deepEqual(await f.op('task.attachment.list', { id: created.task.id, projectId }), []);
    for (const url of [a.fileUrl, a.thumbnailUrl]) assert.equal((await f.api.inject({ url, headers })).statusCode, 410);
    const other = (await f.op('project.create', { name: 'Other namespace' })).id;
    const otherResult = await f.api.inject({ method: 'POST', url: '/api/tasks/with-attachments', ...multipart({ input: { ...input, task: { ...task, projectId: other } } }, [file]) });
    assert.equal(otherResult.statusCode, 201, otherResult.body);
    assert.notEqual(otherResult.json().result.task.id, created.task.id);
    const history = await f.op('task.history', { projectId, id: created.task.id });
    assert.equal(history.filter((e: any) => e.action === 'task.attachment.add').length, 1);
    assert.equal(history.filter((e: any) => e.action === 'task.attachment.remove').length, 1);
    assert.ok(!JSON.stringify(history).includes(localPath));
  } finally { await f.close(); }
});

test('FLY45 external token, SourceId+CaptureId, inbox and cleanup receipts stay separate from attachments', async () => {
  const f = await fixture();
  try {
    const projectId = (await f.op('project.create', { name: 'Ingress isolation' })).id;
    const file = await image();
    const token = (await f.op('settings.token.reveal')).token;
    const external = multipart({ projectId, sourceId: 'fly45', captureId: 'shared-key', taskId: 'unknown-task', screenId: 'unknown-screen' }, [file], 'file');
    for (const authorization of ['', 'Bearer invalid']) {
      const denied = await f.api.inject({ method: 'POST', url: '/api/screenshots/external', headers: { ...external.headers, authorization }, payload: Buffer.from('malformed multipart') });
      assert.equal(denied.statusCode, 401, denied.body);
      assert.equal(denied.json().code, 'UNAUTHORIZED');
    }
    const send = () => f.api.inject({ method: 'POST', url: '/api/screenshots/external', ...external, headers: { ...external.headers, authorization: `Bearer ${token}` } });
    const first = await send(); assert.equal(first.statusCode, 200, first.body);
    const shot = first.json().result.screenshot;
    assert.equal(shot.taskId, undefined);
    assert.equal((await f.op('screenshot.inbox')).length, 1);
    const input = { task: { projectId, title: 'Same bytes, independent requirement' }, idempotencyKey: 'shared-key' };
    const attachmentResponse = await f.api.inject({ method: 'POST', url: '/api/tasks/with-attachments', ...multipart({ input }, [file]) });
    assert.equal(attachmentResponse.statusCode, 201, attachmentResponse.body);
    const attachment = attachmentResponse.json().result.attachments[0];
    assert.match(attachment.id, /^att_/); assert.notEqual(shot.id, attachment.id);
    assert.equal((await f.op('screenshot.list')).length, 1);
    assert.deepEqual(await f.op('qa.list', { projectId }), []);
    await f.op('screenshot.cleanup', { ids: [shot.id] });
    await f.restart();
    const retry = await send(); assert.equal(retry.statusCode, 200, retry.body);
    assert.equal(retry.json().result.duplicate, true);
    assert.equal(retry.json().result.screenshot.status, 'deleted');
    assert.equal((await f.api.inject({ url: attachment.fileUrl, headers })).statusCode, 200);
    assert.deepEqual(await f.op('screenshot.inbox'), []);
    assert.deepEqual(await f.op('qa.list', { projectId }), []);
    const history = await f.op('task.history', { projectId });
    assert.ok(history.every((e: any) => e.action !== 'qa.verdict'));
  } finally { await f.close(); }
});

test('FLY45 real rendered Preview case remains pending after screenshot arrival, attachment edits and restart', { timeout: 60_000 }, async () => {
  const f = await fixture();
  try {
    const projectId = (await f.op('project.create', { name: 'Pending verdict isolation' })).id;
    const task = await f.op('task.create', { projectId, title: 'No automatic verdict' });
    const preview = await f.op('preview.create', { projectId, taskId: task.id, name: 'Isolated rendered fixture',
      html: '<!doctype html><html lang="en"><head><title>QA fixture</title></head><body><main><h1>Reference</h1></main></body></html>',
      screens: [{ id: 'reference', name: 'Reference', stateId: 'default', viewport: { width: 390, height: 844, device: 'mobile' }, required: true }] });
    const revision = await f.op('preview.revision.save', { id: preview.id });
    // The normal renderer/quality gate runs. No store seeding, warning override,
    // QA verdict, review, Force Done or approval of real project data is used.
    const approved = await f.op('preview.approve', { id: preview.id, revisionId: revision.id });
    const qa = approved.cases[0];
    assert.ok(qa); assert.equal(qa.verdict, undefined);
    const token = (await f.op('settings.token.reveal')).token;
    const file = await image();
    const body = multipart({ projectId, taskId: task.id, screenId: 'reference', stateId: 'default', caseId: qa.id,
      sourceId: 'fly45-rendered', captureId: 'pending-capture' }, [file], 'file');
    const response = await f.api.inject({ method: 'POST', url: '/api/screenshots/external', ...body,
      headers: { ...body.headers, authorization: `Bearer ${token}` } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().result.comparison.status, 'awaiting-verdict');
    const pending = await f.op('qa.get', { id: qa.id });
    assert.equal(pending.verdict, undefined); assert.ok(pending.evidenceId);
    const added = await f.api.inject({ method: 'POST', url: `/api/tasks/${task.id}/attachments`, ...multipart({ input: {
      projectId, idempotencyKey: 'pending-capture',
    } }, [file]) });
    assert.equal(added.statusCode, 201, added.body);
    assert.deepEqual(await f.op('qa.get', { id: qa.id }), pending);
    const attachment = added.json().result.attachments[0];
    assert.equal((await f.api.inject({ method: 'DELETE', url: `/api/task-attachments/${attachment.id}?projectId=${projectId}`, headers })).statusCode, 200);
    await f.restart();
    assert.deepEqual(await f.op('qa.get', { id: qa.id }), pending);
    const shot = await f.op('screenshot.get', { id: pending.evidenceId });
    assert.equal(shot.status, 'active');
    const history = await f.op('task.history', { projectId, id: task.id });
    assert.ok(history.every((e: any) => e.action !== 'qa.verdict'));
    assert.ok((await f.op('task.blockers', { id: task.id })).includes('REQUIRED_QA_INCOMPLETE'));
  } finally { await f.close(); }
});

// Opt-in runs against source through Vite and a fresh API/DB, never an arbitrary
// supplied URL or a stale dist. Missing wiring/browser is a failure when enabled.
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`FLY45 real App Composer/Gallery ${viewport.width}x${viewport.height}`, {
    skip: process.env.FLOWLY_FLY45_UI !== '1' ? 'Pending integration: opt in with FLOWLY_FLY45_UI=1 after App wiring' : false,
    timeout: 90_000,
  }, async t => {
    const f = await fixture();
    let vite: import('vite').ViteDevServer | undefined;
    let browser: Awaited<ReturnType<typeof openChromium>> | undefined;
    const artifacts = path.resolve('data/qa/fly45', `${Date.now()}-${viewport.width}`);
    fs.mkdirSync(artifacts, { recursive: true });
    try {
      const source = fs.readFileSync('apps/web/src/App.tsx', 'utf8');
      assert.ok(/<TaskComposer\b/.test(source), 'Prerequisite missing: App.tsx does not render TaskComposer');
      assert.ok(/<TaskAttachmentGallery\b/.test(source), 'Prerequisite missing: App.tsx does not render TaskAttachmentGallery');
      const base = await f.api.listen({ host: '127.0.0.1', port: 0 });
      const { createServer } = await import('vite');
      vite = await createServer({ configFile: path.resolve('apps/web/vite.config.ts'), configLoader: 'runner', cacheDir: path.join(f.root, 'vite-cache'),
        server: { host: '127.0.0.1', port: 0, proxy: { '/api': base } } });
      await vite.listen();
      browser = await openChromium(true);
      const page = await browser.newPage({ viewport });
      page.setDefaultTimeout(10_000);
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      const ui = vite.resolvedUrls!.local[0]!;
      await page.goto(ui);
      await page.getByRole('textbox', { name: 'Project name' }).fill('FLY45 disposable UI project');
      await page.getByRole('button', { name: 'Create project', exact: true }).click();
      await page.getByRole('button', { name: /Task Board/ }).first().click();
      await page.getByRole('button', { name: 'New task', exact: true }).click();
      const composer = page.getByRole('dialog');
      await composer.getByRole('textbox', { name: 'Title (required)', exact: true }).fill('FLY45 real UI image');
      const file = await image();
      await composer.locator('input[type=file]').setInputFiles({ name: file.name, mimeType: file.mime, buffer: file.bytes });
      await composer.getByRole('textbox', { name: `Alt text for ${file.name}` }).fill('FLY45 reference');
      await page.screenshot({ path: path.join(artifacts, 'composer.png'), fullPage: true });
      const createdResponse = page.waitForResponse(r => r.url().endsWith('/api/tasks/with-attachments') && r.request().method() === 'POST');
      await composer.getByRole('button', { name: 'Create task', exact: true }).click();
      const response = await createdResponse;
      assert.equal(response.status(), 201);
      const result = (await response.json()).result as AttachmentCreateResult;
      const gallery = page.getByRole('region', { name: 'Task images', exact: true });
      await composer.waitFor({ state: 'hidden' });
      if (!(await gallery.isVisible())) await page.getByText('FLY45 real UI image', { exact: true }).first().click();
      await gallery.getByRole('button', { name: `Enlarge ${file.name}`, exact: true }).click();
      await page.getByRole('button', { name: 'Zoom image', exact: true }).click();
      await page.keyboard.press('Escape');
      await page.reload();
      await page.getByRole('button', { name: /Task Board/ }).first().click();
      await page.getByText('FLY45 real UI image', { exact: true }).first().click();
      await page.getByRole('button', { name: `Open image ${file.name}`, exact: true }).waitFor();
      const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(layout.scroll <= layout.width + 2, JSON.stringify(layout));
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(artifacts, 'gallery.png'), fullPage: true });
      assert.equal((await f.op('task.attachment.list', { id: result.task.id, projectId: result.task.projectId })).length, 1);
      assert.deepEqual(await f.op('screenshot.list'), []);
      assert.deepEqual(await f.op('qa.list', { projectId: result.task.projectId }), []);
      fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify({ automatedAssertions: 'passed', visualQaVerdict: 'PENDING', viewport, layout, errors }, null, 2));
    } catch (error) {
      fs.writeFileSync(path.join(artifacts, 'failure.txt'), String(error));
      throw error;
    } finally {
      t.diagnostic(`Evidence: ${artifacts}; screenshots never assign Visual QA PASS`);
      try { await browser?.close(); }
      finally { try { await vite?.close(); } finally { await f.close(); } }
    }
  });
}
