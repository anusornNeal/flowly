import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview, type InlineConfig, type PreviewServer } from 'vite';
import webConfig from '../apps/web/vite.config.js';
import { createServer } from '../apps/api/src/server.js';
import { openChromium } from '../packages/capture/src/renderer.js';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

// Shared by the real browser suites: only /api reaches Fastify's static fallback.
export async function startSourceWeb(apiBase: string, webRoot = path.join(repositoryRoot, 'apps/web')) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-source-web-'));
  const config: InlineConfig = {
    ...webConfig,
    configFile: false,
    root: webRoot,
    cacheDir: path.join(temporaryRoot, 'vite-cache'),
    logLevel: 'warn',
    build: { ...webConfig.build, outDir: path.join(temporaryRoot, 'dist'), emptyOutDir: true },
    preview: {
      host: '127.0.0.1', port: 0, strictPort: false, open: false,
      proxy: { '/api': { target: apiBase, changeOrigin: true } },
    },
  };
  let vite: PreviewServer | undefined;
  const close = async () => {
    try { await vite?.close(); }
    finally { fs.rmSync(temporaryRoot, { recursive: true, force: true }); }
  };
  try {
    await build(config);
    vite = await preview(config);
    const address = vite.httpServer!.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(base);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.equal(html, fs.readFileSync(path.join(temporaryRoot, 'dist/index.html'), 'utf8'),
      'Browser entry must come from this test\'s fresh isolated build');
    return { base, close };
  } catch (error) {
    await close();
    throw error;
  }
}

// Imports expose the helper without registering the regression in every suite.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  test('FLY-0045: unchanged old dist cannot mask edits to browser source', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-stale-dist-'));
    const webRoot = path.join(root, 'web');
    fs.mkdirSync(path.join(webRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(webRoot, 'dist'), { recursive: true });
    const staleHtml = '<!doctype html><body><h1>Old dist still passes</h1></body>';
    fs.writeFileSync(path.join(webRoot, 'dist/index.html'), staleHtml);
    fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><body><h1></h1><script type="module" src="/src/main.ts"></script></body>');
    const api = await createServer({ root: path.join(root, 'database') });
    t.after(async () => {
      try { await api.close(); }
      finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
    const apiBase = await api.listen({ host: '127.0.0.1', port: 0 });
    const browser = await openChromium(true);
    t.after(() => browser.close());
    for (const text of ['Current source before edit', 'Current source after edit']) {
      fs.writeFileSync(path.join(webRoot, 'src/main.ts'), `const title: string = ${JSON.stringify(text)}; document.querySelector('h1')!.textContent = title;`);
      // Rebuild as a new npm test invocation would, with fresh isolated output.
      const web = await startSourceWeb(apiBase, webRoot);
      try {
        const page = await browser.newPage();
        try {
          await page.goto(web.base);
          await page.getByRole('heading', { name: text, exact: true }).waitFor();
          assert.equal(await page.getByRole('heading', { name: 'Old dist still passes' }).count(), 0);
          const health = await page.request.get(web.base + '/api/health');
          assert.equal(health.status(), 200);
          assert.equal((await health.json()).name, 'flowly');
        } finally { await page.close(); }
      } finally { await web.close(); }
      assert.equal(fs.readFileSync(path.join(webRoot, 'dist/index.html'), 'utf8'), staleHtml);
    }
    fs.writeFileSync(path.join(webRoot, 'src/main.ts'), 'const title: = ;');
    await assert.rejects(startSourceWeb(apiBase, webRoot), 'Broken current source must fail instead of serving old dist');
    assert.equal(fs.readFileSync(path.join(webRoot, 'dist/index.html'), 'utf8'), staleHtml);
  });
}
