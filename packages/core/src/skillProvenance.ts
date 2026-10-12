import type { LocalStore } from '../../db/src/store.js';
import type { Activity, Actor, TaskRecord } from './models.js';
import { DomainError } from './models.js';
import type { SkillRegistry } from './skillRegistry.js';
import type { SkillReason } from './skillContracts.js';
export type SkillProvenanceInput = {
 projectId: string; taskId?: string; skillId: string; version: string; sha256: string;
 reason: SkillReason; operation: string; sourceActivityId?: string;
 sessionId?: string; commitHash?: string; evidenceIds?: string[];
};
export type SkillTrace = {
 id: string; projectId: string; taskId?: string; at: string; actor: string; channel: string;
 skillId: string; version: string; sha256: string; reason: SkillReason;
 operation: string; sourceActivityId?: string; sessionId?: string;
 commitHash?: string; evidenceIds: string[]; status: 'selected' | 'correlated';
};
const MAX_EVENTS=100;
function field(value:unknown,name:string,max=128):string{
 if(typeof value!=='string'||!value.trim()||value.length>max||value!==value.trim())
  throw new DomainError('INVALID_SKILL_TRACE',name+' is missing or too long');
 return value;
}
function validReason(reason:unknown):reason is SkillReason {
 return typeof reason==='string'&&['AUTHORING','SOURCE_EVIDENCE','DECOMPOSITION','IMPLEMENTATION',
  'BOARD_LOOP','REVIEW','VISUAL_QA','VERIFICATION','BOOTSTRAP','NO_MATCH','AMBIGUOUS','BLOCKED','PROJECT_GUIDANCE'].includes(reason);
}
const normalizeOperation=(op:string):string=>{
 const aliases:Record<string,string>={'task.transition':'transition','task.review':'review.approve',
  'task.tests':'tests.update','engineering.implementation.report':'engineering.implementation.report',
  'engineering.decision.report':'engineering.decision.report'};
 return aliases[op]||op;
};
/**
 * Provenance records what was observed in the authoritative audit trail; it
 * never attests a completion merely because a guidance-selection was recorded.
 */
