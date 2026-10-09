import { createHash,randomUUID } from 'node:crypto';
import type { FlowlyApp } from './app.js';
import type { Actor, JobRecord } from './models.js';
import { DomainError,now,requireText } from './models.js';
import { execute } from './app.js';

const ASYNC_ALLOWED=['recorder.replay','recorder.capture','preview.quality','screenshot.compare'] as const;
const allowed=new Set<string>(ASYNC_ALLOWED);
export function asyncOperations(){return [...ASYNC_ALLOWED];}
export class JobManager {
 private running=new Map<string,Promise<void>>();
 private tails=new Map<string,Promise<void>>();
 constructor(private app:FlowlyApp){
  // A prior process cannot promise completion. Preserve the ID/evidence and
  // require an explicit retry so a restarted server never duplicates effects.
  for(const job of app.store.list<JobRecord>('job')){
   if(job.status!=='queued'&&job.status!=='running')continue;
   const interrupted:JobRecord={...job,status:'interrupted',finishedAt:now(),updatedAt:now(),
    error:{code:'JOB_INTERRUPTED',message:'Flowly restarted before this job completed. Retry explicitly using its original ID.'}};
   app.store.transaction(()=>{
    app.store.put('job',interrupted);
    app.store.audit({projectId:job.projectId,action:'job.interrupted',actor:'flowly-service',channel:'cli',
     evidence:{jobId:job.id,operation:job.operation}});
   });
  }
 }
 private audit(job:JobRecord,action:string){
  this.app.store.audit({projectId:job.projectId,action,actor:job.actor.actor,channel:job.actor.channel,
   evidence:{jobId:job.id,operation:job.operation,status:job.status,attempts:job.attempts}});
 }
 get(id:string){
  const job=this.app.store.get<JobRecord>('job',id);
  if(!job)throw new DomainError('JOB_NOT_FOUND','Job does not exist',404);
  return job;
 }
 list(projectId:string,offset=0,limit=30){
  this.app.tasks.project(projectId);
  if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)
   throw new DomainError('INVALID_PAGINATION','Job list offset/limit must be valid');
  const all=this.app.store.list<JobRecord>('job',{projectId});
  return {items:all.slice(offset,offset+limit),total:all.length,offset,limit,hasMore:offset+limit<all.length};
 }
 start(input:{projectId:string;operation:string;input:Record<string,unknown>;idempotencyKey?:string},actor:Actor){
  const projectId=requireText(input.projectId,'project ID');
  this.app.tasks.project(projectId);
  const operation=requireText(input.operation,'operation');
  if(!allowed.has(operation))throw new DomainError('ASYNC_OPERATION_UNSUPPORTED','Job cannot perform that operation',409,
   {supported:ASYNC_ALLOWED});
  if(!input.input||typeof input.input!=='object'||Array.isArray(input.input))
   throw new DomainError('INVALID_JOB_INPUT','Job input must be a JSON object');
  const payload=structuredClone(input.input);
  const key=input.idempotencyKey?.trim();
  if(key && key.length>160)throw new DomainError('INVALID_IDEMPOTENCY_KEY','Job key is too long');
  const requestHash=createHash('sha256').update(JSON.stringify({operation,payload})).digest('hex');
  const id=key?'job_'+createHash('sha256').update(projectId+'\0'+key).digest('hex').slice(0,32):'job_'+randomUUID();
  const previous=this.app.store.get<JobRecord>('job',id);
  if(previous){
   if(previous.requestHash!==requestHash)
    throw new DomainError('IDEMPOTENCY_CONFLICT','Job key was reused with a different operation or payload',409);
   return {...previous,replayed:true};
  }
  if(operation==='screenshot.compare'){
   const screenshot=this.app.images.screenshot(requireText(payload.id,'screenshot ID'));
   if(screenshot.projectId!==projectId)throw new DomainError('PROJECT_MISMATCH','Screenshot belongs to a different Project',409);
  }else if(operation==='preview.quality'){
   const revision=this.app.previews.getRevision(requireText(payload.revisionId,'revision ID'));
   if(revision.projectId!==projectId)throw new DomainError('PROJECT_MISMATCH','Revision belongs to a different Project',409);
  }else{
   if(payload.projectId!==projectId)throw new DomainError('PROJECT_MISMATCH','Recorder Project ID does not match Job Project ID',409);
   if(operation==='recorder.capture'){
    const task=this.app.tasks.task(requireText(payload.taskId,'task ID'));
    if(task.projectId!==projectId)throw new DomainError('PROJECT_MISMATCH','Capture Task belongs to a different Project',409);
   }
  }
  const t=now();
  const job:JobRecord={id,projectId,operation,input:payload,requestHash,idempotencyKey:key,
   actor:{actor:requireText(actor.actor,'actor'),channel:actor.channel},
   status:'queued',progress:0,attempts:0,createdAt:t,updatedAt:t};
  this.app.store.transaction(()=>{this.app.store.put('job',job);this.audit(job,'job.create');});
  this.schedule(job.id);
  return job;
 }
 private schedule(id:string){
  const job=this.get(id);
  const preceding=this.tails.get(job.projectId)||Promise.resolve();
  const pending=preceding.catch(()=>{}).then(async()=>{
   if(this.get(id).status==='cancelled')return;
   await this.executeJob(id);
  }).catch(()=>{});
  this.tails.set(job.projectId,pending);
  this.running.set(id,pending);
  void pending.finally(()=>{
   this.running.delete(id);
   if(this.tails.get(job.projectId)===pending)this.tails.delete(job.projectId);
  });
 }
 private async executeJob(id:string){
  const queued=this.get(id);
  if(queued.status!=='queued')return;
  const started:JobRecord={...queued,status:'running',progress:10,attempts:queued.attempts+1,
   error:undefined,startedAt:now(),finishedAt:undefined,updatedAt:now()};
  this.app.store.transaction(()=>{this.app.store.put('job',started);this.audit(started,'job.start');});
  try{
   const result=await execute(this.app,started.operation,started.input,started.actor);
   const completed:JobRecord={...started,status:'succeeded',progress:100,result,updatedAt:now(),finishedAt:now()};
   this.app.store.transaction(()=>{this.app.store.put('job',completed);this.audit(completed,'job.succeed');});
  }catch(error){
   const e=error instanceof DomainError?error:null;
   const failed:JobRecord={...started,status:'failed',progress:100,updatedAt:now(),finishedAt:now(),
    error:{code:e?.code||'JOB_FAILED',message:e?.message||'Job execution failed. Check the target and retry explicitly.'}};
   this.app.store.transaction(()=>{this.app.store.put('job',failed);this.audit(failed,'job.fail');});
  }
 }
 retry(id:string,actor:Actor){
  const job=this.get(id);
  if(job.status!=='failed'&&job.status!=='interrupted')
   throw new DomainError('JOB_NOT_RETRYABLE','Only failed or interrupted jobs may be retried',409);
  const queued:JobRecord={...job,status:'queued',progress:0,result:undefined,error:undefined,updatedAt:now()};
  this.app.store.transaction(()=>{this.app.store.put('job',queued);
   this.app.store.audit({projectId:job.projectId,action:'job.retry',actor:requireText(actor.actor,'actor'),channel:actor.channel,
    evidence:{jobId:job.id,previousStatus:job.status}});});
  this.schedule(id);
  return queued;
 }
 cancel(id:string,actor:Actor){
  const job=this.get(id);
  if(job.status!=='queued')throw new DomainError('JOB_NOT_CANCELLABLE','Only queued jobs may be cancelled safely',409);
  const cancelled:JobRecord={...job,status:'cancelled',progress:100,finishedAt:now(),updatedAt:now()};
  this.app.store.transaction(()=>{this.app.store.put('job',cancelled);
   this.app.store.audit({projectId:job.projectId,action:'job.cancel',actor:requireText(actor.actor,'actor'),channel:actor.channel,
    evidence:{jobId:job.id}});});
  return cancelled;
 }
 async close(){await Promise.all([...this.running.values()]);}
}
