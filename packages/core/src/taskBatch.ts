import { createHash } from 'node:crypto';
import type { Actor } from './models.js';
import { DomainError, requireText } from './models.js';
import type { LocalStore } from '../../db/src/store.js';
import type { Tasks } from './tasks.js';

export type BatchStep={
 operation:'task.create'|'task.update'|'task.transition'|'task.checklist'|'task.tests'|
 'task.review'|'task.bug.create'|'task.bug.resolve'|'task.post-done-bug';
 input:Record<string,any>;
};
export type BatchRequest={
 projectId:string;idempotencyKey?:string;operations:BatchStep[];
};
export function runTaskBatch(store:LocalStore,tasks:Tasks,input:BatchRequest,actor:Actor){
 const projectId=requireText(input.projectId,'project ID');
 tasks.project(projectId);
 if(!Array.isArray(input.operations)||!input.operations.length||input.operations.length>50)
  throw new DomainError('INVALID_BATCH','Batch must contain between 1 and 50 Task operations');
 const hash=createHash('sha256').update(JSON.stringify(input.operations)).digest('hex');
 if(input.idempotencyKey&&input.idempotencyKey.length>180)
  throw new DomainError('INVALID_IDEMPOTENCY_KEY','Idempotency key too long');
 return store.transaction(()=>{
  if(input.idempotencyKey){
   const previous=store.replayOperation(projectId,input.idempotencyKey);
   if(previous){
    if(previous.requestHash!==hash)throw new DomainError('IDEMPOTENCY_CONFLICT','Reused key has different batch payload',409);
    return {replayed:true,results:previous.result as unknown[]};
   }
  }
  const results:unknown[]=[];
  for(const {operation,input:data} of input.operations){
   if(!data||typeof data!=='object'||Array.isArray(data))throw new DomainError('INVALID_BATCH_STEP','Batch step needs an object');
   const id=typeof data.id==='string'?data.id:'';
   const target=operation==='task.bug.resolve'?undefined:id?
    operation==='task.create'?undefined:tasks.task(id):undefined;
   if(target&&target.projectId!==projectId)throw new DomainError('PROJECT_MISMATCH','Cannot mutate a Task outside batch project',409);
   let result:unknown;
   switch(operation){
    case 'task.create':result=tasks.createTask({...data,projectId,title:requireText(data.title,'title')},actor);break;
    case 'task.update':result=tasks.updateTask(id,data,actor);break;
    case 'task.transition':result=tasks.transition(id,data as Parameters<typeof tasks.transition>[1],actor);break;
    case 'task.checklist':result=tasks.checklist(id,data.action,data,actor);break;
    case 'task.tests':result=tasks.setTests(id,Boolean(data.passed),String(data.evidence||''),actor);break;
    case 'task.review':result=tasks.review(id,data as Parameters<typeof tasks.review>[1],actor);break;
    case 'task.bug.create':result=tasks.bugCreate(id,data as Parameters<typeof tasks.bugCreate>[1],actor);break;
    case 'task.bug.resolve':result=tasks.resolveBug(id,requireText(data.reason,'resolution'),actor);break;
    case 'task.post-done-bug':result=tasks.linkedPostDoneBug(id,data as Parameters<typeof tasks.linkedPostDoneBug>[1],actor);break;
    default:throw new DomainError('UNKNOWN_BATCH_OPERATION','Unsupported batched Task operation');
   }
   results.push(result);
  }
  if(input.idempotencyKey)store.saveOperationReplay(projectId,input.idempotencyKey,hash,results);
  return {replayed:false,results};
 });
}
