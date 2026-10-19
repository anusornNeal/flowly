import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { FlowlyApp } from '../packages/core/src/app.js';
import { DomainError } from '../packages/core/src/models.js';
import { createServer } from '../apps/api/src/server.js';

const actor={actor:'review-regression',channel:'cli' as const};
const headers={host:'127.0.0.1:3210'};
const risk={localScope:true,reversible:true,expectedOutcome:true,acceptanceCriteria:true,verificationStep:true};
const code=(expected:string)=>(error:unknown)=>error instanceof DomainError&&error.code===expected;
const png=()=>sharp({create:{width:8,height:6,channels:3,background:'blue'}}).png().toBuffer();
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-review-backend-'));
 const app=new FlowlyApp(root),projectId=app.tasks.createProject({name:'Review regression'},actor).id;
 return {root,app,projectId,close:async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true});}};
}
function cli(root:string,operation:string,input:object){
 const result=spawnSync(process.execPath,[path.resolve('bin/flowly.cjs'),operation,'--input=-'],
  {env:{...process.env,FLOWLY_DATA_DIR:root},input:JSON.stringify(input),encoding:'utf8',windowsHide:true,timeout:15000});
 assert.ifError(result.error);
 return {status:result.status,body:JSON.parse(result.stdout||result.stderr)};
}
function form(input:object,data:Buffer,name='image.png'){
 const boundary='REVIEW_BACKEND';
 return {headers:{...headers,'content-type':'multipart/form-data; boundary='+boundary},payload:Buffer.concat([
  Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="input"\r\n\r\n'+JSON.stringify(input)+'\r\n'),
  Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="files"; filename="'+name+'"\r\nContent-Type: image/png\r\n\r\n'),
  data,Buffer.from('\r\n--'+boundary+'--\r\n')])};
}

test('Done re-reads gates after a competing CLI removal commits before lock acquisition',async()=>{
 const f=fixture();
 try {
  const created=await f.app.attachments.create({task:{projectId:f.projectId,title:'Race',risk,reviewMode:'require-review'},idempotencyKey:'race'},[{data:await png(),name:'image.png'}],actor);
  const id=created.task.id;
  f.app.tasks.setTests(id,true,'Disposable fixture verification',actor);
  f.app.tasks.transition(id,{to:'ready-for-review'},actor);
  f.app.tasks.review(id,{verdict:'approve'},actor);
  // Intercept the outer transaction entry, before SQLite takes its lock. The old
  // implementation had already cached approval here; the fixed one has not read.
  let removed=false;
  for(const method of ['transaction','transactionImmediate'] as const){
   const original=f.app.store[method].bind(f.app.store);
   f.app.store[method]=<T>(fn:()=>T):T=>{
    if(!removed){
     removed=true;
     const result=cli(f.root,'task.attachment.remove',{id:created.attachments[0]!.id,projectId:f.projectId});
     assert.equal(result.status,0,JSON.stringify(result.body));
    }
    return original(fn);
   };
  }
  assert.throws(()=>f.app.tasks.transition(id,{to:'done'},actor),error=>error instanceof DomainError&&['TRANSITION_BLOCKED','DONE_BLOCKED'].includes(error.code));
  assert.equal(removed,true);
  const persisted=f.app.tasks.task(id);
  assert.equal(persisted.status,'ready-for-review');
  assert.equal(persisted.testsPassed,false);assert.equal(persisted.reviewApproved,false);
  assert.equal(f.app.attachments.list(id,f.projectId).length,0);
  assert.equal(f.app.tasks.activity(f.projectId,id).filter(e=>e.to==='done').length,0);
 }finally{await f.close();}
});

test('SQLite IMMEDIATE serializes a real CLI transition behind another process removing evidence', {timeout:20000},async()=>{
 const f=fixture();let worker:ReturnType<typeof spawn>|undefined;
 try {
  const result=await f.app.attachments.create({task:{projectId:f.projectId,title:'Process race',risk},idempotencyKey:'process'},[{data:await png(),name:'image.png'}],actor);
  f.app.tasks.setTests(result.task.id,true,'Disposable fixture verification',actor);
  const script=`import {FlowlyApp} from './packages/core/src/app.ts';
   const app=new FlowlyApp(process.env.FLOWLY_DATA_DIR);
   app.store.transactionImmediate(()=>{
    app.attachments.remove(${JSON.stringify(result.attachments[0]!.id)},${JSON.stringify(f.projectId)},${JSON.stringify(actor)});
    process.stdout.write('locked\\n');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1200);
   });await app.close();`;
  worker=spawn(process.execPath,['--import','tsx','--input-type=module','--eval',script],{cwd:process.cwd(),env:{...process.env,FLOWLY_DATA_DIR:f.root},windowsHide:true});
  const finished=new Promise<void>((resolve,reject)=>{worker!.on('error',reject);worker!.on('exit',status=>status===0?resolve():reject(Error('Removal process exit '+status)));});
  await new Promise<void>((resolve,reject)=>{worker!.stdout!.once('data',()=>resolve());worker!.once('error',reject);worker!.once('exit',status=>{if(status!==0)reject(Error('Removal failed before lock'));});});
  const transition=cli(f.root,'task.transition',{id:result.task.id,to:'done'});
  assert.notEqual(transition.status,0);assert.equal(transition.body.code,'TRANSITION_BLOCKED');
  await finished;
  assert.equal(f.app.tasks.task(result.task.id).testsPassed,false);
  assert.equal(f.app.tasks.task(result.task.id).status,'backlog');
 }finally{if(worker&&worker.exitCode===null)worker.kill();await f.close();}
});

