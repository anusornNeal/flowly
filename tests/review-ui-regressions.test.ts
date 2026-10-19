import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import sharp from 'sharp';
import { createServer } from '../apps/api/src/server.js';
import { openChromium } from '../packages/capture/src/renderer.js';

// Rebuild from this checkout before starting the API's static server. Browser
// assertions therefore cannot pass against a stale or integrated-main bundle.
before(async()=>{await build({configFile:'apps/web/vite.config.ts',configLoader:'native',logLevel:'error'});});

async function fixture() {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-review-ui-'));
 const api=await createServer({root});
 const apiBase=await api.listen({host:'127.0.0.1',port:0});
 const browser=await openChromium(true);
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 page.setDefaultTimeout(8000);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const operation=async(name:string,payload:Record<string,unknown>)=>{
  const response=await api.inject({method:'POST',url:'/api/operations/'+name,payload,headers:{host:'127.0.0.1'}});
  assert.equal(response.statusCode,200,response.body);return response.json().result;
 };
 const project=await operation('project.create',{name:'Reviewer regressions',platform:'web'});
 await page.addInitScript(id=>localStorage.setItem('flowly-project',id),project.id);
 const start=async()=>{
  await page.goto(apiBase);
  await page.getByRole('button',{name:/Task Board/}).first().click();
 };
 const tasks=async()=> (await api.inject({url:'/api/snapshot/'+project.id,headers:{host:'127.0.0.1'}})).json().result.tasks;
 return {page,operation,project,start,tasks,api,errors,close:async()=>{
  await browser.close();await api.close();fs.rmSync(root,{recursive:true,force:true});
 }};
}

