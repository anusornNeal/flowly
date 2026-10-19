import fastify, { type FastifyRequest } from 'fastify';
import { createRuntimeAttestation } from './runtimeAttestation.js';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import { FlowlyApp, execute, capabilities } from '../../../packages/core/src/app.js';
import { JobManager } from '../../../packages/core/src/jobs.js';
import { DomainError } from '../../../packages/core/src/models.js';
import type { Actor, Screenshot } from '../../../packages/core/src/models.js';
import { TASK_ATTACHMENT_LIMITS, validateAttachmentTask } from '../../../packages/core/src/taskAttachments.js';
import type { AttachmentImage, AttachmentCreateRequest, AttachmentAddRequest, AttachmentCreateResult, AttachmentAddResult, AttachmentRemoveResult, AttachmentEnvelope } from '../../../packages/core/src/taskAttachments.js';
import type { TaskAttachmentDto } from '../../../packages/core/src/models.js';

const MAX_MANUAL_FILE=100*1024*1024;
const MAX_EXTERNAL_FILE=25*1024*1024;
function localHostname(host:string){
 return ['localhost','127.0.0.1','[::1]','::1'].includes(host);
}
function actor(request:FastifyRequest):Actor {
 const value=request.headers['x-flowly-actor'];
 return {actor:typeof value==='string'&&value.trim()?value.trim().slice(0,100):'local-user',channel:request.headers['x-flowly-channel']==='cli'?'cli':'web'};
}
function params<T extends Record<string,string>>(request:FastifyRequest):T {
 return request.params as T;
}
async function imageForm(request:FastifyRequest,limit:number) {
 const fields:Record<string,string>={};
 let binary:Buffer|undefined;
 try{
  for await(const part of request.parts({limits:{files:1,fields:24,fileSize:limit,fieldSize:8192,parts:26}})){
   if(part.type==='file'){
    if(part.fieldname!=='file')throw new DomainError('FILE_FIELD_REQUIRED','Send image in multipart field named file');
    binary=await part.toBuffer();
   }else if(typeof part.value==='string'){
    fields[part.fieldname]=part.value;
   }
  }
 }catch(error){
  if((error as {code?:string}).code==='FST_REQ_FILE_TOO_LARGE')
   throw new DomainError('IMAGE_TOO_LARGE','Image exceeds upload size limit',413);
  throw error;
 }
 if(!binary)throw new DomainError('IMAGE_REQUIRED','Multipart file image is required');
 return {fields,binary};
}
async function attachmentForm<T extends AttachmentCreateRequest|AttachmentAddRequest>(request:FastifyRequest,validate:(input:T)=>void) {
 let input:T|undefined;
 const images:AttachmentImage[]=[];
 try {
  for await(const part of request.parts({limits:{files:10,fields:1,parts:12,fileSize:TASK_ATTACHMENT_LIMITS.maxBytes+1,fieldSize:128*1024}})){
   if(part.type==='field'){
    if(input||part.fieldname!=='input'||part.valueTruncated||typeof part.value!=='string')
     throw new DomainError('INVALID_ATTACHMENT_INPUT','Send one complete JSON input field before files');
    let value:unknown;
    try{value=JSON.parse(part.value);}catch{throw new DomainError('INVALID_ATTACHMENT_INPUT','input must be valid JSON');}
    if(!value||typeof value!=='object'||Array.isArray(value))throw new DomainError('INVALID_ATTACHMENT_INPUT','input must be an object');
    input=value as T;
    const allowed='task' in input?['task','idempotencyKey','altTexts']:['projectId','idempotencyKey','altTexts'];
    if(Object.keys(input).some(key=>!allowed.includes(key))||typeof input.idempotencyKey!=='string'||!input.idempotencyKey.trim()||input.idempotencyKey.trim().length>180||
     (input.altTexts!==undefined&&(!Array.isArray(input.altTexts)||input.altTexts.some(text=>typeof text!=='string'||text.length>2000))))
     throw new DomainError('INVALID_ATTACHMENT_INPUT','Invalid input fields, altTexts or idempotencyKey');
    validate(input); // Ownership checked before buffering/decoding any image.
   }else {
    if(!input||part.fieldname!=='files')throw new DomainError('INVALID_ATTACHMENT_INPUT','Send JSON input first, then binary files fields');
    const data=await part.toBuffer();
    if(data.length>TASK_ATTACHMENT_LIMITS.maxBytes)throw new DomainError('IMAGE_TOO_LARGE','Image exceeds 25 MiB',413);
    images.push({data,name:part.filename,mime:part.mimetype,altText:input.altTexts?.[images.length]});
   }
  }
 }catch(error){
  const code=(error as {code?:string}).code;
  if(code==='FST_REQ_FILE_TOO_LARGE')throw new DomainError('IMAGE_TOO_LARGE','Image exceeds 25 MiB',413);
  if(code==='FST_FILES_LIMIT')throw new DomainError('ATTACHMENT_LIMIT','At most 10 images per task',409);
  if(code==='FST_FIELDS_LIMIT'||code==='FST_PARTS_LIMIT')throw new DomainError('INVALID_ATTACHMENT_INPUT','Too many multipart fields or files');
  throw error;
 }
 if(!input)throw new DomainError('INVALID_ATTACHMENT_INPUT','JSON input is required');
 if(input.altTexts&&input.altTexts.length!==images.length)throw new DomainError('INVALID_ATTACHMENT_INPUT','altTexts must match files in order');
 return {input,images};
}
export async function createServer(options:{root?:string}={}){
 const domain=new FlowlyApp(options.root);
 const jobs=new JobManager(domain);
 const runtimeAttestation=createRuntimeAttestation();
 const server=fastify({logger:false,bodyLimit:1024*1024});
 await server.register(multipart,{limits:{fileSize:MAX_MANUAL_FILE,files:1,fields:24}});
 server.addHook('onRequest',async(request)=>{
  const host=(request.headers.host||'').split(':')[0]!;
  if(!localHostname(host)){
   // A loopback listener can still receive malicious Host headers from browsers.
   throw new DomainError('LOCAL_ONLY','Flowly accepts localhost hostnames only',403);
  }
  const origin=request.headers.origin;
  if(typeof origin==='string'){
   try{if(!localHostname(new URL(origin).hostname))throw Error('not-local');}
   catch{throw new DomainError('ORIGIN_FORBIDDEN','Nonlocal browser Origin is forbidden',403);}
  }
  if(request.url.startsWith('/api/screenshots/external')){
   const auth=request.headers.authorization;
   const token=(typeof auth==='string'&&auth.startsWith('Bearer ')?auth.slice(7):request.headers['x-flowly-token']);
   if(!domain.images.authorize(token))throw new DomainError('UNAUTHORIZED','Valid Flowly Access Token required',401);
  }
 });
 server.setErrorHandler((error,request,reply)=>{
  const err=error as Error & {statusCode?:number;code?:string};
  if(error instanceof DomainError)
   return reply.code(error.httpStatus).send({ok:false,code:error.code,message:error.message,details:error.details});
  if(err.statusCode===413 || err.code==='FST_REQ_FILE_TOO_LARGE')
   return reply.code(413).send({ok:false,code:'IMAGE_TOO_LARGE',message:'File exceeds allowed size'});
  const status=typeof err.statusCode==='number'&&err.statusCode<500?err.statusCode:500;
  return reply.code(status).send({ok:false,code:status===500?'INTERNAL_ERROR':'INVALID_REQUEST',
   message:status===500?'Flowly could not process the request':err.message.slice(0,180)});
 });
 server.get('/api/health',async()=>({ok:true,name:'flowly',mode:'localhost',version:1}));
 server.get('/api/capabilities',async()=>({...runtimeAttestation(),ok:true,result:capabilities()}));
 server.get('/api/jobs/:id',async(request)=>({ok:true,result:jobs.get(params<{id:string}>(request).id)}));
 server.get('/api/jobs',async(request)=>{const q=request.query as {projectId:string;offset?:string;limit?:string};
  return {ok:true,result:jobs.list(q.projectId,Number(q.offset||0),Number(q.limit||30))};});
 server.post('/api/jobs',async(request)=>{const body=request.body as {projectId:string;operation:string;input:Record<string,unknown>;idempotencyKey?:string};
  return {ok:true,result:jobs.start(body,actor(request))};});
 server.post('/api/jobs/:id/retry',async(request)=>({ok:true,result:jobs.retry(params<{id:string}>(request).id,actor(request))}));
 server.post('/api/jobs/:id/cancel',async(request)=>({ok:true,result:jobs.cancel(params<{id:string}>(request).id,actor(request))}));
 server.get('/api/projects',async()=>({ok:true,result:domain.tasks.listProjects()}));
 server.get('/api/snapshot/:projectId',async(request)=>({ok:true,result:domain.snapshot(params<{projectId:string}>(request).projectId)}));
 server.get('/api/tasks',async(request)=>{
  const q=request.query as {projectId?:string};
  return {ok:true,result:q.projectId?domain.tasks.listTasks(q.projectId):[]};
 });
 server.get('/api/tasks/:id',async(request)=>({ok:true,result:domain.tasks.taskDetail(params<{id:string}>(request).id)}));
 server.post<{Reply:AttachmentEnvelope<AttachmentCreateResult>}>('/api/tasks/with-attachments',async(request,reply)=>{
  const {input,images}=await attachmentForm<AttachmentCreateRequest>(request,input=>{
   const task=validateAttachmentTask(input.task);domain.tasks.project(task.projectId);
   if(task.parentId)domain.attachments.scope(task.parentId,task.projectId,true);
  });
  const result=await domain.attachments.create(input,images,actor(request));
  return reply.code(result.replayed?200:201).send({ok:true,result});
 });
 server.post<{Params:{id:string};Reply:AttachmentEnvelope<AttachmentAddResult>}>('/api/tasks/:id/attachments',async(request,reply)=>{
  const {input,images}=await attachmentForm<AttachmentAddRequest>(request,input=>domain.attachments.scope(request.params.id,input.projectId,true));
  const result=await domain.attachments.add(request.params.id,input,images,actor(request));
  return reply.code(result.replayed?200:201).send({ok:true,result});
 });
 server.get<{Params:{id:string};Querystring:{projectId:string};Reply:AttachmentEnvelope<TaskAttachmentDto[]>}>('/api/tasks/:id/attachments',async(request)=>
  ({ok:true,result:domain.attachments.list(request.params.id,request.query.projectId)}));
 server.delete<{Params:{id:string};Querystring:{projectId:string};Reply:AttachmentEnvelope<AttachmentRemoveResult>}>('/api/task-attachments/:id',async(request)=>
  ({ok:true,result:domain.attachments.remove(request.params.id,request.query.projectId,actor(request))}));
 for(const variant of ['file','thumbnail'] as const){
  server.get<{Params:{id:string};Querystring:{projectId:string}}>('/api/task-attachments/:id/'+variant,async(request,reply)=>{
   const result=domain.attachments.file(request.params.id,request.query.projectId,variant==='thumbnail');
   return reply.type(result.mime).header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff')
    .header('Content-Security-Policy',"default-src 'none'; sandbox")
    .header('Cross-Origin-Resource-Policy','same-origin')
    .header('Content-Disposition',"inline; filename=\"image\"; filename*=UTF-8''"+encodeURIComponent(result.name).replace(/['()*]/g,char=>'%'+char.charCodeAt(0).toString(16)))
    .send(result.bytes);
  });
 }
 server.get('/api/qa/:id/baseline',async(request,reply)=>{
  const bytes=await domain.baseline(params<{id:string}>(request).id);
  return reply.header('Cache-Control','no-store').type('image/png').send(bytes);
 });
 server.get('/api/screenshots/:id/file',async(request,reply)=>{
  const id=params<{id:string}>(request).id,q=request.query as {thumbnail?:string};
  const result=domain.images.original(id,q.thumbnail==='true');
  return reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').type(result.mime).send(result.bytes);
 });
 server.get('/api/screenshots/:id/diff',async(request,reply)=>{
  const result=await domain.compare(params<{id:string}>(request).id,true);
  return reply.header('Cache-Control','no-store').type('image/png').send(result.diff);
 });
 server.post('/api/operations/:name',async(request,reply)=>{
  const op=params<{name:string}>(request).name;
  if(op==='task.create-with-attachments'||op==='task.attachment.add')
   throw new DomainError('MULTIPART_REQUIRED','Use canonical task multipart routes; HTTP never accepts local image paths');
  if(op==='settings.token.reveal')reply.header('Cache-Control','no-store');
  if(op.startsWith('job.')){
   const body=(request.body||{}) as Record<string,any>;
   const caller=actor(request);
   if(op==='job.start')return {ok:true,result:jobs.start({projectId:String(body.projectId),
    operation:String(body.operation),input:body.input||body.payload,idempotencyKey:body.idempotencyKey},caller)};
   if(op==='job.status')return {ok:true,result:jobs.get(String(body.id))};
   if(op==='job.list')return {ok:true,result:jobs.list(String(body.projectId),Number(body.offset||0),Number(body.limit||30))};
   if(op==='job.retry')return {ok:true,result:jobs.retry(String(body.id),caller)};
   if(op==='job.cancel')return {ok:true,result:jobs.cancel(String(body.id),caller)};
   throw new DomainError('UNKNOWN_OPERATION','Unknown job operation',404);
  }
  const body=request.body;
  if(body!==null&&(typeof body!=='object'||Array.isArray(body)))
   throw new DomainError('INVALID_PAYLOAD','JSON object body required');
  return {ok:true,result:await execute(domain,op,(body||{}) as Record<string,unknown>,actor(request))};
 });
 server.post('/api/screenshots/manual',async(request)=>{
  const {fields,binary}=await imageForm(request,MAX_MANUAL_FILE);
  const result=await domain.images.ingest({
   source:'manual',data:binary,projectId:fields.projectId,taskId:fields.taskId,
   screenId:fields.screenId,stateId:fields.stateId,caseId:fields.caseId
  },actor(request));
  return {ok:true,result};
 });
 server.post('/api/screenshots/external',async(request)=>{
  // Authentication ran in onRequest BEFORE decoding binary or checking captureId.
  const {fields,binary}=await imageForm(request,MAX_EXTERNAL_FILE);
  const result=await domain.images.ingest({
   source:'external',data:binary,projectId:fields.projectId,taskId:fields.taskId,
   screenId:fields.screenId,stateId:fields.stateId,caseId:fields.caseId,
   sourceId:fields.sourceId,captureId:fields.captureId
  },{actor:'external:'+String(fields.sourceId||'unknown').slice(0,80),channel:'cli'});
  return {ok:true,result};
 });
 const webDist=path.resolve(process.cwd(),'apps/web/dist');
 if(fs.existsSync(path.join(webDist,'index.html'))){
  server.get('/*',async(request,reply)=>{
   if(request.url.startsWith('/api/'))throw new DomainError('NOT_FOUND','Unknown API endpoint',404);
   const requestPath=decodeURIComponent(request.url.split('?')[0]!);
   const candidate=path.resolve(webDist,'.'+requestPath);
   const file=candidate.startsWith(webDist+path.sep)&&fs.existsSync(candidate)&&fs.statSync(candidate).isFile()?
    candidate:path.join(webDist,'index.html');
   const ext=path.extname(file),mime:Record<string,string>={'.html':'text/html; charset=utf-8',
    '.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml',
    '.png':'image/png','.webp':'image/webp','.ico':'image/x-icon'};
   return reply.type(mime[ext]||'application/octet-stream').send(fs.createReadStream(file));
  });
 }
 server.addHook('onClose',async()=>{await jobs.close();await domain.close();});
 return server;
}