test('transition commit wins before CLI removal, survives restart, and audit failure rolls back',async()=>{
 const f=fixture();let reopened:FlowlyApp|undefined;
 try {
  const result=await f.app.attachments.create({task:{projectId:f.projectId,title:'Commit first',risk},idempotencyKey:'commit'},[{data:await png(),name:'image.png'}],actor);
  f.app.tasks.setTests(result.task.id,true,'Disposable fixture verification',actor);
  const audit=f.app.store.audit.bind(f.app.store);
  f.app.store.audit=()=>{throw Error('Injected audit failure');};
  assert.throws(()=>f.app.tasks.transition(result.task.id,{to:'done'},actor),/Injected audit failure/);
  f.app.store.audit=audit;
  assert.equal(f.app.tasks.task(result.task.id).status,'backlog');
  f.app.tasks.transition(result.task.id,{to:'done'},actor);
  const removed=cli(f.root,'task.attachment.remove',{id:result.attachments[0]!.id,projectId:f.projectId});
  assert.equal(removed.body.code,'DONE_IS_TERMINAL');
  reopened=new FlowlyApp(f.root);
  assert.equal(reopened.tasks.task(result.task.id).status,'done');
  assert.equal(reopened.attachments.list(result.task.id,f.projectId).length,1);
  assert.equal(reopened.tasks.activity(f.projectId,result.task.id).filter(e=>e.to==='done').length,1);
 }finally{await reopened?.close();await f.close();}
});

test('Unicode filename boundary uploads and serves both variants with well-formed labels',async()=>{
 const f=fixture(),api=await createServer({root:f.root});
 try {
  const name='a'.repeat(159)+'😀.png';
  const response=await api.inject({method:'POST',url:'/api/tasks/with-attachments',...form({task:{projectId:f.projectId,title:'Unicode'},idempotencyKey:'unicode'},await png(),name)});
  assert.equal(response.statusCode,201,response.body);
  const attachment=response.json().result.attachments[0];
  assert.equal(attachment.name,'a'.repeat(159)+'😀');
  assert.doesNotThrow(()=>encodeURIComponent(attachment.name));
  for(const url of [attachment.fileUrl,attachment.thumbnailUrl]){
   const file=await api.inject({url,headers});assert.equal(file.statusCode,200,file.body);
   assert.ok((await sharp(file.rawPayload).metadata()).width);
   assert.ok(file.headers['content-disposition']);
  }
  const sanitized=await f.app.attachments.create({task:{projectId:f.projectId,title:'Sanitized'},idempotencyKey:'sanitized'},[{data:await png(),name:'../bad\ud800?.png'}],actor);
  assert.equal(sanitized.attachments[0]!.name,'bad__.png');
 }finally{await api.close();await f.close();}
});