export class SkillProvenance {
 constructor(private readonly store:LocalStore,private readonly registry:SkillRegistry){}
 record(input:SkillProvenanceInput,actor:Actor):SkillTrace{
  const projectId=field(input.projectId,'projectId'),skillId=field(input.skillId,'skillId'),
    version=field(input.version,'version'),sha256=field(input.sha256,'sha256',64),
    operation=field(input.operation,'operation');
  if(!validReason(input.reason))throw new DomainError('INVALID_SKILL_REASON','Unknown selection reason');
  if(!this.store.get('project',projectId))throw new DomainError('NOT_FOUND','Project not found',404);
  if(input.taskId){
   const task=this.store.get<TaskRecord>('task',input.taskId);
   if(!task || task.projectId!==projectId)
    throw new DomainError('PROJECT_MISMATCH','Task must belong to selected project',409);
  }
  const registered=this.registry.get({projectId,id:skillId,version});
  if(!registered.manifest.enabled||registered.manifest.sha256!==sha256)
   throw new DomainError('SKILL_REVISION_MISMATCH','Skill must be enabled and pinned to an exact hash',409);
  const evidenceIds=input.evidenceIds||[];
  if(!Array.isArray(evidenceIds)||evidenceIds.length>16||evidenceIds.some(v=>typeof v!=='string'||!/^[-_a-zA-Z0-9]{1,100}$/.test(v)))
   throw new DomainError('INVALID_TRACE_EVIDENCE','Only bounded evidence identifiers, not raw payloads');
  const sourceActivityId=input.sourceActivityId;
  if(sourceActivityId && (!/^evt_[a-f0-9-]{30,50}$/.test(sourceActivityId)))
   throw new DomainError('INVALID_ACTIVITY_ID','Activity ID is invalid');
  if(input.commitHash && !/^[0-9a-f]{40}$/.test(input.commitHash))
   throw new DomainError('INVALID_COMMIT_HASH','Use full verified git commit hash');
  if(input.sessionId) field(input.sessionId,'sessionId');
  let linked:Activity|undefined;
  if(sourceActivityId){
   linked=this.store.history(projectId,input.taskId,MAX_EVENTS).find(x=>x.id===sourceActivityId);
   if(!linked || linked.actor!==actor.actor || linked.channel!==actor.channel)
    throw new DomainError('ACTIVITY_NOT_VERIFIED','A source activity by the same actor must already exist',409);
   const expected=normalizeOperation(operation);
   if(linked.action!==expected && !linked.action.startsWith(expected+'.') &&
     !(operation==='task.transition'&&linked.action==='transition'))
    throw new DomainError('ACTIVITY_OPERATION_MISMATCH','Referenced activity does not match reported operation',409);
  }else if(!['guide','skills.route','skills.preflight','next','bootstrap'].includes(operation)){
   throw new DomainError('SOURCE_ACTIVITY_REQUIRED','Write operations require prior authoritative audited activity',409);
  }
  return this.store.transactionImmediate(()=>{
   const activity=this.store.audit({projectId,taskId:input.taskId,actor:actor.actor,channel:actor.channel,
    action:'skill.provenance',evidence:{
      skillId,version,sha256,reason:input.reason,operation,status:linked?'correlated':'selected',
      sourceActivityId,sessionId:input.sessionId,commitHash:input.commitHash,evidenceIds,
    }});
   return this.asTrace(activity);
  });
 }
 list(projectId:string,options:{taskId?:string;limit?:number}={}):SkillTrace[]{
  if(!this.store.get('project',projectId))throw new DomainError('NOT_FOUND','Project not found',404);
  if(options.taskId){
   const task=this.store.get<TaskRecord>('task',options.taskId);
   if(!task||task.projectId!==projectId)throw new DomainError('PROJECT_MISMATCH','Task not in selected project',409);
  }
  const limit=options.limit===undefined?25:options.limit;
  if(!Number.isInteger(limit)||limit<1||limit>MAX_EVENTS)
   throw new DomainError('INVALID_AUDIT_LIMIT','Limit must be 1..'+MAX_EVENTS);
  return this.store.history(projectId,options.taskId,MAX_EVENTS*3).filter(x=>x.action==='skill.provenance')
   .slice(0,limit).map(x=>this.asTrace(x));
 }
 report(projectId:string,taskId:string){
  const task=this.store.get<TaskRecord>('task',taskId);
  if(!task||task.projectId!==projectId)throw new DomainError('PROJECT_MISMATCH','Task not in project',409);
  return {projectId,taskId,selectionHistory:this.list(projectId,{taskId}),
   engineering:task.engineering?{
    decision:task.engineering.decision?{
      revision:task.engineering.decision.revision,verdict:task.engineering.decision.decision?.verdict||'pending'
    }:undefined,
    implementation:task.engineering.implementation?{
      revision:task.engineering.implementation.revision,
      commits:[...task.engineering.implementation.commits],
      paths:task.engineering.implementation.changes.map(c=>c.path)
    }:undefined
   }:undefined};
 }
 private asTrace(activity:Activity):SkillTrace{
  const e=activity.evidence||{};
  return {id:activity.id,projectId:activity.projectId,taskId:activity.taskId,at:activity.at,
    actor:activity.actor,channel:activity.channel,
    skillId:String(e.skillId),version:String(e.version),sha256:String(e.sha256),
    reason:e.reason as SkillReason,operation:String(e.operation),
    ...(e.sourceActivityId?{sourceActivityId:String(e.sourceActivityId)}:{}),
    ...(e.sessionId?{sessionId:String(e.sessionId)}:{}),
    ...(e.commitHash?{commitHash:String(e.commitHash)}:{}),
    evidenceIds:Array.isArray(e.evidenceIds)?e.evidenceIds as string[]:[],
    status:e.status==='correlated'?'correlated':'selected'};
 }
}
