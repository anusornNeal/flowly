import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { LocalStore } from '../../db/src/store.js';
import type { Actor, BugThread, Comparison, QaCase, Screenshot, TaskRecord, Preview, StorageTotals } from './models.js';
import { DomainError, now, requireText } from './models.js';
import type { Tasks } from './tasks.js';
import type { Previews } from './previews.js';

const MAX_EXTERNAL_BYTES=25*1024*1024;
const MIME:Record<string,string>={png:'image/png',jpeg:'image/jpeg',webp:'image/webp'};
const EXT:Record<string,string>={png:'png',jpeg:'jpg',webp:'webp'};
const mutexes=new Map<string,Promise<void>>();
export type Intake = {
 source:'manual'|'browser'|'external'; data:Buffer; projectId?:string; taskId?:string;
 screenId?:string; stateId?:string; caseId?:string; sourceId?:string; captureId?:string;
};
export class Images {
 readonly dir:string;
 constructor(private store:LocalStore,private tasks:Tasks,private previews:Previews) {
  this.dir=path.join(store.root,'images');fs.mkdirSync(this.dir,{recursive:true});
 }
 token():string {
  let token=this.store.setting('access_token');
  if(!token){token=randomBytes(32).toString('hex');this.store.setSetting('access_token',token);}
  return token;
 }
 authorize(token:unknown):boolean {
  const expected=Buffer.from(this.token(),'utf8'),actual=Buffer.from(typeof token==='string'?token:'','utf8');
  return expected.length===actual.length && timingSafeEqual(expected,actual);
 }
 regenerateToken(confirm:boolean,actor:Actor){
  if(confirm!==true)throw new DomainError('CONFIRM_REQUIRED','Token regeneration requires explicit confirmation');
  const previous=this.token(),next=randomBytes(32).toString('hex');
  this.store.transaction(()=>{
   this.store.setSetting('access_token',next);
   this.store.audit({projectId:'system',action:'settings.token.regenerate',actor:requireText(actor.actor,'actor'),channel:actor.channel,
    evidence:{previousRevoked:true,newTokenNeverLogged:true}});
  });
  return {regenerated:next!==previous,token:next};
 }
 list(projectId?:string,includeDeleted=false){
  const items=this.store.list<Screenshot>('screenshot',projectId?{projectId}:undefined);
  return includeDeleted?items:items.filter(v=>v.status==='active');
 }
 screenshot(id:string){
  const result=this.store.get<Screenshot>('screenshot',id);
  if(!result)throw new DomainError('NOT_FOUND','Screenshot not found',404);
  return result;
 }
 inbox(projectId?:string){return this.list(undefined).filter(s=>!s.taskId&&(!projectId||s.projectId===projectId));}
 private findDuplicate(sourceId:string,captureId:string){
  const key=this.store.captureKey(sourceId,captureId);
  if(key)return this.store.get<Screenshot>('screenshot',key);
  return this.store.list<Screenshot>('screenshot').find(s=>s.source==='external'&&s.sourceId===sourceId&&s.captureId===captureId);
 }
 async ingest(input:Intake,actor:Actor):Promise<{screenshot:Screenshot;duplicate:boolean;comparison?:Comparison}>{
  if(input.source==='external'&&input.data.byteLength>MAX_EXTERNAL_BYTES)
   throw new DomainError('IMAGE_TOO_LARGE','External screenshots must be at most 25 MB',413);
  if(input.source==='external'&&input.captureId&&!input.sourceId)
   throw new DomainError('SOURCE_ID_REQUIRED','sourceId required when captureId provided');
  if(input.sourceId && (input.sourceId.length>160 || !input.sourceId.trim()))throw new DomainError('INVALID_SOURCE_ID','Invalid sender sourceId');
  if(input.captureId && (input.captureId.length>160 || !input.captureId.trim()))throw new DomainError('INVALID_CAPTURE_ID','Invalid captureId');
  const captureKey=input.source==='external'&&input.sourceId&&input.captureId?
   input.sourceId+'\u0000'+input.captureId:undefined;
  if(!captureKey)return this.accept(input,actor);
  const previous=mutexes.get(captureKey);
  let release=()=>{};
  const current=new Promise<void>(resolve=>{release=resolve;});
  mutexes.set(captureKey,current);
  if(previous)await previous;
  try {
   const known=this.findDuplicate(input.sourceId!,input.captureId!);
   if(known)return {screenshot:known,duplicate:true};
   return await this.accept(input,actor);
  }finally{
   if(mutexes.get(captureKey)===current)mutexes.delete(captureKey);
   release();
  }
 }
 private async accept(input:Intake,actor:Actor):Promise<{screenshot:Screenshot;duplicate:boolean;comparison?:Comparison}> {
  if(!Buffer.isBuffer(input.data)||input.data.length===0)throw new DomainError('INVALID_IMAGE','Missing binary image data');
  if(input.source==='external'&&input.data.length>MAX_EXTERNAL_BYTES)
   throw new DomainError('IMAGE_TOO_LARGE','External screenshot exceeds 25 MB',413);
  let info:sharp.Metadata;
  try {
   const image=sharp(input.data,{failOn:'error',limitInputPixels:40000000});
   info=await image.metadata();
   if(!info.format||!MIME[info.format]||!info.width||!info.height)throw Error('Not PNG, JPEG or WebP');
   await image.raw().toBuffer();
  }catch{throw new DomainError('INVALID_IMAGE','Binary must be a decodable PNG, JPEG or WebP',415);}
  const id='img_'+randomUUID(),extension=EXT[info.format!]!,created=now();
  const originalPath=path.join(this.dir,id+'.'+extension),thumbnailPath=path.join(this.dir,id+'.thumb.webp');
  const sha256=createHash('sha256').update(input.data).digest('hex');
  try{
   const thumbnail=await sharp(input.data).resize({width:320,withoutEnlargement:true}).webp({quality:72}).toBuffer();
   fs.writeFileSync(originalPath,input.data,{flag:'wx'});fs.writeFileSync(thumbnailPath,thumbnail,{flag:'wx'});
   let projectId=input.projectId||'unassigned';
   if(input.taskId){const task=this.store.get<TaskRecord>('task',input.taskId);
    if(task&&(!input.projectId||input.projectId===task.projectId))projectId=task.projectId;}
   // Unknown targets remain in an Unassigned Inbox. No case/QA verdict is inferred.
   const shot:Screenshot={id,projectId,source:input.source,mime:MIME[info.format!]!,bytes:input.data.byteLength,
    sha256,originalPath,thumbnailPath,sourceId:input.sourceId,captureId:input.captureId,
    status:'active',createdAt:created};
   let duplicateId:string|undefined;
   this.store.transaction(()=>{
    if(input.source==='external'&&input.sourceId&&input.captureId){
     const claimed=this.store.claimCaptureKey(input.sourceId,input.captureId,id);
     if(!claimed.claimed){duplicateId=claimed.id;return;}
    }
    this.store.put('screenshot',shot);
    this.store.audit({projectId,action:'screenshot.ingest',actor:actor.actor,channel:actor.channel,
     evidence:{screenshotId:id,source:input.source,bytes:shot.bytes,sourceId:input.sourceId,captureId:input.captureId}});
   });
   if(duplicateId){
    for(const file of [originalPath,thumbnailPath])try{fs.unlinkSync(file);}catch{}
    const existing=this.screenshot(duplicateId);
    return {screenshot:existing,duplicate:true};
   }
   if(input.taskId&&input.screenId&&(!input.projectId||input.projectId===this.store.get<TaskRecord>('task',input.taskId)?.projectId)){
    try {
     const {screenshot,comparison}=this.assign(id,{taskId:input.taskId,screenId:input.screenId,stateId:input.stateId,caseId:input.caseId},actor);
     return {screenshot,duplicate:false,comparison};
    }catch(error){
     if(error instanceof DomainError){
      this.store.audit({projectId,action:'screenshot.inbox',actor:actor.actor,channel:actor.channel,
       evidence:{screenshotId:id,reason:error.code}});
     }else throw error;
    }
   }
   return {screenshot:shot,duplicate:false};
  }catch(error){
   // Only roll back files for ingest/storage failure before a persisted receipt exists.
   if(!this.store.get<Screenshot>('screenshot',id)){
    for(const p of [originalPath,thumbnailPath]){try{fs.unlinkSync(p);}catch{}}
   }
   throw error;
  }
 }
 assign(id:string,input:{taskId:string;screenId:string;stateId?:string;caseId?:string},actor:Actor){
  const shot=this.screenshot(id);
  if(shot.status==='deleted')throw new DomainError('IMAGE_DELETED','Deleted screenshot cannot be restored');
  const task=this.tasks.task(input.taskId);
  if(shot.projectId!=='unassigned'&&shot.projectId!==task.projectId)
   throw new DomainError('PROJECT_MISMATCH','Screenshot and Task must belong to the same project',409);
  const candidateCases=this.previews.cases({taskId:task.id}).filter(c=>c.screenId===input.screenId&&
   (!input.stateId||c.stateId===input.stateId)&&(!input.caseId||c.id===input.caseId));
  if(candidateCases.length!==1)throw new DomainError('CASE_NOT_UNIQUE',
   candidateCases.length?'Select a specific QA Case for this screen':'No Approved Preview QA Case matches Task and Screen',409,
   {matches:candidateCases.map(c=>c.id)});
  const c=candidateCases[0]!,existing=this.store.get<Comparison>('comparison',c.comparisonId||'');
  const t=now();
  const linked:Screenshot={...shot,projectId:task.projectId,taskId:task.id,screenId:c.screenId,caseId:c.id};
  const cmp:Comparison={id:'cmp_'+randomUUID(),projectId:task.projectId,taskId:task.id,screenshotId:id,
   qaCaseId:c.id,revisionId:c.revisionId,status:'awaiting-verdict',createdAt:t};
  const newCase:QaCase={...c,evidenceId:id,comparisonId:cmp.id,verdict:undefined,verdictReason:undefined,
   verdictAt:undefined,verdictBy:undefined,updatedAt:t};
  this.store.transaction(()=>{
   this.store.put('screenshot',linked);this.store.put('comparison',cmp);this.store.put('qa',newCase);
   this.store.audit({projectId:task.projectId,taskId:task.id,action:'screenshot.assign',actor:actor.actor,channel:actor.channel,
    evidence:{screenshotId:id,comparisonId:cmp.id,caseId:c.id,previousVerdict:c.verdict,previousComparisonId:existing?.id}});
  });
  return {screenshot:linked,comparison:cmp,case:newCase};
 }
 original(id:string,thumbnail=false):{mime:string;bytes:Buffer}{
  const s=this.screenshot(id);
  if(s.status==='deleted')throw new DomainError('IMAGE_DELETED','Deleted image has no viewable original',410);
  const file=thumbnail?s.thumbnailPath:s.originalPath;
  if(!file||!fs.existsSync(file))throw new DomainError('IMAGE_UNAVAILABLE','Original image not available',404);
  return {mime:thumbnail?'image/webp':s.mime,bytes:fs.readFileSync(file)};
 }
 storage():StorageTotals{
  const files=this.list(undefined).filter(s=>s.status==='active');
  let originals=0,thumbnails=0,bytes=0;
  for(const s of files)for(const [name,file] of [['original',s.originalPath],['thumbnail',s.thumbnailPath]] as const){
   if(file&&fs.existsSync(file)){const length=fs.statSync(file).size;bytes+=length;
    if(name==='original')originals+=length;else thumbnails+=length;}
  }
  return {originals,thumbnails,bytes};
 }
 cleanup(ids:string[],actor:Actor){
  if(!Array.isArray(ids)||!ids.length)throw new DomainError('EMPTY_SELECTION','Select originals to clean up');
  const success:string[]=[],skipped:Array<{id:string;reason:string;references:string[]}>=[];
  for(const id of new Set(ids)){
   const shot=this.store.get<Screenshot>('screenshot',id);
   if(!shot||shot.status==='deleted'){skipped.push({id,reason:'NOT_ACTIVE',references:[]});continue;}
   const references:string[]=this.store.protectedEvidenceReferences(id);
   for(const qa of this.store.list<QaCase>('qa')){
    if(qa.evidenceId===id&&(qa.verdict==='PASS'||qa.verdict==='FAIL'))references.push('QA '+qa.id+' '+qa.verdict);
   }
   for(const bug of this.store.list<BugThread>('bug')){
    if(bug.occurrences.some(o=>o.evidenceId===id))references.push('Bug '+bug.id+' '+bug.status);
   }
   if(references.length){skipped.push({id,reason:'PROTECTED_BY_QA_OR_BUG',references});continue;}
   const deleted:Screenshot={...shot,status:'deleted',deletedAt:now(),originalPath:undefined,thumbnailPath:undefined};
   this.store.transaction(()=>{
    this.store.put('screenshot',deleted);
    this.store.audit({projectId:shot.projectId,taskId:shot.taskId,action:'screenshot.cleanup',actor:actor.actor,channel:actor.channel,
     evidence:{screenshotId:id,deletedAt:deleted.deletedAt,tombstone:true}});
   });
   for(const file of [shot.originalPath,shot.thumbnailPath])if(file){try{fs.unlinkSync(file);}catch{}}
   success.push(id);
  }
  return {deleted:success.length,skipped:skipped.length,success,protectedOrSkipped:skipped};
 }
}