test('exact child create receipt replays through domain and HTTP after parent Done; new writes remain blocked',async()=>{
 const f=fixture();let api:Awaited<ReturnType<typeof createServer>>|undefined;
 try {
  const parent=f.app.tasks.createTask({projectId:f.projectId,title:'Parent',risk},actor);
  const data=await png(),input={task:{projectId:f.projectId,parentId:parent.id,title:'Child',risk},idempotencyKey:'child'};
  const created=await f.app.attachments.create(input,[{data,name:'image.png',mime:'image/png'}],actor);
  for(const id of [created.task.id,parent.id]){
   f.app.tasks.setTests(id,true,'Disposable fixture verification',actor);f.app.tasks.transition(id,{to:'done'},actor);
  }
  const before=f.app.tasks.activity(f.projectId).length;
  assert.deepEqual(await f.app.attachments.create(input,[{data,name:'image.png',mime:'image/png'}],actor),{...created,replayed:true});
  api=await createServer({root:f.root});
  const replay=await api.inject({method:'POST',url:'/api/tasks/with-attachments',...form(input,data)});
  assert.equal(replay.statusCode,200,replay.body);assert.deepEqual(replay.json().result,{...created,replayed:true});
  for(const request of [{...input,idempotencyKey:'new-child'},{...input,task:{...input.task,title:'Changed'}}]){
   const response:Awaited<ReturnType<typeof api.inject>>=await api.inject({method:'POST',url:'/api/tasks/with-attachments',...form(request,data)});
   assert.equal(response.statusCode,409,response.body);
   assert.equal(response.json().code,request.idempotencyKey==='new-child'?'DONE_IS_TERMINAL':'IDEMPOTENCY_CONFLICT');
  }
  const other=f.app.tasks.createProject({name:'Other'},actor).id;
  const wrong=await api.inject({method:'POST',url:'/api/tasks/with-attachments',...form({...input,task:{...input.task,projectId:other}},Buffer.from('invalid'))});
  assert.equal(wrong.json().code,'PROJECT_MISMATCH');
  const forbidden=await api.inject({method:'POST',url:'/api/tasks/with-attachments',...form(input,data),headers:{...form(input,data).headers,origin:'https://evil.example'}});
  assert.equal(forbidden.statusCode,403);
  assert.equal(f.app.tasks.activity(f.projectId).length,before);
  assert.equal(f.app.tasks.listTasks(f.projectId).length,2);
 }finally{await api?.close();await f.close();}
});

function chunk(type:string,data:Buffer){
 const body=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;
 for(const byte of body){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 const header=Buffer.alloc(4),tail=Buffer.alloc(4);header.writeUInt32BE(data.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);
 return Buffer.concat([header,body,tail]);
}
test('APNG animation chunks are rejected even when Sharp reports one page, atomically for create and add',async()=>{
 const f=fixture();
 try {
  const data=await png(),task=f.app.tasks.createTask({projectId:f.projectId,title:'APNG'},actor);
  const before=f.app.tasks.activity(f.projectId).length;
  const fixtures:Array<{type:string;animated:Buffer}>=[];
  for(const type of ['acTL','fcTL','fdAT']){
   const control=Buffer.alloc(type==='acTL'?8:type==='fcTL'?26:4);
   if(type==='acTL'){control.writeUInt32BE(2);}
   if(type==='fcTL'){control.writeUInt32BE(8,4);control.writeUInt32BE(6,8);control.writeUInt16BE(1,20);control.writeUInt16BE(10,22);}
   fixtures.push({type,animated:Buffer.concat([data.subarray(0,33),chunk(type,control),data.subarray(33)])});
  }
  // Complete two-frame APNG, with valid chunk CRCs, sequence numbers and zlib
  // image data. Its default image is also its first animation frame.
  const actl=Buffer.alloc(8);actl.writeUInt32BE(2);
  const frame=(sequence:number)=>{const b=Buffer.alloc(26);b.writeUInt32BE(sequence);b.writeUInt32BE(8,4);b.writeUInt32BE(6,8);b.writeUInt16BE(1,20);b.writeUInt16BE(10,22);return b;};
  const compressed:Buffer[]=[];
  for(let offset=8;offset<data.length;){const size=data.readUInt32BE(offset);if(data.toString('ascii',offset+4,offset+8)==='IDAT')compressed.push(data.subarray(offset+8,offset+8+size));offset+=size+12;}
  const sequence=Buffer.alloc(4);sequence.writeUInt32BE(2);
  fixtures.push({type:'two-frame',animated:Buffer.concat([data.subarray(0,33),chunk('acTL',actl),chunk('fcTL',frame(0)),chunk('IDAT',Buffer.concat(compressed)),chunk('fcTL',frame(1)),chunk('fdAT',Buffer.concat([sequence,...compressed])),data.subarray(-12)])});
  for(const {type,animated} of fixtures){
   assert.equal((await sharp(animated).metadata()).pages??1,1,'Fixture exercises decoder blind spot');
   const images=[{data,name:'static.png'},{data:animated,name:'animated.png'}];
   await assert.rejects(f.app.attachments.create({task:{projectId:f.projectId,title:'Rejected'},idempotencyKey:type},images,actor),error=>code('ANIMATED_IMAGE')(error)&&/Animated PNG/.test((error as Error).message));
   await assert.rejects(f.app.attachments.add(task.id,{projectId:f.projectId,idempotencyKey:type},images,actor),code('ANIMATED_IMAGE'));
   assert.equal(f.app.store.replayOperation(f.projectId,'task-attachments:'+type),undefined);
  }
  assert.equal(f.app.tasks.activity(f.projectId).length,before);
  assert.equal(f.app.tasks.listTasks(f.projectId).length,1);assert.equal(f.app.attachments.list(task.id,f.projectId).length,0);
 }finally{await f.close();}
});
