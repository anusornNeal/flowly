import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRuntimeAttestation } from '../apps/api/src/runtimeAttestation.js';

test('runtime revision attestation detects changed source and preserves boot identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-runtime-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    git('config', 'user.email', 'qa@example.invalid');
    git('config', 'user.name', 'QA');
    fs.writeFileSync(path.join(root, 'source.txt'), 'initial');
    git('add', 'source.txt');
    git('commit', '-qm', 'initial source');
    const revision = git('rev-parse', 'HEAD').toLowerCase();
    const capabilities = createRuntimeAttestation(root);
    const loaded = capabilities();
    assert.equal(loaded.loadedRevision, revision);
    assert.equal(loaded.sourceFreshness.code, 'current');
    assert.equal(loaded.loadedSourceDirty, false);
    assert.equal(loaded.loadedRepoToken,
      revision.slice(0, 12) + ':' + createHash('sha256').update(revision).digest('hex').slice(0, 24));

    fs.appendFileSync(path.join(root, 'source.txt'), '-modified');
    const changed = capabilities();
    assert.equal(changed.runtimeInstanceId, loaded.runtimeInstanceId);
    assert.equal(changed.sourceFreshness.code, 'stale');
    assert.equal(changed.sourceFreshness.currentSourceDirty, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
