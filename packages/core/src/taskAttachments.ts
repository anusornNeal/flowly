import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { LocalStore } from '../../db/src/store.js';
import type { Actor, TaskAttachment, TaskAttachmentDto, TaskRecord } from './models.js';
import { DomainError, now, requireText } from './models.js';
import type { Tasks } from './tasks.js';

export const TASK_ATTACHMENT_LIMITS={maxBytes:25*1024*1024,maxFiles:10,maxPixels:40_000_000,maxDimension:16_384} as const;
export type AttachmentImage={data:Buffer;name:string;mime?:string;altText?:string};
export type AttachmentFileInput={path:string;name?:string;mime?:string;altText?:string};
export type AttachmentTaskInput=Parameters<Tasks['createTask']>[0];
export type AttachmentCreateRequest={task:AttachmentTaskInput;idempotencyKey:string;altTexts?:string[]};
export type AttachmentAddRequest={projectId:string;idempotencyKey:string;altTexts?:string[]};
export type AttachmentCreateResult={task:TaskRecord;attachments:TaskAttachmentDto[];replayed:boolean};
export type AttachmentAddResult={attachments:TaskAttachmentDto[];replayed:boolean};
export type AttachmentRemoveResult={attachment:TaskAttachment;removed:boolean};
export type AttachmentEnvelope<T>={ok:true;result:T};
// Canonical multipart/file contracts for frontend consumers. Multipart carries
// one JSON `input` field and ordered repeated binary `files` fields.
export interface TaskAttachmentRoutes {
 'POST /api/tasks/with-attachments':{input:AttachmentCreateRequest;result:AttachmentCreateResult};
 'POST /api/tasks/:id/attachments':{input:AttachmentAddRequest;result:AttachmentAddResult};
 'GET /api/tasks/:id/attachments':{query:{projectId:string};result:TaskAttachmentDto[]};
 'GET /api/task-attachments/:id/file':{query:{projectId:string};result:Buffer};
 'GET /api/task-attachments/:id/thumbnail':{query:{projectId:string};result:Buffer};
 'DELETE /api/task-attachments/:id':{query:{projectId:string};result:AttachmentRemoveResult};
}
type Prepared={metadata:Omit<TaskAttachment,'id'|'projectId'|'taskId'|'sortOrder'|'createdAt'|'createdBy'>;image:Buffer;thumbnail:Buffer};
const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
function canonical(value:unknown):unknown {
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
 return value;
}
const mimeByFormat={png:'image/png',jpeg:'image/jpeg',webp:'image/webp'} as const;

