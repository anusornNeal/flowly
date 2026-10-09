import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { FlowlyApp } from '../packages/core/src/app.js';
import { runTaskBatch } from '../packages/core/src/taskBatch.js';
import { DomainError } from '../packages/core/src/models.js';

const actor={actor:'advanced-tests',channel:'cli' as const};
const workspace=async(fn:(root:string,app:FlowlyApp)=>Promise<void>)=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-advanced-'));
 const app=new FlowlyApp(root);
 try{await fn(root,app);}finally{await app.close();fs.rmSync(root,{recursive:true,force:true});}
};
test('project UI evidence tracks local CSS/React changes and preserves immutable revision snapshot',async()=>{
 await workspace(async(root,app)=>{
  const source=path.join(root,'sample');fs.mkdirSync(path.join(source,'src'),{recursive:true});
  fs.writeFileSync(path.join(source,'src','theme.css'),':root{--primary:#285ddd;font-family:"Inter",Arial;}');
  fs.writeFileSync(path.join(source,'src','App.tsx'),'<div className="brand">Brand</div>');
  const project=app.tasks.createProject({name:'Evidence',platform:'web',sourcePath:source},actor);
  const preview=app.previews.create({projectId:project.id,name:'Example',html:'<h1>Example</h1>',screens:[]},actor);
  const rev=app.previews.saveRevision(preview.id,actor);
  const original=rev.contextSnapshot.contentHash;
  assert.equal(rev.contextSnapshot.sufficiency,'strong');
  assert.equal((rev.contextSnapshot.colors as string[]).includes('#285ddd'),true);
  assert.equal(app.previews.refreshContext(preview.id).changed,false);
  fs.writeFileSync(path.join(source,'src','theme.css'),':root{--primary:#cc0000;font-family:"Inter",Arial;}');
  const fresh=app.previews.refreshContext(preview.id);
  assert.equal(fresh.changed,true);
  assert.equal(fresh.revisions[0]?.changed,true);
  assert.notEqual(fresh.currentContext.contentHash,original);
  assert.equal(app.previews.getRevision(rev.id).contextSnapshot.contentHash,original);
  app.previews.updateContextSnapshot(preview.id,actor);
  assert.equal(app.previews.refreshContext(preview.id).changed,false);
  assert.equal(app.previews.getRevision(rev.id).contextSnapshot.contentHash,original);
 });
});
test('atomic batch rollback and explicit idempotent batch replay with conflict detection',async()=>{
 await workspace(async(_root,app)=>{
  const p=app.tasks.createProject({name:'Batch'},actor);
  const req={projectId:p.id,idempotencyKey:'batch-001',
   operations:[{operation:'task.create' as const,input:{title:'Alpha'}},{operation:'task.create' as const,input:{title:'Beta'}}]};
  const first=runTaskBatch(app.store,app.tasks,req,actor);
  assert.equal(first.replayed,false);
  assert.equal(first.results.length,2);
  const second=runTaskBatch(app.store,app.tasks,req,actor);
  assert.equal(second.replayed,true);
  assert.deepEqual(second.results,JSON.parse(JSON.stringify(first.results)));
  assert.equal(app.tasks.listTasks(p.id).length,2);
  assert.throws(()=>runTaskBatch(app.store,app.tasks,{...req,operations:[{operation:'task.create',input:{title:'Other'}}]},actor),
   (e:unknown)=>e instanceof DomainError&&e.code==='IDEMPOTENCY_CONFLICT');
  assert.throws(()=>runTaskBatch(app.store,app.tasks,{projectId:p.id,idempotencyKey:'batch-rollback',
   operations:[{operation:'task.create',input:{title:'Should rollback'}},{operation:'task.transition',input:{id:'missing',to:'done'}}]},actor),
   (e:unknown)=>e instanceof DomainError);
  assert.equal(app.tasks.listTasks(p.id).length,2);
  assert.equal(app.tasks.activity(p.id).filter(e=>e.action==='task.create').length,2);
 });
});
test('concurrent independent connections share durable external capture key and tombstone',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-race-'));
 const a=new FlowlyApp(root),b=new FlowlyApp(root);
 try{
  const project=a.tasks.createProject({name:'Race'},actor);
  const png=await sharp({create:{width:8,height:8,channels:3,background:'#3466bb'}}).png().toBuffer();
  const request={source:'external' as const,data:png,projectId:project.id,sourceId:'one-sender',captureId:'sample-101'};
  const [first,second]=await Promise.all([a.images.ingest(request,actor),b.images.ingest(request,actor)]);
  assert.equal(first.screenshot.id,second.screenshot.id);
  assert.equal(a.images.list(project.id).length,1);
  assert.equal(b.store.captureKey('one-sender','sample-101'),first.screenshot.id);
  const cleanup=a.images.cleanup([first.screenshot.id],actor);
  assert.equal(cleanup.deleted,1);
  const retry=await b.images.ingest(request,actor);
  assert.equal(retry.screenshot.id,first.screenshot.id);
  assert.equal(retry.screenshot.status,'deleted');
  assert.equal(a.images.list(project.id).length,0);
 }finally{await a.close();await b.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('mismatched project task metadata stays in unassigned inbox without QA mutation',async()=>{
 await workspace(async(_root,app)=>{
  const p=app.tasks.createProject({name:'Origin'},actor);
  const q=app.tasks.createProject({name:'Foreign'},actor);
  const other=app.tasks.createTask({projectId:q.id,title:'Foreign task'},actor);
  const png=await sharp({create:{width:9,height:9,channels:3,background:'#33bb66'}}).png().toBuffer();
  const accepted=await app.images.ingest({source:'external',sourceId:'host',captureId:'mismatch',
   projectId:p.id,taskId:other.id,screenId:'home',data:png},actor);
  assert.equal(accepted.screenshot.taskId,undefined);
  assert.equal(accepted.screenshot.projectId,p.id);
  assert.equal(app.images.inbox(p.id).length,1);
  assert.throws(()=>app.images.assign(accepted.screenshot.id,{taskId:other.id,screenId:'home'},actor),
   (e:unknown)=>e instanceof DomainError&&e.code==='PROJECT_MISMATCH');
 });
});
