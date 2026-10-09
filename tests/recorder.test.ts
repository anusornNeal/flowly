import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { FlowlyApp } from '../packages/core/src/app.js';
import type { Project } from '../packages/core/src/models.js';

const actor={actor:'recorder-e2e',channel:'cli' as const};
const html='<!doctype html><html><body><button id="login">Log in</button><div id="status">Guest</div>'+
 '<script>document.querySelector("#login").addEventListener("click",()=>{localStorage.setItem("signedIn","yes");document.cookie="session=safe-demo; path=/";document.querySelector("#status").textContent="Signed in";});'+
 'if(localStorage.getItem("signedIn")==="yes")document.querySelector("#status").textContent="Signed in";</script></body></html>';
const previousHeadless=process.env.FLOWLY_BROWSER_HEADLESS;
test('Browser Recorder retains per-project session across restart, replays and selectively resets',{timeout:40000},async()=>{
 process.env.FLOWLY_BROWSER_HEADLESS='1';
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-recorder-'));
 const server=http.createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end(html);});
 await new Promise<void>((resolve)=>server.listen(0,'127.0.0.1',resolve));
 const addr=server.address();
 assert.ok(addr&&typeof addr!=='string');
 const baseUrl='http://127.0.0.1:'+addr.port+'/';
 let app:FlowlyApp|undefined;
 try{
  app=new FlowlyApp(root);
  const first=app.tasks.createProject({name:'A',platform:'web',baseUrl},actor);
  const second=app.tasks.createProject({name:'B',platform:'web',baseUrl},actor);
  const firstScreen='login-flow';
  await app.recorder.start(first.id,firstScreen,undefined,actor);
  const sessions=(app.recorder as any).sessions as Map<string,{page:import('playwright').Page}>;
  const pageA=sessions.get(first.id)?.page;
  assert.ok(pageA);
  await pageA.click('#login');
  assert.equal(await pageA.locator('#status').textContent(),'Signed in');
  const captured=await app.recorder.stop(first.id,actor);
  assert.equal(captured.steps.some(step=>step.action==='click'&&step.selector==='#login'),true);
  // Open Project B on SAME origin and confirm no cookies or localStorage are shared.
  await app.recorder.start(second.id,'second-flow',undefined,actor);
  const pageB=sessions.get(second.id)?.page;
  assert.ok(pageB);
  assert.equal(await pageB.evaluate(()=>localStorage.getItem('signedIn')),null);
  assert.equal(await pageB.locator('#status').textContent(),'Guest');
  await app.recorder.stop(second.id,actor);
  await app.close(); app=undefined;
  app=new FlowlyApp(root);
  const steps=app.recorder.recipe(first.id,firstScreen).steps;
  assert.ok(steps.length>0);
  // Profile is persistent after controlled window and Flowly app have closed.
  await app.recorder.start(first.id,'check-persistence',undefined,actor);
  const reopened=(app.recorder as any).sessions.get(first.id).page as import('playwright').Page;
  assert.equal(await reopened.evaluate(()=>localStorage.getItem('signedIn')),'yes');
  assert.match(await reopened.evaluate(()=>document.cookie),/session=safe-demo/);
  await app.recorder.stop(first.id,actor);
  const result=await app.recorder.replay(first.id,firstScreen,undefined,actor);
  assert.ok(result.replayed>0);
  await app.recorder.reset(first.id,true,actor);
  assert.equal(app.recorder.recipe(first.id,firstScreen).steps.length,steps.length);
  await app.recorder.start(first.id,'after-reset',undefined,actor);
  const resetPage=(app.recorder as any).sessions.get(first.id).page as import('playwright').Page;
  assert.equal(await resetPage.evaluate(()=>localStorage.getItem('signedIn')),null);
  assert.equal(await resetPage.locator('#status').textContent(),'Guest');
  await app.recorder.stop(first.id,actor);
  await app.recorder.start(second.id,'verify-other-project',undefined,actor);
  const stillIsolated=(app.recorder as any).sessions.get(second.id).page as import('playwright').Page;
  assert.equal(await stillIsolated.evaluate(()=>localStorage.getItem('signedIn')),null);
  await app.recorder.stop(second.id,actor);
 }finally{
  if(app)await app.close();
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  fs.rmSync(root,{recursive:true,force:true,maxRetries:4,retryDelay:200});
  if(previousHeadless===undefined)delete process.env.FLOWLY_BROWSER_HEADLESS;
  else process.env.FLOWLY_BROWSER_HEADLESS=previousHeadless;
 }
});
