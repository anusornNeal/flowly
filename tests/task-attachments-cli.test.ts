import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { FlowlyApp } from '../packages/core/src/app.js';
import { createServer } from '../apps/api/src/server.js';

function invoke(root:string,operation:string,input?:object,flags:string[]=[]):Promise<{exit:number|null;out:any;error:any}>{
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.resolve('bin/flowly.cjs'),operation,...(input?['--input=-']:[]),'--actor=cli-attachments',...flags],
   {cwd:process.cwd(),env:{...process.env,FLOWLY_DATA_DIR:root},windowsHide:true,stdio:['pipe','pipe','pipe']});
  let out='',error='';child.stdout.on('data',data=>out+=data);child.stderr.on('data',data=>error+=data);
  child.on('error',reject);child.on('close',exit=>{
   resolve({exit,out:out?JSON.parse(out):undefined,error:error?JSON.parse(error):undefined});
  });child.stdin.end(input?JSON.stringify(input):'');
 });
}
test('real CLI create-from-files/add/list/remove persists and matches HTTP; discovery, audit and dry-run', {timeout:60000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-attachments-cli-'));
 try {
  const project=await invoke(root,'project.create',{name:'CLI'});assert.equal(project.exit,0);
  const projectId=project.out.result.id as string;
  const imagePath=path.join(root,'reference.png');fs.writeFileSync(imagePath,await sharp({create:{width:8,height:6,channels:3,background:'blue'}}).png().toBuffer());
  const input={task:{projectId,title:'CLI created',type:'bug'},files:[{path:imagePath,altText:'CLI reference'}],idempotencyKey:'cli-create'};
  const [created,concurrent]=await Promise.all([invoke(root,'task.create-with-attachments',input),invoke(root,'task.create-with-attachments',input)]);
  assert.equal(created.exit,0,JSON.stringify(created.error));assert.equal(concurrent.exit,0,JSON.stringify(concurrent.error));
  assert.equal(created.out.result.task.id,concurrent.out.result.task.id);
  assert.deepEqual([created.out.result.replayed,concurrent.out.result.replayed].sort(),[false,true]);
  const task=created.out.result.task,attachment=created.out.result.attachments[0];
  assert.equal(task.type,'bug');assert.equal(attachment.createdBy,'cli-attachments');
  const retry=await invoke(root,'task.create-with-attachments',input);assert.equal(retry.out.result.replayed,true);assert.equal(retry.out.result.task.id,task.id);
  const capabilities=(await invoke(root,'capabilities')).out.result;
  for(const name of ['task.create-with-attachments','task.attachment.add','task.attachment.list','task.attachment.remove']){
   assert.ok(capabilities.operations.includes(name));assert.ok(capabilities.contracts.some((contract:any)=>contract.operation===name));
  }
  const added=await invoke(root,'task.attachment.add',{id:task.id,projectId,idempotencyKey:'cli-add',files:[imagePath]});
  assert.equal(added.exit,0,JSON.stringify(added.error));assert.equal(added.out.result.attachments[0].sortOrder,1);
  const list=await invoke(root,'task.attachment.list',{id:task.id,projectId});assert.equal(list.out.result.length,2);
  const api=await createServer({root});
  try{
   const http=await api.inject({url:'/api/tasks/'+task.id+'/attachments?projectId='+projectId,headers:{host:'127.0.0.1:3210'}});
   assert.deepEqual(http.json().result,list.out.result);
   const file=await api.inject({url:attachment.fileUrl,headers:{host:'127.0.0.1:3210'}});assert.equal(file.statusCode,200);
  }finally{await api.close();}
  const detail=await invoke(root,'task.detail',{id:task.id});assert.deepEqual(detail.out.result.attachments,list.out.result);
  const dry=await invoke(root,'task.attachment.add',{id:task.id,projectId,idempotencyKey:'dry',files:[imagePath]},['--dry-run']);
  assert.equal(dry.exit,2);assert.equal(dry.error.code,'DRY_RUN_UNSUPPORTED');
  const noProject=await invoke(root,'task.attachment.list',{id:task.id});assert.equal(noProject.error.code,'MISSING_PARAMETER');
  const unreadable=await invoke(root,'task.create-with-attachments',{...input,idempotencyKey:'missing',files:[path.join(root,'missing.png')]});
  assert.equal(unreadable.error.code,'ATTACHMENT_FILE_UNREADABLE');
  const removed=await invoke(root,'task.attachment.remove',{id:attachment.id,projectId});assert.equal(removed.exit,0);assert.equal(removed.out.result.removed,true);
  const again=await invoke(root,'task.attachment.remove',{id:attachment.id,projectId});assert.equal(again.out.result.removed,false);
  assert.equal((await invoke(root,'task.attachment.list',{id:task.id,projectId},['--limit=1'])).out.result.total,1);
  const app=new FlowlyApp(root);
  try{
   assert.equal(app.images.list().length,0);
   const audits=app.tasks.activity(projectId,task.id).filter(e=>e.action.startsWith('task.attachment.'));
   assert.equal(audits.length,3);assert.ok(audits.every(e=>e.actor==='cli-attachments'&&e.channel==='cli'));
   assert.equal(app.tasks.listTasks(projectId).length,1,'Failed CLI create must not leave a task');
  }finally{await app.close();}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
