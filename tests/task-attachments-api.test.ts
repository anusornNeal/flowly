import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createServer } from '../apps/api/src/server.js';
import { TASK_ATTACHMENT_LIMITS } from '../packages/core/src/taskAttachments.js';

const headers={host:'127.0.0.1:3210','x-flowly-actor':'api-agent','x-flowly-channel':'cli'};
function form(input:unknown,files:Array<{bytes:Buffer;name?:string;mime?:string}>,first=true){
 const boundary='ATTACHMENT_TEST',parts:Buffer[]=[];
 const field=Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="input"\r\n\r\n'+JSON.stringify(input)+'\r\n');
 if(first)parts.push(field);
 for(const file of files){
  parts.push(Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="files"; filename="'+(file.name||'image.png')+'"\r\nContent-Type: '+(file.mime||'image/png')+'\r\n\r\n'),file.bytes,Buffer.from('\r\n'));
 }
 if(!first)parts.push(field);
 parts.push(Buffer.from('--'+boundary+'--\r\n'));
 return {payload:Buffer.concat(parts),headers:{...headers,'content-type':'multipart/form-data; boundary='+boundary}};
}
test('canonical typed multipart routes, restart, safe file responses, task detail and removal contract',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-attachments-http-'));
 let api=await createServer({root});
 const operation=async(name:string,payload:unknown)=>api.inject({method:'POST',url:'/api/operations/'+name,headers,payload:payload as object});
 try {
  const projectId=(await operation('project.create',{name:'Attachments'})).json().result.id as string;
  const bytes=await sharp({create:{width:16,height:9,channels:3,background:'red'}}).png().toBuffer();
  const input={task:{projectId,title:'First image'},idempotencyKey:'http-create',altTexts:['First reference']};
  const body=form(input,[{bytes}]);
  const created=await api.inject({method:'POST',url:'/api/tasks/with-attachments',...body});
  assert.equal(created.statusCode,201,created.body);
  const result=created.json().result,id=result.task.id as string,attachment=result.attachments[0];
  assert.equal(attachment.altText,'First reference');assert.equal(result.replayed,false);
  assert.equal((await api.inject({method:'POST',url:'/api/tasks/with-attachments',...body})).json().result.replayed,true);
  const reversed=form({idempotencyKey:'http-create',task:{title:'First image',projectId},altTexts:['First reference']},[{bytes}]);
  assert.equal((await api.inject({method:'POST',url:'/api/tasks/with-attachments',...reversed})).statusCode,200,'Object property order does not change request identity');
  await api.close();api=await createServer({root});
  const list=await api.inject({url:'/api/tasks/'+id+'/attachments?projectId='+projectId,headers});
  assert.deepEqual(list.json().result,result.attachments);
  const detail=await api.inject({url:'/api/tasks/'+id,headers});assert.deepEqual(detail.json().result.attachments,result.attachments);
  assert.deepEqual((await operation('task.detail',{id})).json().result.attachments,result.attachments);
  assert.deepEqual((await operation('task.context',{id})).json().result.attachments,result.attachments);
  for(const url of [attachment.fileUrl,attachment.thumbnailUrl]){
   const file=await api.inject({url,headers});assert.equal(file.statusCode,200);
   assert.equal(file.headers['x-content-type-options'],'nosniff');assert.equal(file.headers['cache-control'],'no-store');
   assert.equal(file.headers['cross-origin-resource-policy'],'same-origin');
   assert.match(String(file.headers['content-security-policy']),/sandbox/);
   assert.match(String(file.headers['content-disposition']),/^inline;/);
   assert.equal((await sharp(file.rawPayload).metadata()).format,url.includes('/thumbnail')?'webp':'png');
  }
  const add=form({projectId,idempotencyKey:'http-add'},[{bytes}]);
  const added=await api.inject({method:'POST',url:'/api/tasks/'+id+'/attachments',...add});assert.equal(added.statusCode,201,added.body);
  assert.equal((await api.inject({method:'POST',url:'/api/tasks/'+id+'/attachments',...add})).statusCode,200);
  assert.deepEqual((await operation('task.attachment.list',{id,projectId})).json().result.length,2);
  const deleted=await api.inject({method:'DELETE',url:'/api/task-attachments/'+attachment.id+'?projectId='+projectId,headers});
  assert.equal(deleted.statusCode,200);assert.equal(deleted.json().result.removed,true);assert.ok(deleted.json().result.attachment.deletedAt);
  assert.equal((await api.inject({url:attachment.fileUrl,headers})).statusCode,410);
  assert.equal((await api.inject({method:'DELETE',url:'/api/task-attachments/'+attachment.id+'?projectId='+projectId,headers})).json().result.removed,false);
  const history=(await operation('task.history',{projectId,id})).json().result;
  const audit=history.find((e:any)=>e.action==='task.attachment.add');assert.equal(audit.actor,'api-agent');assert.equal(audit.channel,'cli');
  assert.equal((await operation('screenshot.list',{projectId})).json().result.length,0);
  assert.equal((await operation('qa.list',{projectId})).json().result.length,0);
 }finally{await api.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('multipart security failures persist nothing; project checks precede decoding, Done blocks writes',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-attachments-security-')),api=await createServer({root});
 const op=async(name:string,payload:object)=>api.inject({method:'POST',url:'/api/operations/'+name,headers,payload});
 try {
  const projectId=(await op('project.create',{name:'Security'})).json().result.id as string;
  const other=(await op('project.create',{name:'Other'})).json().result.id as string;
  const task=(await op('task.create',{projectId,title:'Existing',risk:{localScope:true,reversible:true,expectedOutcome:true,acceptanceCriteria:true,verificationStep:true}})).json().result;
  const bytes=await sharp({create:{width:8,height:8,channels:3,background:'red'}}).png().toBuffer();
  const input={task:{projectId,title:'Invalid'},idempotencyKey:'security'};
  const cases:Array<{body:ReturnType<typeof form>;code:string;status:number}>=[
   {body:form(input,[{bytes:Buffer.from('<html>fake</html>')}]),code:'UNSUPPORTED_IMAGE',status:400},
   {body:form(input,[{bytes,mime:'image/jpeg'}]),code:'IMAGE_MIME_MISMATCH',status:400},
   {body:form(input,[{bytes,name:'image.svg'}]),code:'IMAGE_MIME_MISMATCH',status:400},
   {body:form(input,[{bytes:bytes.subarray(0,36)}]),code:'INVALID_IMAGE',status:400},
   {body:form(input,[{bytes}],false),code:'INVALID_ATTACHMENT_INPUT',status:400},
   {body:form({...input,altTexts:[]},[{bytes}]),code:'INVALID_ATTACHMENT_INPUT',status:400},
   {body:form(input,[]),code:'IMAGE_REQUIRED',status:400},
   {body:form(input,Array(11).fill({bytes})),code:'ATTACHMENT_LIMIT',status:409},
   {body:form(input,[{bytes:Buffer.alloc(TASK_ATTACHMENT_LIMITS.maxBytes+1)}]),code:'IMAGE_TOO_LARGE',status:413},
  ];
  for(const entry of cases){
   const response=await api.inject({method:'POST',url:'/api/tasks/with-attachments',...entry.body});
   assert.equal(response.statusCode,entry.status,response.body);assert.equal(response.json().code,entry.code,response.body);
  }
  assert.equal((await op('task.list',{projectId})).json().result.length,1);
  const mismatch=await api.inject({method:'POST',url:'/api/tasks/'+task.id+'/attachments',...form({projectId:other,idempotencyKey:'mismatch'},[{bytes:Buffer.from('bad')}])});
  assert.equal(mismatch.statusCode,409);assert.equal(mismatch.json().code,'PROJECT_MISMATCH');
  const pathAttack=await op('task.attachment.add',{id:task.id,projectId,idempotencyKey:'path',files:['C:/Windows/win.ini']});
  assert.equal(pathAttack.json().code,'MULTIPART_REQUIRED');
  assert.equal((await op('task.create-with-attachments',{task:{projectId,title:'Path'},files:['README.md'],idempotencyKey:'path'})).json().code,'MULTIPART_REQUIRED');
  const added=await api.inject({method:'POST',url:'/api/tasks/'+task.id+'/attachments',...form({projectId,idempotencyKey:'valid'},[{bytes}])});
  const attachment=added.json().result.attachments[0];
  assert.equal((await api.inject({url:'/api/task-attachments/'+attachment.id+'/file?projectId='+other,headers})).json().code,'PROJECT_MISMATCH');
  assert.equal((await api.inject({method:'DELETE',url:'/api/task-attachments/'+attachment.id+'?projectId='+other,headers})).json().code,'PROJECT_MISMATCH');
  assert.equal((await api.inject({url:'/api/task-attachments/'+attachment.id+'/file',headers})).json().code,'INVALID_ID');
  assert.equal((await api.inject({url:'/api/tasks/not-an-id/attachments?projectId='+projectId,headers})).json().code,'INVALID_ID');
  assert.equal((await api.inject({url:attachment.fileUrl,headers:{...headers,origin:'https://evil.example'}})).statusCode,403);
  await op('task.tests',{id:task.id,passed:true,evidence:'test setup'});
  const done=await op('task.transition',{id:task.id,to:'done'});assert.equal(done.statusCode,200,done.body);
  const locked=await api.inject({method:'POST',url:'/api/tasks/'+task.id+'/attachments',...form({projectId,idempotencyKey:'locked'},[{bytes}])});
  assert.equal(locked.json().code,'DONE_IS_TERMINAL');
  assert.equal((await api.inject({method:'DELETE',url:'/api/task-attachments/'+attachment.id+'?projectId='+projectId,headers})).json().code,'DONE_IS_TERMINAL');
 }finally{await api.close();fs.rmSync(root,{recursive:true,force:true});}
});

// Valid JPEG comment segments let us test the inclusive transport boundary with
// real decoded image bytes, rather than a header-only oversize mock.
function paddedJpeg(jpeg:Buffer,size:number):Buffer {
 const segments:Buffer[]=[jpeg.subarray(0,2)];let remaining=size-jpeg.length;
 while(remaining){let length=Math.min(remaining,65_537);if(remaining-length>0&&remaining-length<4)length-=4;
  const segment=Buffer.alloc(length);segment[0]=255;segment[1]=254;segment.writeUInt16BE(length-2,2);segments.push(segment);remaining-=length;
 }
 segments.push(jpeg.subarray(2));return Buffer.concat(segments);
}
test('exact 25 MiB valid JPEG accepted, next byte rejected; sanitized output is small',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-attachments-boundary-')),api=await createServer({root});
 try {
  const project=(await api.inject({method:'POST',url:'/api/operations/project.create',headers,payload:{name:'Boundary'}})).json().result;
  const jpeg=await sharp({create:{width:2,height:2,channels:3,background:'red'}}).jpeg().toBuffer();
  const bytes=paddedJpeg(jpeg,TASK_ATTACHMENT_LIMITS.maxBytes);
  const response=await api.inject({method:'POST',url:'/api/tasks/with-attachments',...form({task:{projectId:project.id,title:'Boundary'},idempotencyKey:'boundary'},[{bytes,name:'image.jpg',mime:'image/jpeg'}])});
  assert.equal(response.statusCode,201,response.body);assert.ok(response.json().result.attachments[0].sizeBytes<1024);
 }finally{await api.close();fs.rmSync(root,{recursive:true,force:true});}
});
