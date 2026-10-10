import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

function git(root: string, args: string[]): string | null {
  const result = spawnSync('git', args, {
    cwd: root, encoding: 'utf8', shell: false, timeout: 3500,
  });
  return !result.error && result.status === 0 ? result.stdout.trim() : null;
}

function readSource(root: string) {
  const head = git(root, ['rev-parse', 'HEAD']);
  const status = git(root, ['status', '--porcelain', '--untracked-files=normal']);
  const available = Boolean(head && /^[a-f0-9]{40,64}$/i.test(head));
  const dirty = !available || status === null || status.length > 0;
  const revision = available ? head!.toLowerCase() : '';
  // Matches the clean-repository revision token produced by DevFlow.
  const token = revision
    ? `${revision.slice(0, 12)}:${createHash('sha256').update(revision).digest('hex').slice(0, 24)}`
    : '';
  return { revision, token, available, dirty };
}

/** Attests the actual started local repository, never a caller-supplied revision. */
export function createRuntimeAttestation(repoRoot = process.cwd()) {
  const root = path.resolve(repoRoot);
  const loaded = readSource(root);
  const runtimeInstanceId = randomUUID();
  return () => {
    const current = readSource(root);
    const fresh = loaded.available && current.available && !loaded.dirty
      && !current.dirty && loaded.revision === current.revision;
    return {
      name: 'flowly',
      runtimeInstanceId,
      loadedRevision: loaded.revision,
      loadedRepoToken: loaded.token,
      loadedSourceDirty: loaded.dirty,
      sourceRevisionAvailable: loaded.available,
      sourceFreshness: {
        code: fresh ? 'current' : 'stale',
        loadedRevision: loaded.revision,
        currentRevision: current.revision,
        loadedSourceDirty: loaded.dirty,
        currentSourceDirty: current.dirty,
        headMismatch: loaded.revision !== current.revision,
      },
    };
  };
}
