import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import Database from 'better-sqlite3';
import { FlowlyApp } from '../packages/core/src/app.js';
import { DomainError } from '../packages/core/src/models.js';
import { TASK_ATTACHMENT_LIMITS, type AttachmentImage } from '../packages/core/src/taskAttachments.js';

const actor={actor:'attachment-test',channel:'cli' as const};
const code=(expected:string)=>(error:unknown)=>error instanceof DomainError&&error.code===expected;
async function image(format:'png'|'jpeg'|'webp'='png'):Promise<AttachmentImage>{
 return {name:'reference.'+(format==='jpeg'?'jpg':format),mime:'image/'+format,
  data:await sharp({create:{width:12,height:8,channels:3,background:'#123456'}}).toFormat(format).toBuffer()};
}
async function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-attachments-'));
 const app=new FlowlyApp(root),projectId=app.tasks.createProject({name:'Attachments'},actor).id;
 return {root,app,projectId,close:async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true});}};
}
test('atomic multi-image create persists sanitized bytes and thumbnails after restart; independent task/subtask/bug attachments',async()=>{
 const f=await fixture();let restarted:FlowlyApp|undefined;
 try {
  const jpeg=await image('jpeg');jpeg.data=await sharp(jpeg.data).withMetadata({orientation:6}).jpeg().toBuffer();
  const result=await f.app.attachments.create({task:{projectId:f.projectId,title:'Requirements'},idempotencyKey:'create'},
   [await image(),jpeg,await image('webp')],actor);
  assert.equal(result.attachments.length,3);
  assert.deepEqual(result.attachments.map(a=>a.sortOrder),[0,1,2]);
  assert.equal(f.app.tasks.taskDetail(result.task.id).attachments.length,3);
  for(const attachment of result.attachments){
   const file=f.app.attachments.file(attachment.id,f.projectId),meta=await sharp(file.bytes).metadata();
   assert.equal(meta.exif,undefined);assert.equal(meta.orientation,undefined);
   assert.equal(meta.width,attachment.width);assert.equal(meta.height,attachment.height);
   assert.equal(file.bytes.length,attachment.sizeBytes);
   assert.equal(createHash('sha256').update(file.bytes).digest('hex'),attachment.sha256);
   assert.equal((await sharp(f.app.attachments.file(attachment.id,f.projectId,true).bytes).metadata()).format,'webp');
   assert.match(attachment.fileUrl,/^\/api\/task-attachments\/att_[a-f0-9-]+\/file\?projectId=proj_/);
   assert.equal('path' in attachment,false);
  }
  assert.equal(result.attachments[1]!.width,8);assert.equal(result.attachments[1]!.height,12);
  const child=await f.app.attachments.create({task:{projectId:f.projectId,parentId:result.task.id,title:'Child'},idempotencyKey:'child'},[await image()],actor);
  const bug=await f.app.attachments.create({task:{projectId:f.projectId,type:'bug',title:'Bug'},idempotencyKey:'bug'},[await image()],actor);
  assert.equal(f.app.attachments.list(child.task.id,f.projectId).length,1);
  assert.equal(bug.task.type,'bug');assert.equal(f.app.images.list().length,0);
  assert.equal(f.app.previews.cases({projectId:f.projectId}).length,0);
  assert.equal(f.app.store.list('comparison').length,0);
  restarted=new FlowlyApp(f.root);
  assert.deepEqual(restarted.attachments.list(result.task.id,f.projectId),result.attachments);
  assert.deepEqual(restarted.attachments.file(result.attachments[0]!.id,f.projectId).bytes,f.app.attachments.file(result.attachments[0]!.id,f.projectId).bytes);
  assert.equal(restarted.tasks.activity(f.projectId,result.task.id).filter(e=>e.action==='task.attachment.add').length,3);
 }finally{await restarted?.close();await f.close();}
});
test('failed decode and storage/audit failures roll back task, parent, bytes, sequence and retry receipt',async()=>{
 const f=await fixture();
 try {
  const parent=f.app.tasks.createTask({projectId:f.projectId,title:'Parent'},actor);
  const request={task:{projectId:f.projectId,parentId:parent.id,title:'Child'},idempotencyKey:'rollback'};
  const valid=await image(),corrupt={...valid,data:Buffer.concat([valid.data.subarray(0,33),valid.data.subarray(-12)])};
  await assert.rejects(f.app.attachments.create(request,[valid,corrupt],actor),code('INVALID_IMAGE'));
  const put=f.app.store.putAttachmentFile.bind(f.app.store);let writes=0;
  f.app.store.putAttachmentFile=(...args)=>{put(...args);if(++writes===2)throw Error('storage failure');};
  await assert.rejects(f.app.attachments.create(request,[valid,valid],actor),/storage failure/);
  f.app.store.putAttachmentFile=put;
  assert.equal(f.app.tasks.listTasks(f.projectId).length,1);
  assert.deepEqual(f.app.tasks.task(parent.id).childIds,[]);
  assert.equal(f.app.store.list('taskAttachment').length,0);
  assert.equal(f.app.store.setting('sequence:task'),'1');
  const db=new Database(path.join(f.root,'flowly.db'));
  try{assert.equal((db.prepare('SELECT count(*) AS n FROM task_attachment_files').get() as {n:number}).n,0);}finally{db.close();}
  const success=await f.app.attachments.create(request,[valid,valid],actor);
  assert.equal(success.task.displayId,'FLY-0002');
  const audit=f.app.store.audit.bind(f.app.store);
  f.app.store.audit=()=>{throw Error('audit failed');};
  assert.throws(()=>f.app.attachments.remove(success.attachments[0]!.id,f.projectId,actor),/audit failed/);
  f.app.store.audit=audit;
  assert.equal(f.app.attachments.list(success.task.id,f.projectId).length,2);
  assert.ok(f.app.attachments.file(success.attachments[0]!.id,f.projectId).bytes.length);
 }finally{await f.close();}
});
test('idempotent concurrent creates/adds, key conflicts, quota races and removal tombstones',async()=>{
 const f=await fixture();
 try {
  const img=await image(),request={task:{projectId:f.projectId,title:'Concurrent'},idempotencyKey:'same'};
  const [a,b]=await Promise.all([f.app.attachments.create(request,[img],actor),f.app.attachments.create(request,[img],actor)]);
  assert.equal(a.task.id,b.task.id);assert.deepEqual([a.replayed,b.replayed].sort(),[false,true]);
  assert.equal(f.app.tasks.listTasks(f.projectId).length,1);
  await assert.rejects(f.app.attachments.create({...request,task:{...request.task,title:'Changed'}},[img],actor),code('IDEMPOTENCY_CONFLICT'));
  const add={projectId:f.projectId,idempotencyKey:'add'};
  const [c,d]=await Promise.all([f.app.attachments.add(a.task.id,add,[img],actor),f.app.attachments.add(a.task.id,add,[img],actor)]);
  assert.equal(c.attachments[0]!.id,d.attachments[0]!.id);
  assert.equal(f.app.attachments.list(a.task.id,f.projectId).length,2);
  await f.app.attachments.add(a.task.id,{...add,idempotencyKey:'fill'},Array(7).fill(img),actor);
  const results=await Promise.allSettled(['race-1','race-2'].map(idempotencyKey=>f.app.attachments.add(a.task.id,{...add,idempotencyKey},[img],actor)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(f.app.attachments.list(a.task.id,f.projectId).length,10);
  assert.ok(results.some(r=>r.status==='rejected'&&code('ATTACHMENT_LIMIT')(r.reason)));
  const id=c.attachments[0]!.id;
  assert.equal(f.app.attachments.remove(id,f.projectId,actor).removed,true);
  assert.equal(f.app.attachments.remove(id,f.projectId,actor).removed,false);
  assert.throws(()=>f.app.attachments.file(id,f.projectId),code('ATTACHMENT_DELETED'));
  assert.equal(f.app.store.attachmentFile(id),undefined);
  const replay=await f.app.attachments.add(a.task.id,add,[img],actor);
  assert.equal(replay.replayed,true);assert.equal(f.app.attachments.list(a.task.id,f.projectId).length,9);
  assert.equal(f.app.tasks.activity(f.projectId,a.task.id).filter(e=>e.action==='task.attachment.remove').length,1);
  assert.equal(JSON.stringify(f.app.tasks.activity(f.projectId)).includes('"type":"Buffer"'),false);
 }finally{await f.close();}
});
test('ownership, Done immutability, substantive evidence gates, malformed IDs and missing files',async()=>{
 const f=await fixture();
 try {
  const result=await f.app.attachments.create({task:{projectId:f.projectId,title:'Scope'},idempotencyKey:'scope'},[await image()],actor);
  const id=result.attachments[0]!.id,other=f.app.tasks.createProject({name:'Other'},actor).id;
  for(const action of [()=>f.app.attachments.list(result.task.id,other),()=>f.app.attachments.file(id,other),()=>f.app.attachments.remove(id,other,actor)])
   assert.throws(action,code('PROJECT_MISMATCH'));
  await assert.rejects(f.app.attachments.add(result.task.id,{projectId:other,idempotencyKey:'other'},[await image()],actor),code('PROJECT_MISMATCH'));
  assert.throws(()=>f.app.attachments.file('../../settings',f.projectId),code('INVALID_ID'));
  assert.throws(()=>f.app.attachments.list(result.task.id,''),code('INVALID_ID'));
  assert.throws(()=>f.app.attachments.file('att_00000000-0000-0000-0000-000000000000',f.projectId),code('NOT_FOUND'));
  f.app.tasks.setTests(result.task.id,true,'Prior tests',actor);
  f.app.store.put('task',{...f.app.tasks.task(result.task.id),reviewApproved:true});
  await f.app.attachments.add(result.task.id,{projectId:f.projectId,idempotencyKey:'invalidate'},[await image()],actor);
  assert.equal(f.app.tasks.task(result.task.id).testsPassed,false);assert.equal(f.app.tasks.task(result.task.id).reviewApproved,false);
  f.app.store.put('task',{...f.app.tasks.task(result.task.id),status:'done'});
  await assert.rejects(f.app.attachments.add(result.task.id,{projectId:f.projectId,idempotencyKey:'done'},[await image()],actor),code('DONE_IS_TERMINAL'));
  assert.throws(()=>f.app.attachments.remove(id,f.projectId,actor),code('DONE_IS_TERMINAL'));
  assert.equal(f.app.attachments.list(result.task.id,f.projectId).length,2);
  f.app.store.removeAttachmentFile(id);
  assert.throws(()=>f.app.attachments.file(id,f.projectId),code('ATTACHMENT_FILE_MISSING'));
 }finally{await f.close();}
});
test('magic, declared MIME, extension, corruption, trailing payload, quota and pixel safeguards',async()=>{
 const f=await fixture();
 try {
  const img=await image(),base={task:{projectId:f.projectId,title:'Invalid'},idempotencyKey:'invalid'};
  const invalid:Array<[AttachmentImage,string]>=[
   [{...img,data:Buffer.from('<svg onload="alert(1)"/>')},'UNSUPPORTED_IMAGE'],
   [{...img,mime:'image/jpeg'},'IMAGE_MIME_MISMATCH'],[{...img,name:'reference.svg'},'IMAGE_MIME_MISMATCH'],
   [{...img,data:img.data.subarray(0,40)},'INVALID_IMAGE'],[{...img,data:Buffer.concat([img.data,Buffer.from('<script>evil()</script>')])},'INVALID_IMAGE'],
   [{...img,data:Buffer.alloc(TASK_ATTACHMENT_LIMITS.maxBytes+1)},'IMAGE_TOO_LARGE'],
  ];
  for(const [input,expected] of invalid)await assert.rejects(f.app.attachments.create(base,[input],actor),code(expected));
  const wide={...img,data:await sharp({create:{width:16_385,height:1,channels:3,background:'red'}}).png().toBuffer()};
  await assert.rejects(f.app.attachments.create(base,[wide],actor),code('IMAGE_DIMENSIONS'));
  const bomb=Buffer.from(img.data);bomb.writeUInt32BE(1_000_000,16);bomb.writeUInt32BE(1_000_000,20);
  await assert.rejects(f.app.attachments.create(base,[{...img,data:bomb}],actor),code('INVALID_IMAGE'));
  await assert.rejects(f.app.attachments.create(base,Array(11).fill(img),actor),code('ATTACHMENT_LIMIT'));
  assert.equal(f.app.tasks.listTasks(f.projectId).length,0);
  const safe=await f.app.attachments.create(base,[{...img,name:'../../evil\r\n.png',altText:'Reference'}],actor);
  assert.equal(safe.attachments[0]!.name,'evil__.png');assert.equal(safe.attachments[0]!.altText,'Reference');
 }finally{await f.close();}
});
