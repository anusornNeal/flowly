import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import sharp from 'sharp';
import {FlowlyApp} from '../packages/core/src/app.js';

const actor={actor:'replay-review-fixture',channel:'cli' as const};
function cli(root:string,operation:string,input:object){
 const result=spawnSync(process.execPath,[path.resolve('bin/flowly.cjs'),operation,'--input=-'],{
  cwd:process.cwd(),env:{...process.env,FLOWLY_DATA_DIR:root},input:JSON.stringify(input),
  encoding:'utf8',windowsHide:true,timeout:18000
 });
 assert.ifError(result.error);
 const envelope=JSON.parse(result.stdout||result.stderr);
 return {exit:result.status,envelope};
}
test('FLY-0043 CLI child create exact replay is safe after parent Done; new mutation is denied',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-cli-child-replay-'));
 const app=new FlowlyApp(root);
 try{
  const projectId=app.tasks.createProject({name:'Child replay'} ,actor).id;
  const risk={localScope:true,reversible:true,expectedOutcome:true,acceptanceCriteria:true,verificationStep:true};
  const parent=app.tasks.createTask({projectId,title:'Parent',risk},actor);
  const file=path.join(root,'reference.png');
  fs.writeFileSync(file,await sharp({create:{width:8,height:8,channels:3,background:'red'}}).png().toBuffer());
  const payload={task:{projectId,parentId:parent.id,title:'Existing child'},files:[file],idempotencyKey:'child-first'};
  const first=cli(root,'task.create-with-attachments',payload);
  assert.equal(first.exit,0,JSON.stringify(first.envelope));
  assert.equal(first.envelope.ok,true);
  const childId=first.envelope.result.task.id;
  app.tasks.setTests(parent.id,true,'Disposable acceptance evidence',actor);
  app.tasks.transition(parent.id,{to:'done',forceDone:true,reason:'Explicit test fixture parent completion with unfinished child'},actor);
  const before=app.tasks.listTasks(projectId).length;
  const retry=cli(root,'task.create-with-attachments',payload);
  assert.equal(retry.exit,0,JSON.stringify(retry.envelope));
  assert.equal(retry.envelope.ok,true);
  assert.equal(retry.envelope.result.task.id,childId);
  assert.equal(retry.envelope.result.replayed,true);
  assert.equal(app.tasks.listTasks(projectId).length,before);
  const newRequest=cli(root,'task.create-with-attachments',{...payload,idempotencyKey:'different-child'});
  assert.equal(newRequest.envelope.code,'DONE_IS_TERMINAL',JSON.stringify(newRequest.envelope));
  assert.equal(app.tasks.listTasks(projectId).length,before);
 }finally{await app.close();fs.rmSync(root,{recursive:true,force:true});}
});
