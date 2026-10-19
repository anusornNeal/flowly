import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { openChromium } from '../packages/capture/src/renderer.js';

// Isolated browser harness: imports only owned components, never App/API or a DB.
const harness = `import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {TaskComposer, validateTaskImage} from './apps/web/src/components/TaskComposer.tsx';
import {TaskAttachmentGallery, safeTaskImageSource} from './apps/web/src/components/TaskAttachmentGallery.tsx';
window.validateTaskImage = validateTaskImage; window.safeTaskImageSource = safeTaskImageSource;
window.created = []; window.revoked = []; window.submissions = []; window.removed = []; window.savedAlt = [];
const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = file => {const url = create(file); window.created.push(url); return url;};
URL.revokeObjectURL = url => {window.revoked.push(url); revoke(url);};
const empty = () => ({title:'',description:'',priority:'medium',attachments:[]});
function Harness(){
 const [value,setValue] = useState(empty), [open,setOpen] = useState(false), [done,setDone] = useState(false);
 const imageUrl = suffix => '/api/task-attachments/att_12345678-1234-1234-1234-12345678900'+suffix+'/file?projectId=proj_12345678-1234-1234-1234-123456789abc';
 const [images,setImages] = useState([{id:'one',name:'one.png',src:imageUrl('1'),altText:'First image'},
 {id:'two',name:'two.png',src:imageUrl('2')}, {id:'missing',name:'deleted.png',missing:true},
 {id:'broken',name:'broken.png',src:imageUrl('3')}, {id:'unsafe',name:'external.png',src:'https://example.com/never.png'}]);
 window.setImages=setImages;
 return React.createElement(React.Fragment,null,
 React.createElement('button',{onClick:()=>setOpen(true)},'New task'),
 React.createElement('button',{onClick:()=>setDone(!done)},'Toggle Done'),
 React.createElement(TaskComposer,{open,value,onChange:setValue,kind:'subtask',parentId:'parent-1',
 getAttachmentMarkdown:a=>'![draft '+a.altText+'](attachment:'+a.id+')',
 onCancel:()=>{setValue(empty());setOpen(false)},onSubmit:async(v,c)=>{window.submissions.push({value:v,context:c});
 if(window.submissions.length===1)throw Error('Offline: retry your draft');
 if(window.holdSubmit)await new Promise(resolve=>window.releaseSubmit=resolve);setOpen(false);setValue(empty());}}),
 React.createElement(TaskAttachmentGallery,{attachments:images,status:done?'done':'todo',onAdd:()=>setOpen(true),
 onRemove:async a=>{if(window.failRemove)throw Error('Permission denied');window.removed.push(a.id);setImages(items=>items.filter(i=>i.id!==a.id));},
 onAltTextChange:async(a,text)=>{window.savedAlt.push(text);setImages(items=>items.map(i=>i.id===a.id?{...i,altText:text}:i));}}));
}
createRoot(document.getElementById('root')).render(React.createElement(Harness));`;

// Pure-JS test bundling avoids native esbuild permissions and shared Vite caches
// in worktrees whose node_modules is a junction. No application files are emitted.
function browserBundle() {
  const modules = new Map<string, string>();
  const entry = path.join(process.cwd(), 'attachment-harness.tsx');
  const visit = (file: string, source = fs.readFileSync(file, 'utf8')): string => {
    if (modules.has(file)) return file;
    modules.set(file, '');
    let code = /\.tsx?$/.test(file) ? ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText : source;
    code = code.replace(/require\(["']([^"']+)["']\)/g, (_match, specifier: string) => {
      if (specifier.endsWith('.css')) return '({})';
      const resolved = createRequire(file).resolve(specifier);
      visit(resolved);
      return `require(${JSON.stringify(resolved)})`;
    });
    modules.set(file, code); return file;
  };
  visit(entry, harness);
  return `const process={env:{NODE_ENV:'development'}};const modules={${[...modules].map(([id, code]) => `${JSON.stringify(id)}:(require,module,exports)=>{${code}\n}`).join(',')}};
const cache={};function require(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;modules[id](require,module,module.exports);return module.exports;}require(${JSON.stringify(entry)});`;
}

