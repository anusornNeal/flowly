import fastify, { type FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import { FlowlyApp, execute, capabilities } from '../../../packages/core/src/app.js';
import { DomainError } from '../../../packages/core/src/models.js';
import type { Actor, Screenshot } from '../../../packages/core/src/models.js';

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
export async function createServer(options:{root?:string}={}){
 const domain=new FlowlyApp(options.root);
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
 server.get('/api/capabilities',async()=>({ok:true,result:capabilities()}));
 server.get('/api/projects',async()=>({ok:true,result:domain.tasks.listProjects()}));
 server.get('/api/snapshot/:projectId',async(request)=>({ok:true,result:domain.snapshot(params<{projectId:string}>(request).projectId)}));
 server.get('/api/tasks',async(request)=>{
  const q=request.query as {projectId?:string};
  return {ok:true,result:q.projectId?domain.tasks.listTasks(q.projectId):[]};
 });
 server.get('/api/tasks/:id',async(request)=>({ok:true,result:domain.tasks.taskDetail(params<{id:string}>(request).id)}));
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
  if(op==='settings.token.reveal')reply.header('Cache-Control','no-store');
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
 server.addHook('onClose',async()=>{await domain.close();});
 return server;
}
