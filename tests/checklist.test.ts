import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FlowlyApp } from '../packages/core/src/app.js';
import { DomainError } from '../packages/core/src/models.js';

const agent = { actor: 'checklist-regression', channel: 'cli' as const };

test('ordered checklist persists add, edit, toggle, reorder and remove across restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-checklist-'));
  let app = new FlowlyApp(root);
  try {
    const project = app.tasks.createProject({ name: 'Checklist regressions' }, agent);
    const task = app.tasks.createTask({ projectId: project.id, title: 'Checklist' }, agent);
    app.tasks.checklist(task.id, 'add', { text: 'Create layout' }, agent);
    app.tasks.checklist(task.id, 'add', { text: 'Verify keyboard' }, agent);
    app.tasks.checklist(task.id, 'add', { text: 'Verify mobile' }, agent);
    const [first, second, third] = app.tasks.task(task.id).checklist;
    assert.ok(first && second && third);
    app.tasks.checklist(task.id, 'toggle', { itemId: first.id, done: true }, agent);
    app.tasks.checklist(task.id, 'edit', { itemId: second.id, text: 'Verify keyboard focus' }, agent);
    app.tasks.checklist(task.id, 'reorder', { itemId: third.id, index: 0 }, agent);
    assert.deepEqual(app.tasks.taskDetail(task.id).task.checklist.map(x => x.text),
      ['Verify mobile', 'Create layout', 'Verify keyboard focus']);
    assert.equal(app.tasks.task(task.id).checklist.filter(x => x.done).length, 1);
    await app.close();
    app = new FlowlyApp(root);
    assert.deepEqual(app.tasks.task(task.id).checklist.map(x => x.id), [third.id, first.id, second.id]);
    assert.equal(app.tasks.task(task.id).checklist[1]?.done, true);
    app.tasks.checklist(task.id, 'remove', { itemId: third.id }, agent);
    assert.equal(app.tasks.task(task.id).checklist.length, 2);
    assert.throws(() => app.tasks.checklist(task.id, 'reorder',
      { itemId: first.id, index: 99 }, agent),
      (error: unknown) => error instanceof DomainError && error.code === 'INVALID_INDEX');
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