test('isolated attachment UI: drafts, validation, retry, cleanup, gallery, keyboard and mobile', { timeout: 120_000 }, async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0WQAAAAASUVORK5CYII=', 'base64');
  const bundle = browserBundle();
  const server = createServer((req, res) => {
        if (req.url?.startsWith('/api/task-attachments/att_12345678-1234-1234-1234-123456789003/')) { res.statusCode = 404; res.end(); return; }
        if (req.url?.startsWith('/api/task-attachments/')) { res.setHeader('Content-Type', 'image/png'); res.end(png); return; }
        if (req.url === '/harness.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); return; }
        if (req.url === '/media.css') { res.setHeader('Content-Type', 'text/css'); res.end(fs.readFileSync('apps/web/src/components/taskAttachments.css')); return; }
        if (req.url === '/attachment-test') {
          res.setHeader('Content-Type', 'text/html');
          res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/media.css"></head><body><div id="root"></div><script src="/harness.js"></script></body></html>'); return;
        }
        res.statusCode = 404; res.end();
  });
  let browser: Awaited<ReturnType<typeof openChromium>> | undefined;
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    browser = await openChromium(true);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const runtimeErrors: string[] = [];
    const externalRequests: string[] = [];
    page.on('pageerror', error => runtimeErrors.push(error.message));
    page.on('request', request => { if (request.url().startsWith('https://example.com')) externalRequests.push(request.url()); });
    await page.goto(`http://127.0.0.1:${address.port}/attachment-test`);
    await page.getByRole('button', { name: 'New task', exact: true }).waitFor();
    const checks = await page.evaluate(() => {
      const win = window as any;
      return {
        limit: win.validateTaskImage({ type: 'image/png', size: 25 * 1024 * 1024 }),
        large: win.validateTaskImage({ type: 'image/png', size: 25 * 1024 * 1024 + 1 }),
        empty: win.validateTaskImage({ type: 'image/png', size: 0 }),
        svg: win.validateTaskImage({ type: 'image/svg+xml', size: 1 }),
        unsafe: ['javascript:alert(1)', '//evil.test/x', 'data:image/png,x', '/\\evil.test/x', 'https://evil.test/x'].map(url => win.safeTaskImageSource(url)),
      };
    });
    assert.equal(checks.limit, undefined);
    assert.match(checks.large!, /25 MiB/); assert.match(checks.empty!, /empty/); assert.match(checks.svg!, /PNG/);
    assert.deepEqual(checks.unsafe, Array(5).fill(undefined));
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    const composer = page.getByRole('dialog', { name: 'Create subtask' });
    assert.equal(await page.getByLabel('Title (required)').evaluate(el => el === document.activeElement), true);
    assert.equal(await composer.getByRole('button', { name: 'Create subtask', exact: true }).isDisabled(), true);
    await page.getByLabel('Title (required)').fill(' Draft with images ');
    await composer.locator('input[type=file]').setInputFiles([
      { name: 'one.png', mimeType: 'image/png', buffer: png },
      { name: 'two.png', mimeType: 'image/png', buffer: png },
      { name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') },
    ]);
    await composer.getByText('bad.svg: Use a PNG, JPEG or WebP image.').waitFor();
    await composer.getByRole('button', { name: 'Move two.png earlier' }).click();
    assert.equal(await composer.locator('.task-media-drafts li').first().locator('strong').textContent(), 'two.png');
    await composer.getByLabel('Alt text for two.png').fill('Useful alt');
    await composer.getByRole('button', { name: 'Insert in description' }).first().click();
    assert.match(await page.getByLabel('Description (Markdown)').inputValue(), /draft Useful alt/);
    // Exercise real File lists from drop and clipboard without OS clipboard access.
    for (const type of ['drop', 'paste']) await composer.locator(type === 'drop' ? 'section' : 'form').evaluate((element, type) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array([1])], type + '.webp', { type: 'image/webp' }));
      element.dispatchEvent(type === 'drop' ? new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }) : new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
    }, type);
    assert.equal(await composer.locator('.task-media-drafts li').count(), 4);
    await composer.locator('input[type=file]').setInputFiles(Array.from({ length: 7 }, (_, index) => ({ name: `extra-${index}.png`, mimeType: 'image/png', buffer: png })));
    await composer.getByText('extra-6.png: Maximum 10 images per card.').waitFor();
    assert.equal(await composer.locator('.task-media-drafts li').count(), 10);
    await composer.getByRole('button', { name: 'Remove one.png', exact: true }).click();
    await composer.getByRole('button', { name: 'Create subtask', exact: true }).click();
    await composer.getByText('Offline: retry your draft').waitFor();
    assert.equal(await composer.locator('.task-media-drafts li').count(), 9);
    await page.evaluate(() => { (window as any).holdSubmit = true; });
    await composer.getByRole('button', { name: 'Create subtask', exact: true }).click();
    await composer.getByRole('progressbar', { name: 'Saving images' }).waitFor();
    assert.equal(await composer.getByRole('button', { name: 'Cancel', exact: true }).isDisabled(), true);
    assert.equal(await page.getByLabel('Title (required)').isDisabled(), true);
    await page.keyboard.press('Escape'); assert.equal(await composer.isVisible(), true);
    await page.evaluate(() => (window as any).releaseSubmit());
    await composer.waitFor({ state: 'detached' });
    const saved = await page.evaluate(() => (window as any).submissions);
    assert.equal(saved.length, 2); assert.equal(saved[1].value.title, 'Draft with images');
    assert.deepEqual(saved[1].context, { kind: 'subtask', parentId: 'parent-1' });
    assert.deepEqual(await page.evaluate(() => [...(window as any).created].sort()), await page.evaluate(() => [...(window as any).revoked].sort()));
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    await composer.locator('input[type=file]').setInputFiles({ name: 'cancel.png', mimeType: 'image/png', buffer: png });
    await page.keyboard.press('Escape'); await composer.waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('button', { name: 'New task', exact: true }).evaluate(el => el === document.activeElement), true);
    assert.deepEqual(await page.evaluate(() => [...(window as any).created].sort()), await page.evaluate(() => [...(window as any).revoked].sort()));
    const gallery = page.getByRole('region', { name: 'Task images' });
    await gallery.getByLabel('Alt text for one.png').fill('Updated alt');
    await gallery.getByRole('button', { name: 'Save alt text' }).first().click();
    assert.deepEqual(await page.evaluate(() => (window as any).savedAlt), ['Updated alt']);
    await page.getByRole('button', { name: 'Open image one.png' }).click();
    const lightbox = page.getByRole('dialog', { name: 'one.png' });
    await lightbox.waitFor(); await page.keyboard.press('ArrowRight');
    await page.getByRole('dialog', { name: 'two.png' }).waitFor();
    await page.getByRole('button', { name: 'Zoom image' }).click();
    assert.equal(await page.getByRole('button', { name: 'Fit image' }).getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', { name: 'Open image one.png' }).evaluate(el => el === document.activeElement), true);
    await gallery.getByRole('button', { name: 'Remove one.png', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => (window as any).removed), []);
    await page.evaluate(() => { (window as any).failRemove = true; });
    await gallery.getByRole('button', { name: 'Confirm remove', exact: true }).click();
    await gallery.getByText('Permission denied').waitFor();
    await page.evaluate(() => { (window as any).failRemove = false; });
    await gallery.getByRole('button', { name: 'Confirm remove', exact: true }).click();
    await gallery.getByRole('button', { name: 'Open image one.png' }).waitFor({ state: 'detached' });
    assert.deepEqual(await page.evaluate(() => (window as any).removed), ['one']);
    assert.ok(await gallery.getByText('Image missing. Update any Markdown reference.', { exact: true }).count() >= 2);
    await gallery.getByText('Image unavailable. Check your connection.').waitFor();
    await page.getByRole('button', { name: 'Toggle Done' }).click();
    assert.equal(await gallery.getByRole('button', { name: /^Remove / }).count(), 0);
    assert.equal(await gallery.getByRole('textbox').count(), 0);
    assert.equal(await gallery.getByRole('button', { name: 'Add images' }).count(), 0);
    const artifacts = path.join(process.cwd(), 'data/qa'); fs.mkdirSync(artifacts, { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole('button', { name: 'New task', exact: true }).click();
      await composer.locator('input[type=file]').setInputFiles({ name: 'a-very-long-image-name-'.repeat(12) + '.png', mimeType: 'image/png', buffer: png });
      assert.equal(await composer.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
      await page.screenshot({ path: path.join(artifacts, `task-attachment-ui-${width}.png`) });
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.getByRole('button', { name: 'Enlarge two.png' }).click();
      const mobileLightbox = page.getByRole('dialog', { name: 'two.png' });
      assert.equal(await mobileLightbox.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
      await page.getByRole('button', { name: 'Zoom image' }).focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.getByRole('button', { name: 'Close image' }).evaluate(el => el === document.activeElement), true);
      await page.screenshot({ path: path.join(artifacts, `task-attachment-ui-lightbox-${width}.png`) });
      await page.keyboard.press('Escape');
      await page.screenshot({ path: path.join(artifacts, `task-attachment-ui-gallery-${width}.png`) });
    }
    await page.evaluate(() => (window as any).setImages(null));
    await gallery.getByText('No images attached.').waitFor();
    assert.deepEqual(runtimeErrors, []); assert.deepEqual(externalRequests, []);
  } finally { await browser?.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
