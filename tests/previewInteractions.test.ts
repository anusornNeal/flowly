import test from 'node:test';
import assert from 'node:assert/strict';
import { openChromium } from '../packages/capture/src/renderer.js';
import { previewDocument } from '../apps/web/src/previewDocument.js';

test('sandboxed multi-state journey supports native keyboard, navigation and Back', async () => {
 const browser = await openChromium(true);
 try {
  const page = await browser.newPage();
  await page.setContent('<iframe title="Interactive preview" sandbox="allow-scripts"></iframe>');
  const src = previewDocument({
   html: '<main data-flowly-screen="login"><section data-flowly-state="default"><button data-flowly-go="loading">Continue</button></section><section data-flowly-state="loading"><button data-flowly-go="login|error">Show error</button></section><section data-flowly-state="error"><p role="alert">Wrong password</p></section></main><main data-flowly-screen="home"><h1>Home</h1></main>',
   css: '',
   js: '',
   screens: [],
   contextSnapshot: {},
  }, { id: 'login', name: 'Login', stateId: 'default', viewport: { width: 390, height: 800, device: 'mobile' } });
  await page.locator('iframe').evaluate((element, documentHtml) => {
   (element as HTMLIFrameElement).srcdoc = documentHtml;
  }, src);
  const frame = page.frameLocator('iframe');
  await frame.getByRole('button', { name: 'Continue' }).focus();
  await frame.getByRole('button', { name: 'Continue' }).press('Enter');
  assert.equal(await frame.getByRole('button', { name: 'Show error' }).isVisible(), true);
  await frame.getByRole('button', { name: 'Show error' }).click();
  assert.equal(await frame.getByRole('alert').textContent(), 'Wrong password');
  await page.locator('iframe').evaluate(element => {
   (element as HTMLIFrameElement).contentWindow?.postMessage({ type: 'flowly-preview-back' }, '*');
  });
  assert.equal(await frame.getByRole('button', { name: 'Show error' }).isVisible(), true);
  await page.locator('iframe').evaluate(element => {
   (element as HTMLIFrameElement).contentWindow?.postMessage({ type: 'flowly-preview-select', screenId: 'home', stateId: 'default' }, '*');
  });
  assert.equal(await frame.getByRole('heading', { name: 'Home' }).isVisible(), true);
  assert.equal(await frame.locator('body').evaluate(() => {
   try { void window.parent.document.body; return false; } catch { return true; }
  }), true, 'Sandbox must not access the host document');
 } finally {
  await browser.close();
 }
});