for(const images of [true,false])test(`FLY-0044: lost ${images?'image':'text-only'} create response retains retry identity through rejected input`,async()=>{
 const f=await fixture();
 try{
  const {page}=f;await f.start();
  await page.getByRole('button',{name:'New task',exact:true}).click();
  const composer=page.locator('dialog.task-composer');
  await composer.getByLabel('Title (required)').fill('Retried card');
  if(images){
   const buffer=await sharp({create:{width:4,height:4,channels:3,background:'red'}}).png().toBuffer();
   await composer.locator('input[type=file]').setInputFiles({name:'accepted.png',mimeType:'image/png',buffer});
  }
  const keys:string[]=[];
  let loseResponse=true;
  await page.route(images?'**/api/tasks/with-attachments':'**/api/operations/task.batch',async route=>{
   const body=route.request().postDataBuffer()!.toString();
   keys.push(JSON.parse(images?body.match(/\r\n\r\n(\{[^\r\n]+\})/)![1]!:body).idempotencyKey);
   const response=await route.fetch();
   assert.equal(response.ok(),true);
   if(loseResponse){loseResponse=false;await route.abort('failed');}
   else await route.fulfill({response});
  });
  await composer.getByRole('button',{name:'Create task',exact:true}).click();
  await composer.getByRole('alert').waitFor();
  assert.equal((await f.tasks()).length,1,'The first request committed before the response was lost');
  await composer.locator('input[type=file]').setInputFiles({name:'rejected.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});
  await composer.getByText(/rejected.svg:/).waitFor();
  await composer.locator('input[type=file]').setInputFiles([]);
  await composer.getByLabel('Title (required)').fill(' Retried card ');
  await composer.getByRole('button',{name:'Create task',exact:true}).click();
  await composer.waitFor({state:'detached'});
  assert.equal(keys.length,2);assert.equal(keys[1],keys[0]);
  const tasks=await f.tasks();assert.equal(tasks.length,1,'Retry replays the committed card');
  const detail=(await f.api.inject({url:'/api/tasks/'+tasks[0].id,headers:{host:'127.0.0.1'}})).json().result;
  assert.equal(detail.attachments.length,images?1:0);
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('FLY-0044: Board quick-create retries a lost committed response exactly once',async()=>{
 const f=await fixture();
 try{
  const {page}=f;await f.start();
  await page.getByPlaceholder('New task title',{exact:true}).fill('Quick retry');
  await page.getByPlaceholder('Optional description',{exact:true}).fill('Retained description');
  const keys:string[]=[];let loseResponse=true;
  await page.route('**/api/operations/task.batch',async route=>{
   keys.push(route.request().postDataJSON().idempotencyKey);
   const response=await route.fetch();assert.equal(response.ok(),true);
   if(loseResponse){loseResponse=false;await route.abort('failed');}else await route.fulfill({response});
  });
  await page.getByRole('button',{name:'Create',exact:true}).click();
  await page.getByRole('alert').waitFor();
  assert.equal((await f.tasks()).length,1);
  assert.equal(await page.getByPlaceholder('New task title',{exact:true}).inputValue(),'Quick retry');
  await page.getByPlaceholder('New task title',{exact:true}).fill(' Quick retry ');
  await page.getByRole('button',{name:'Create',exact:true}).click();
  await page.waitForFunction(()=>!(document.getElementById('new-task-title') as HTMLInputElement).value);
  assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
  const tasks=await f.tasks();assert.equal(tasks.length,1);assert.equal(tasks[0].description,'Retained description');
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('FLY-0044: add-image replay survives unsupported selection; accepted alt text changes rotate the key',async()=>{
 const f=await fixture();
 try{
  const {page}=f;
  const task=await f.operation('task.create',{projectId:f.project.id,title:'Existing card'});
  await f.start();await page.locator('.board-task').filter({hasText:'Existing card'}).click();
  await page.getByRole('button',{name:'Add images',exact:true}).click();
  const composer=page.locator('dialog.task-composer');
  const buffer=await sharp({create:{width:4,height:4,channels:3,background:'blue'}}).png().toBuffer();
  await composer.locator('input[type=file]').setInputFiles({name:'accepted.png',mimeType:'image/png',buffer});
  const keys:string[]=[];let attempt=0;
  await page.route(`**/api/tasks/${task.id}/attachments`,async route=>{
   const body=route.request().postDataBuffer()!.toString();
   keys.push(JSON.parse(body.match(/\r\n\r\n(\{[^\r\n]+\})/)![1]!).idempotencyKey);
   attempt++;
   // First attempt never reaches the server; edit the accepted payload before retry.
   if(attempt===1){await route.abort('failed');return;}
   const response=await route.fetch();assert.equal(response.ok(),true);
   if(attempt===2)await route.abort('failed');else await route.fulfill({response});
  });
  await composer.getByRole('button',{name:'Add images',exact:true}).click();
  await composer.getByRole('alert').waitFor();
  await composer.getByLabel('Alt text for accepted.png').fill('Accepted change');
  await composer.getByRole('button',{name:'Add images',exact:true}).click();
  await composer.getByRole('button',{name:'Add images',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('dialog.task-composer fieldset:disabled'));
  await composer.locator('input[type=file]').setInputFiles({name:'invalid.gif',mimeType:'image/gif',buffer:Buffer.from('GIF')});
  await composer.getByText(/invalid.gif:/).waitFor();
  await composer.getByRole('button',{name:'Add images',exact:true}).click();
  await composer.waitFor({state:'detached'});
  assert.notEqual(keys[1],keys[0]);assert.equal(keys[2],keys[1]);
  const detail=(await f.api.inject({url:'/api/tasks/'+task.id,headers:{host:'127.0.0.1'}})).json().result;
  assert.equal(detail.attachments.length,1);assert.equal(detail.attachments[0].altText,'Accepted change');
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('FLY-0027: delayed B detail cannot edit or save retained A fields',async()=>{
 const f=await fixture();let release=()=>{};
 try{
  const {page}=f;
  const a=await f.operation('task.create',{projectId:f.project.id,title:'Task A',description:'Description A',acceptanceCriteria:'Criteria A',verificationStep:'Verify A'});
  const b=await f.operation('task.create',{projectId:f.project.id,title:'Task B',description:'Description B',acceptanceCriteria:'Criteria B',verificationStep:'Verify B'});
  await f.start();await page.locator('.board-task').filter({hasText:'Task A'}).click();
  const modal=page.locator('.task-inspector');
  await modal.getByRole('button',{name:'Edit',exact:true}).click();
  assert.equal(await modal.getByRole('textbox',{name:'Title',exact:true}).inputValue(),'Task A');
  await modal.getByRole('button',{name:'Cancel',exact:true}).click();
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/api/tasks/${b.id}`,async route=>{await gate;await route.continue();});
  const requested=page.waitForRequest(`**/api/tasks/${b.id}`);
  const boardOrder=await page.locator('.board-task').allTextContents();
  await modal.getByRole('button',{name:boardOrder[0]!.includes('Task A')?'Next task':'Previous task',exact:true}).click();await requested;
  assert.equal(await modal.getByRole('heading',{name:'Task B',exact:true}).isVisible(),true);
  const edit=modal.getByRole('button',{name:'Edit',exact:true});
  assert.equal(await edit.isDisabled(),true,'Exact B detail must be loaded before Edit');
  assert.equal(await modal.getByRole('button',{name:'Save changes',exact:true}).count(),0);
  release();await edit.click();
  for(const [label,expected] of [['Title','Task B'],['Description (Markdown)','Description B'],['Acceptance criteria (Markdown)','Criteria B'],['Verification steps (Markdown)','Verify B']]){
   assert.equal(await modal.getByRole('textbox',{name:label,exact:true}).inputValue(),expected);
  }
  await modal.getByRole('textbox',{name:'Title',exact:true}).fill('Task B edited');
  await modal.getByRole('button',{name:'Save changes',exact:true}).click();
  await modal.getByRole('heading',{name:'Task B edited',exact:true}).waitFor();
  const tasks=await f.tasks();
  assert.equal(tasks.find((task:{id:string})=>task.id===a.id).title,'Task A');
  const saved=tasks.find((task:{id:string})=>task.id===b.id);
  assert.equal(saved.description,'Description B');assert.equal(saved.acceptanceCriteria,'Criteria B');assert.equal(saved.verificationStep,'Verify B');
  assert.deepEqual(f.errors,[]);
 }finally{release();await f.close();}
});

for(const linked of [false,true])test(`FLY-0039: native discard confirmation restores focus when opening ${linked?'linked Bug':'child'} details`,async()=>{
 const f=await fixture();let release=()=>{};
 try{
  const {page}=f;
  const parent=await f.operation('task.create',{projectId:f.project.id,title:'Focus parent'});
  let target;
  if(linked){
   // Normal workflow operations on isolated fixtures; no forced Done or QA waiver.
   await f.operation('task.tests',{id:parent.id,passed:true,evidence:'Isolated browser fixture setup'});
   await f.operation('task.transition',{id:parent.id,to:'ready-for-review'});
   await f.operation('task.review',{id:parent.id,verdict:'approve',reason:'Isolated browser fixture setup'});
   await f.operation('task.transition',{id:parent.id,to:'done'});
   target=await f.operation('task.post-done-bug',{id:parent.id,title:'Linked focus bug',description:'Fixture defect'});
  }else target=await f.operation('task.subtask',{projectId:f.project.id,parentId:parent.id,title:'Focus child'});
  await f.start();await page.locator('.board-task').filter({hasText:'Focus parent'}).click();
  const modal=page.locator('.task-inspector');
  assert.equal(await modal.getByRole('tab').count(),4);
  await modal.getByRole('tab',{name:'Work',exact:true}).click();
  if(linked){
   await modal.getByRole('tab',{name:'QA & Review',exact:true}).click();
   await modal.locator('summary').filter({hasText:'Bug threads'}).click();
   await modal.getByPlaceholder('New post-Done defect').fill('Unsaved linked draft');
  }else{
   await modal.getByText('Alternatives & decision',{exact:false}).click();
   await modal.getByRole('textbox',{name:'Requirements',exact:true}).fill('Unsaved work draft');
  }
  const link=modal.getByRole('button').filter({hasText:target.displayId});
  page.once('dialog',dialog=>void dialog.dismiss());await link.click();
  assert.equal(await modal.getByRole('heading',{name:'Focus parent',exact:true}).isVisible(),true);
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/api/tasks/${target.id}`,async route=>{await gate;await route.continue();});
  page.once('dialog',dialog=>void dialog.accept());await link.click();
  await modal.getByRole('heading',{name:target.title,exact:true}).waitFor();
  await page.waitForFunction(()=>document.activeElement===document.getElementById('inspector-panel-0'),{},{timeout:2000});
  release();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll<HTMLButtonElement>('.task-inspector button')).some(button=>button.textContent==='Edit'&&!button.disabled));
  assert.equal(await modal.getByRole('tabpanel',{name:'Overview',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Tab');
  assert.equal(await modal.evaluate(el=>el.contains(document.activeElement)),true,'Keyboard remains inside the new task modal');
  // Real themed select remains exposed after the focus transition.
  assert.equal(await modal.getByRole('combobox',{name:'Change task lane'}).isVisible(),true);
  assert.deepEqual(f.errors,[]);
 }finally{release();await f.close();}
});