function validId(id:unknown,prefix:string):string {
 if(typeof id!=='string'||!new RegExp('^'+prefix+'_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$','i').test(id))
  throw new DomainError('INVALID_ID','Malformed '+prefix+' ID');
 return id;
}
function displayName(value:unknown,format:keyof typeof mimeByFormat):string {
 const name=requireText(value,'attachment name').normalize('NFC').split(/[\\/]/).pop()!
  .replace(/[<>:"|?*\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,'_').replace(/^[. ]+|[. ]+$/g,'').slice(0,160);
 const extensions={png:['png'],jpeg:['jpg','jpeg'],webp:['webp']};
 const extension=name.includes('.')?name.split('.').pop()!.toLowerCase():undefined;
 if(extension&&!extensions[format].includes(extension))throw new DomainError('IMAGE_MIME_MISMATCH','Filename extension does not match decoded image');
 return name||'image.'+(format==='jpeg'?'jpg':format);
}
function magic(bytes:Buffer):keyof typeof mimeByFormat {
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
  if(!bytes.subarray(-12).equals(Buffer.from([0,0,0,0,73,69,78,68,174,66,96,130])))throw new DomainError('INVALID_IMAGE','PNG must end at IEND');
  return 'png';
 }
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255){
  if(bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)throw new DomainError('INVALID_IMAGE','JPEG must end at EOI');
  return 'jpeg';
 }
 if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){
  if(bytes.length<12||bytes.readUInt32LE(4)+8!==bytes.length)throw new DomainError('INVALID_IMAGE','Invalid WebP length');
  return 'webp';
 }
 throw new DomainError('UNSUPPORTED_IMAGE','Only PNG, JPEG and WebP images are supported');
}
async function prepare(input:AttachmentImage):Promise<Prepared> {
 if(!input||!Buffer.isBuffer(input.data)||!input.data.length)throw new DomainError('IMAGE_REQUIRED','Image bytes are required');
 if(input.data.length>TASK_ATTACHMENT_LIMITS.maxBytes)throw new DomainError('IMAGE_TOO_LARGE','Image exceeds 25 MiB',413);
 const format=magic(input.data),mime=mimeByFormat[format];
 if(input.mime!==undefined&&input.mime!==mime)throw new DomainError('IMAGE_MIME_MISMATCH','Declared MIME does not match image bytes');
 const name=displayName(input.name,format);
 if(input.altText!==undefined&&(typeof input.altText!=='string'||input.altText.length>2000))
  throw new DomainError('INVALID_ALT_TEXT','altText must be a string of at most 2000 characters');
 try {
  const options={limitInputPixels:TASK_ATTACHMENT_LIMITS.maxPixels,failOn:'warning' as const};
  const metadata=await sharp(input.data,options).metadata();
  if(metadata.format!==format)throw new DomainError('IMAGE_MIME_MISMATCH','Decoded format does not match magic header');
  if(!metadata.width||!metadata.height||metadata.width>TASK_ATTACHMENT_LIMITS.maxDimension||metadata.height>TASK_ATTACHMENT_LIMITS.maxDimension||
   metadata.width*metadata.height>TASK_ATTACHMENT_LIMITS.maxPixels||(metadata.pages??1)>1)
   throw new DomainError('IMAGE_DIMENSIONS','Image dimensions exceed limits or image is animated');
  // Full decode + re-encode removes metadata and non-image payloads. Orient first
  // so dimensions/thumbnail match what the user sees without retaining EXIF.
  const {data:image,info}=await sharp(input.data,options).rotate().toFormat(format).toBuffer({resolveWithObject:true});
  if(image.length>TASK_ATTACHMENT_LIMITS.maxBytes)throw new DomainError('IMAGE_TOO_LARGE','Sanitized image exceeds 25 MiB',413);
  const thumbnail=await sharp(image,options).resize({width:320,height:320,fit:'inside',withoutEnlargement:true}).webp().toBuffer();
  return {image,thumbnail,metadata:{name,mime,sizeBytes:image.length,width:info.width,height:info.height,sha256:digest(image),...(input.altText===undefined?{}:{altText:input.altText})}};
 }catch(error){
  if(error instanceof DomainError)throw error;
  throw new DomainError('INVALID_IMAGE','Image is corrupt, truncated or exceeds decoded pixel limits');
 }
}
export function taskAttachmentDto(record:TaskAttachment):TaskAttachmentDto {
 const base='/api/task-attachments/'+record.id;
 const query='?projectId='+encodeURIComponent(record.projectId);
 return {...record,fileUrl:base+'/file'+query,thumbnailUrl:base+'/thumbnail'+query};
}
export function validateAttachmentTask(value:unknown):AttachmentTaskInput {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new DomainError('INVALID_ATTACHMENT_INPUT','task must be an object');
 const data=value as Record<string,unknown>;
 const text=['projectId','title','description','parentId','originTaskId','type','priority','reviewMode','acceptanceCriteria','verificationStep'];
 if(Object.keys(data).some(key=>![...text,'risk'].includes(key))||text.some(key=>data[key]!==undefined&&typeof data[key]!=='string')||
  (data.risk!==undefined&&(!data.risk||typeof data.risk!=='object'||Array.isArray(data.risk))))
  throw new DomainError('INVALID_ATTACHMENT_INPUT','Invalid task fields');
 if(data.risk){
  const riskFields=['securityOrPermissions','destructiveData','schemaMigration','publicContract','sharedRuntimeConfig','systemWide','irreversible',
   'localScope','reversible','expectedOutcome','acceptanceCriteria','verificationStep'];
  if(Object.entries(data.risk).some(([key,value])=>!riskFields.includes(key)||typeof value!=='boolean'))
   throw new DomainError('INVALID_ATTACHMENT_INPUT','risk must contain known boolean risk factors');
 }
 if(data.type!==undefined&&!['task','bug'].includes(String(data.type)))throw new DomainError('INVALID_ATTACHMENT_INPUT','Invalid task type');
 requireText(data.title,'title');validId(data.projectId,'proj');
 if(data.parentId!==undefined)validId(data.parentId,'tsk');
 if(data.originTaskId!==undefined)validId(data.originTaskId,'tsk');
 return data as AttachmentTaskInput;
}

