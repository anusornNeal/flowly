import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../apps/api/src/server.js';
import { FlowlyApp } from '../packages/core/src/app.js';
import type { JobRecord } from '../packages/core/src/models.js';

const who={actor:'job-operator',channel:'cli' as const};
function payload(operation:string,input:Record<string,unknown>,projectId:string,key:string){
 return {projectId,operation,input,idempotencyKey:key};
}
test('Job HTTP/API parity: versioned identity, in-flight state, persisted results, conflicts and retries',{timeout:60000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-job-'));
 const prep=new FlowlyApp(root);
 const project=prep.tasks.createProject({name:'Jobs',platform:'web',baseUrl:'http://127.0.0.1:3210'},who);
 const preview=prep.previews.create({projectId:project.id,name:'QA',html:'<h1>Welcome</h1>',screens:[{
  id:'home',name:'Home',stateId:'default',viewport:{width:390,height:740,device:'mobile'}
 }]},who);
 const revision=prep.previews.saveRevision(preview.id,who);
 await prep.close();
 let server=await createServer({root});
 const headers={host:'127.0.0.1:3210','content-type':'application/json','x-flowly-actor':'agent-7','x-flowly-channel':'cli'};
 const invoke=async(name:string,body:Record<string,unknown>)=>server.inject({method:'POST',url:'/api/operations/'+name,headers,payload:body});
 const wait=async(id:string,expected:string)=>{
  for(let tries=0;tries<100;tries++){
   const item=(await server.inject({url:'/api/jobs/'+id,headers})).json().result as JobRecord;
   if(item.status===expected)return item;
   await new Promise(resolve=>setTimeout(resolve,45));
  }
  throw Error('Timed out waiting for '+id+' status '+expected);
 };
 try{
  const request=payload('preview.quality',{revisionId:revision.id},project.id,'quality-baseline');
  const started=await invoke('job.start',request);
  assert.equal(started.statusCode,200,started.body);
  const job=started.json().result as JobRecord;
  assert.match(job.id,/^job_/);
  const result=await wait(job.id,'succeeded');
  assert.equal(result.progress,100);
  assert.equal(result.attempts,1);
  assert.equal(result.result && typeof result.result==='object',true);
  assert.equal(result.actor.actor,'agent-7');
  assert.equal(result.actor.channel,'cli');
  const replay=await invoke('job.start',request);
  assert.equal(replay.statusCode,200);
  assert.equal(replay.json().result.replayed,true);
  assert.equal(replay.json().result.id,job.id);
  assert.equal(replay.json().result.attempts,1);
  const conflict=await invoke('job.start',{...request,input:{revisionId:'different'}});
  assert.equal(conflict.statusCode,409);
  assert.equal(conflict.json().code,'IDEMPOTENCY_CONFLICT');
  const list=(await invoke('job.list',{projectId:project.id,limit:10})).json().result;
  assert.equal(list.total,1);
  assert.equal(list.items[0].id,job.id);
  const snapshot=(await server.inject({url:'/api/snapshot/'+project.id,headers})).json().result;
  assert.equal(snapshot.jobs.length,1);
  assert.equal(snapshot.jobs[0].status,'succeeded');
  const noRetry=await invoke('job.retry',{id:job.id});
  assert.equal(noRetry.statusCode,409);
  const missingRecipe=await invoke('job.start',payload('recorder.replay',{projectId:project.id,screenId:'missing'},project.id,'replay-1'));
  assert.equal(missingRecipe.statusCode,200);
  const failed=await wait(missingRecipe.json().result.id,'failed');
  assert.equal(failed.error?.code,'RECIPE_NOT_FOUND');
  const retry=await invoke('job.retry',{id:failed.id});
  assert.equal(retry.statusCode,200);
  const twice=await wait(failed.id,'failed');
  assert.equal(twice.attempts,2);
  assert.equal(twice.id,failed.id);
  const audit=(await invoke('activity',{projectId:project.id})).json().result as Array<{action:string;actor:string}>;
  assert.ok(audit.some(e=>e.action==='job.retry'&&e.actor==='agent-7'));
  assert.ok(audit.some(e=>e.action==='job.succeed'));
  assert.ok(audit.some(e=>e.action==='job.fail'));
 }finally{await server.close();}
 // Simulate an unclean prior process by leaving a saved queued job.
 const control=new FlowlyApp(root);
 const orphan:JobRecord={id:'job_interrupted-sim',projectId:project.id,operation:'preview.quality',
  input:{revisionId:revision.id},requestHash:'test',actor:who,status:'running',progress:15,
  attempts:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 control.store.put('job',orphan);
 await control.close();
 server=await createServer({root});
 try{
  const interrupted=(await server.inject({url:'/api/jobs/'+orphan.id,headers})).json().result as JobRecord;
  assert.equal(interrupted.status,'interrupted');
  assert.equal(interrupted.error?.code,'JOB_INTERRUPTED');
  const retried=await server.inject({method:'POST',url:'/api/jobs/'+orphan.id+'/retry',headers,payload:{}});
  assert.equal(retried.statusCode,200);
  const final=await wait(orphan.id,'succeeded');
  assert.equal(final.attempts,2);
 }finally{await server.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:4,retryDelay:200});}
});