export class TaskAttachments {
 constructor(private store:LocalStore,private tasks:Tasks){}
 scope(taskId:string,projectId:string,mutable=false):TaskRecord {
  validId(projectId,'proj');validId(taskId,'tsk');this.tasks.project(projectId);
  const task=this.tasks.task(taskId);
  if(task.projectId!==projectId)throw new DomainError('PROJECT_MISMATCH','Task belongs to a different project',409);
  if(mutable&&task.status==='done')throw new DomainError('DONE_IS_TERMINAL','Completed tasks are immutable',409);
  return task;
 }
 list(taskId:string,projectId:string):TaskAttachmentDto[] {
  this.scope(taskId,projectId);
  return this.store.list<TaskAttachment>('taskAttachment',{taskId,projectId}).filter(a=>!a.deletedAt)
   .sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id)).map(taskAttachmentDto);
 }
 private record(id:string,projectId:string,mutable=false):TaskAttachment {
  validId(projectId,'proj');validId(id,'att');this.tasks.project(projectId);
  const record=this.store.get<TaskAttachment>('taskAttachment',id);
  if(!record)throw new DomainError('NOT_FOUND','Attachment not found',404);
  if(record.projectId!==projectId)throw new DomainError('PROJECT_MISMATCH','Attachment belongs to a different project',409);
  this.scope(record.taskId,projectId,mutable);
  return record;
 }
 file(id:string,projectId:string,thumbnail=false):{bytes:Buffer;mime:string;name:string} {
  const record=this.record(id,projectId);
  if(record.deletedAt)throw new DomainError('ATTACHMENT_DELETED','Attachment was removed',410);
  const bytes=this.store.attachmentFile(id,thumbnail);
  if(!bytes)throw new DomainError('ATTACHMENT_FILE_MISSING','Attachment bytes are unavailable',404);
  return {bytes,mime:thumbnail?'image/webp':record.mime,name:thumbnail?'thumbnail.webp':record.name};
 }
 private key(value:unknown):string {
  if(typeof value!=='string'||!value.trim()||value.trim().length>180)
   throw new DomainError('INVALID_IDEMPOTENCY_KEY','Key must contain 1 to 180 characters');
  const key=value.trim();
  return 'task-attachments:'+key;
 }
 private request(images:AttachmentImage[],operation:string,input:unknown):string {
  if(!Array.isArray(images)||!images.length)throw new DomainError('IMAGE_REQUIRED','At least one image is required');
  if(images.length>TASK_ATTACHMENT_LIMITS.maxFiles)throw new DomainError('ATTACHMENT_LIMIT','At most 10 images per task',409);
  return digest(JSON.stringify(canonical({operation,input,images:images.map(image=>{
   if(!image||!Buffer.isBuffer(image.data))throw new DomainError('IMAGE_REQUIRED','Image bytes required');
   if(image.data.length>TASK_ATTACHMENT_LIMITS.maxBytes)throw new DomainError('IMAGE_TOO_LARGE','Image exceeds 25 MiB',413);
   return {name:image.name,mime:image.mime,altText:image.altText,sha256:digest(image.data)};
  })})));
 }
 private replay<T>(projectId:string,key:string,hash:string):T|undefined {
  const previous=this.store.replayOperation(projectId,key);
  if(previous&&previous.requestHash!==hash)throw new DomainError('IDEMPOTENCY_CONFLICT','Key was already used for a different attachment request',409);
  return previous?.result as T|undefined;
 }
 private insert(task:TaskRecord,prepared:Prepared[],actor:Actor):TaskAttachmentDto[] {
  const active=this.list(task.id,task.projectId);
  if(active.length+prepared.length>TASK_ATTACHMENT_LIMITS.maxFiles)throw new DomainError('ATTACHMENT_LIMIT','At most 10 images per task',409);
  let order=active.reduce((max,item)=>Math.max(max,item.sortOrder),-1)+1;
  const attachments=prepared.map(item=>{
   const record:TaskAttachment={...item.metadata,id:'att_'+randomUUID(),projectId:task.projectId,taskId:task.id,
    sortOrder:order++,createdAt:now(),createdBy:requireText(actor.actor,'actor')};
   this.store.put('taskAttachment',record);
   this.store.putAttachmentFile(record.id,item.image,item.thumbnail);
   this.store.audit({projectId:task.projectId,taskId:task.id,action:'task.attachment.add',...actor,evidence:{attachmentId:record.id,sha256:record.sha256,sizeBytes:record.sizeBytes}});
   return taskAttachmentDto(record);
  });
  this.invalidate(task);
  return attachments;
 }
 private invalidate(task:TaskRecord):void {
  // Requirement evidence changes invalidate previous tests/review/decision, just
  // like editing the task's substantive description; never change QA verdicts.
  const engineering=task.engineering?.decision?{...task.engineering,decision:{...task.engineering.decision,decision:undefined}}:task.engineering;
  this.store.put('task',{...task,testsPassed:false,reviewApproved:false,engineering,updatedAt:now()});
 }
 async create(input:AttachmentCreateRequest,images:AttachmentImage[],actor:Actor):Promise<AttachmentCreateResult> {
  const taskInput=validateAttachmentTask(input?.task),key=this.key(input.idempotencyKey);
  this.tasks.project(taskInput.projectId);
  if(taskInput.parentId)this.scope(taskInput.parentId,taskInput.projectId,true);
  const hash=this.request(images,'create',taskInput);
  const previous=this.replay<AttachmentCreateResult>(taskInput.projectId,key,hash);
  if(previous)return {...previous,replayed:true};
  const prepared:Prepared[]=[];for(const image of images)prepared.push(await prepare(image));
  return this.store.transactionImmediate(()=>{
   const previous=this.replay<AttachmentCreateResult>(taskInput.projectId,key,hash);
   if(previous)return {...previous,replayed:true};
   const task=this.tasks.createTask(taskInput,actor);
   const attachments=this.insert(task,prepared,actor);
   const result={task:this.tasks.task(task.id),attachments,replayed:false};
   this.store.saveOperationReplay(task.projectId,key,hash,result);
   return result;
  });
 }
 async add(taskId:string,input:AttachmentAddRequest,images:AttachmentImage[],actor:Actor):Promise<AttachmentAddResult> {
  this.scope(taskId,input?.projectId,true);
  const key=this.key(input.idempotencyKey),hash=this.request(images,'add',{taskId,projectId:input.projectId});
  const previous=this.replay<AttachmentAddResult>(input.projectId,key,hash);
  if(previous)return {...previous,replayed:true};
  if(this.list(taskId,input.projectId).length+images.length>TASK_ATTACHMENT_LIMITS.maxFiles)throw new DomainError('ATTACHMENT_LIMIT','At most 10 images per task',409);
  const prepared:Prepared[]=[];for(const image of images)prepared.push(await prepare(image));
  return this.store.transactionImmediate(()=>{
   const task=this.scope(taskId,input.projectId,true);
   const previous=this.replay<AttachmentAddResult>(input.projectId,key,hash);
   if(previous)return {...previous,replayed:true};
   const result={attachments:this.insert(task,prepared,actor),replayed:false};
   this.store.saveOperationReplay(input.projectId,key,hash,result);return result;
  });
 }
 remove(id:string,projectId:string,actor:Actor):AttachmentRemoveResult {
  return this.store.transactionImmediate(()=>{
   const record=this.record(id,projectId,true);
   if(record.deletedAt)return {attachment:record,removed:false};
   const deleted={...record,deletedAt:now()};
   this.store.put('taskAttachment',deleted);this.store.removeAttachmentFile(id);
   this.invalidate(this.tasks.task(record.taskId));
   this.store.audit({projectId,taskId:record.taskId,action:'task.attachment.remove',...actor,actor:requireText(actor.actor,'actor'),evidence:{attachmentId:id}});
   return {attachment:deleted,removed:true};
  });
 }
}
