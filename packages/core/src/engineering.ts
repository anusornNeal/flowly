import type { LocalStore } from '../../db/src/store.js';
import type { Actor, TaskRecord } from './models.js';
import { DomainError, now, requireText } from './models.js';
import { assessRisk } from './workflow.js';

export type DeliverySize = 'auto' | 'small' | 'medium' | 'large' | 'critical';
export type DecisionOption = { id: string; title: string; benefits: string; drawbacks: string; effort: string };
export type DecisionReportInput = {
 requirements: string; currentArchitecture: string; alternatives: DecisionOption[];
 impacts: string; recommendation: string;
};
export type DecisionReport = DecisionReportInput & {
 revision: number; updatedAt: string; author: string;
 decision?: { verdict: 'approve' | 'request-changes' | 'reject'; selectedOptionId?: string;
  reason: string; revision: number; actor: string; at: string };
};
export type ImplementationChange = { path: string; summary: string };
export type ImplementationReportInput = {
 requirements: string; changes: ImplementationChange[]; technicalDecisions: string;
 alternativesAndTradeoffs: string; verification: string; deviations: string; materialDeviation?: boolean;
 commits: string[]; noChangesReason?: string;
};
export type ImplementationReport = ImplementationReportInput & {
 revision: number; author: string; updatedAt: string;
};
export type Workstream = { id: string; title: string; ownedPaths: string[]; dependsOn: string[];
 status: 'pending' | 'in-progress' | 'done' };
export type ExecutionPlan = { strategy: 'parallel-first'; workstreams: Workstream[]; updatedAt: string };
export type EngineeringRecord = {
 size: DeliverySize; decision?: DecisionReport; implementation?: ImplementationReport;
 plan?: ExecutionPlan;
};

function text(value: unknown, label: string): string { return requireText(value, label); }
function active(task: TaskRecord): void {
 if (task.status === 'done') throw new DomainError('DONE_IS_TERMINAL', 'Completed task reports are immutable');
}
function validateDecision(input: DecisionReportInput): DecisionReportInput {
 if (!input || !Array.isArray(input.alternatives) || input.alternatives.length < 2)
  throw new DomainError('ALTERNATIVES_REQUIRED', 'Compare at least two approaches');
 const ids = new Set<string>();
 const alternatives = input.alternatives.map(item => {
  const id = text(item.id, 'option ID');
  if (ids.has(id)) throw new DomainError('DUPLICATE_APPROACH', 'Approach IDs must be unique');
  ids.add(id);
  return {id, title:text(item.title,'option title'), benefits:text(item.benefits,'benefits'),
   drawbacks:text(item.drawbacks,'drawbacks'),effort:text(item.effort,'effort')};
 });
 return {requirements:text(input.requirements,'requirements'),
  currentArchitecture:text(input.currentArchitecture,'architecture'),alternatives,
  impacts:text(input.impacts,'impact analysis'),recommendation:text(input.recommendation,'recommendation')};
}
function validateImplementation(input: ImplementationReportInput): ImplementationReportInput {
 if (!input || !Array.isArray(input.changes) || !Array.isArray(input.commits))
  throw new DomainError('INVALID_REPORT','Changes and commits must be arrays');
 const changes = input.changes.map(item => ({path:text(item.path,'file path'),summary:text(item.summary,'change summary')}));
 if (!changes.length && !input.noChangesReason?.trim())
  throw new DomainError('CHANGE_EVIDENCE_REQUIRED','Provide changed files or a no-changes reason');
 const commits = input.commits.map(hash => {
  if (typeof hash !== 'string' || !/^[0-9a-f]{7,40}$/i.test(hash))
   throw new DomainError('INVALID_COMMIT','Commit references must be Git hashes');
  return hash;
 });
 return {requirements:text(input.requirements,'requirements'),changes,
  technicalDecisions:text(input.technicalDecisions,'technical decisions'),
  alternativesAndTradeoffs:text(input.alternativesAndTradeoffs,'tradeoffs'),
  verification:text(input.verification,'verification evidence'),
  deviations:typeof input.deviations==='string'?input.deviations:'',
  materialDeviation:input.materialDeviation===true,
  commits:[...new Set(commits)],noChangesReason:input.noChangesReason?.trim()};
}
export function deliverySize(task: TaskRecord): Exclude<DeliverySize,'auto'> {
 const explicit = task.engineering?.size;
 const risk = assessRisk(task);
 // Risk floors cannot be downgraded by an optimistic size override.
 if (risk==='HIGH') return 'critical';
 if (explicit==='critical') return 'critical';
 if (explicit==='large' || task.childIds.length >= 3) return 'large';
 if (explicit==='medium' || risk==='MEDIUM') return 'medium';
 return 'small';
}
export function decisionRequired(task:TaskRecord):boolean {
 return ['large','critical'].includes(deliverySize(task));
}
export function engineeringBlockers(task:TaskRecord):string[] {
 if (!decisionRequired(task)) return [];
 const result:string[]=[];
 const decision=task.engineering?.decision;
 if (!decision || decision.decision?.verdict!=='approve' || decision.decision.revision!==decision.revision)
  result.push('DECISION_APPROVAL_REQUIRED');
 if (!task.engineering?.plan?.workstreams.length) result.push('PARALLEL_PLAN_REQUIRED');
 return result;
}
export function reportBlockers(task:TaskRecord):string[] {
 if (!decisionRequired(task)) return [];
 return task.engineering?.implementation?[]:['IMPLEMENTATION_REPORT_REQUIRED'];
}
function validatedPlan(workstreams: Workstream[]):Workstream[] {
 if (!Array.isArray(workstreams) || workstreams.length<2) throw new DomainError('PARALLEL_WORKSTREAMS_REQUIRED','At least two workstreams required');
 const ids = new Set<string>();
 const streams = workstreams.map(s=>{
  const id=text(s.id,'workstream ID');
  if(ids.has(id))throw new DomainError('DUPLICATE_WORKSTREAM','Workstream IDs must be unique');
  ids.add(id);
  if(!Array.isArray(s.ownedPaths)||!Array.isArray(s.dependsOn))throw new DomainError('INVALID_PLAN','ownedPaths and dependsOn must be arrays');
  if(!['pending','in-progress','done'].includes(s.status))throw new DomainError('INVALID_WORKSTREAM_STATUS','Invalid workstream state');
  return {id,title:text(s.title,'workstream title'),ownedPaths:s.ownedPaths.map(x=>text(x,'owned path')),
   dependsOn:s.dependsOn.map(x=>text(x,'dependency ID')),status:s.status};
 });
 const byId=new Map(streams.map(s=>[s.id,s]));
 const visit=(id:string,seen:Set<string>,stack:Set<string>)=>{
  if(stack.has(id))throw new DomainError('PLAN_CYCLE','Execution plan contains a cycle');
  if(seen.has(id))return;
  const s=byId.get(id);
  if(!s)throw new DomainError('UNKNOWN_DEPENDENCY','Dependency not found: '+id);
  stack.add(id);
  for(const dependency of s.dependsOn)visit(dependency,seen,stack);
  stack.delete(id);seen.add(id);
 };
 const seen=new Set<string>();
 for(const s of streams)visit(s.id,seen,new Set());
 const claimed:Array<{path:string;streamId:string}>=[];
 const linked=(from:string,to:string,visited=new Set<string>()):boolean=>{
  if(from===to)return true;
  if(visited.has(from))return false;
  visited.add(from);
  return (byId.get(from)?.dependsOn||[]).some(d=>linked(d,to,visited));
 };
 for(const stream of streams){
  if(!stream.ownedPaths.length)throw new DomainError('PATH_OWNERSHIP_REQUIRED','Each workstream must declare exclusive file or directory ownership');
  for(const ownedPath of stream.ownedPaths){
   const normalized=ownedPath.replaceAll('\\','/').replace(/\/+$/,'').toLowerCase();
   for(const prior of claimed){
    const overlaps=normalized===prior.path || normalized.startsWith(prior.path+'/') || prior.path.startsWith(normalized+'/');
    if(overlaps && prior.streamId!==stream.id &&
     !linked(stream.id,prior.streamId) && !linked(prior.streamId,stream.id))
     throw new DomainError('PARALLEL_PATH_CONFLICT','Independent streams overlap paths: '+ownedPath);
   }
   claimed.push({path:normalized,streamId:stream.id});
  }
 }
 return streams;
}
export function runnableStreams(plan?: ExecutionPlan):Workstream[] {
 if(!plan)return [];
 const done=new Set(plan.workstreams.filter(s=>s.status==='done').map(s=>s.id));
 return plan.workstreams.filter(s=>s.status==='pending'&&s.dependsOn.every(id=>done.has(id)));
}
export class Engineering {
 constructor(private store: LocalStore){}
 private get(id:string): TaskRecord {
  const task=this.store.get<TaskRecord>('task',id);
  if(!task)throw new DomainError('NOT_FOUND','Task not found',404);
  return task;
 }
 private save(task:TaskRecord,action:string,actor:Actor,evidence:Record<string,unknown>):TaskRecord {
  const updated={...task,updatedAt:now()};
  this.store.transaction(()=>{
   this.store.put('task',updated);
   this.store.audit({projectId:task.projectId,taskId:task.id,action,actor:actor.actor,channel:actor.channel,evidence});
  });
  return updated;
 }
 updateSize(id:string,size:DeliverySize,actor:Actor) {
  const task=this.get(id);active(task);
  if(!['auto','small','medium','large','critical'].includes(size))throw new DomainError('INVALID_SIZE','Invalid delivery size');
  if(task.status==='in-progress'||task.status==='ready-for-review')
   throw new DomainError('SIZE_CHANGE_TOO_LATE','Return to To-do before changing delivery size');
  return this.save({...task,engineering:{...task.engineering,size}},'engineering.size',actor,{size});
 }
 writeDecision(id:string,input:DecisionReportInput,actor:Actor) {
  const task=this.get(id);active(task);
  const validated=validateDecision(input);
  const revision=(task.engineering?.decision?.revision||0)+1;
  const decision={...validated,revision,updatedAt:now(),author:actor.actor};
  return this.save({...task,engineering:{size:task.engineering?.size||'auto',...task.engineering,decision}},
   'engineering.decision.report',actor,{revision,options:decision.alternatives.map(x=>x.id)});
 }
 resolveDecision(id:string,verdict:'approve'|'request-changes'|'reject',reason:string,selectedOptionId:string|undefined,actor:Actor) {
  const task=this.get(id);active(task);
  const current=task.engineering?.decision;
  if(!current)throw new DomainError('DECISION_REPORT_REQUIRED','Write a decision report first');
  if(!['approve','request-changes','reject'].includes(verdict))throw new DomainError('INVALID_DECISION','Invalid decision verdict');
  if(verdict==='approve' && !current.alternatives.some(a=>a.id===selectedOptionId))
   throw new DomainError('APPROACH_REQUIRED','Choose a valid approach when approving');
  const decision={...current,decision:{verdict,selectedOptionId:verdict==='approve'?selectedOptionId:undefined,
   reason:text(reason,'decision reason'),revision:current.revision,actor:actor.actor,at:now()}};
  return this.save({...task,engineering:{...task.engineering!,decision}},'engineering.decision.'+verdict,actor,
   {revision:current.revision,selectedOptionId,reason});
 }
 writeImplementation(id:string,input:ImplementationReportInput,actor:Actor) {
  const task=this.get(id);active(task);
  const content=validateImplementation(input);
  const implementation={...content,revision:(task.engineering?.implementation?.revision||0)+1,
   author:actor.actor,updatedAt:now()};
  const decision=task.engineering?.decision;
  const engineering={...task.engineering!,size:task.engineering?.size||'auto',implementation,
   decision:content.materialDeviation && decision?{...decision,decision:undefined}:decision};
  return this.save({...task,reviewApproved:false,engineering},
   'engineering.implementation.report',actor,{revision:implementation.revision,commits:implementation.commits,paths:implementation.changes.map(x=>x.path)});
 }
 setPlan(id:string,workstreams:Workstream[],actor:Actor) {
  const task=this.get(id);active(task);
  if(task.status==='ready-for-review')throw new DomainError('PLAN_LOCKED','Return to In Progress before changing execution plan');
  if(task.engineering?.plan?.workstreams.some(s=>s.status!=='pending'))
   throw new DomainError('PLAN_LOCKED','Workstream execution has started; create a successor task for a changed execution plan');
  const verified=validatedPlan(workstreams);
  if(verified.some(s=>s.status!=='pending'))
   throw new DomainError('WORKSTREAM_START_REQUIRED','New workstreams must start Pending');
  const plan:ExecutionPlan={strategy:'parallel-first',workstreams:verified,updatedAt:now()};
  return this.save({...task,engineering:{size:task.engineering?.size||'auto',...task.engineering,plan}},
   'engineering.parallel.plan',actor,{workstreams:plan.workstreams.map(s=>({id:s.id,dependsOn:s.dependsOn}))});
 }
 next(id:string) {const task=this.get(id);return {strategy:'parallel-first',ready:runnableStreams(task.engineering?.plan),plan:task.engineering?.plan,
   blockers:engineeringBlockers(task)};}
 setStreamStatus(id:string,streamId:string,status:Workstream['status'],actor:Actor,evidence?:string){
  return this.store.transactionImmediate(()=>{
  const task=this.get(id);active(task);
  if(task.status!=='in-progress')throw new DomainError('WORKSTREAM_NOT_READY','Move the task into In Progress after decision approval');
  if(engineeringBlockers(task).length)throw new DomainError('DECISION_GATE_BLOCKED','Approve the current decision before continuing workstreams');
  const plan=task.engineering?.plan;
  if(!plan)throw new DomainError('PLAN_REQUIRED','Set a parallel workstream plan first');
  if(!['pending','in-progress','done'].includes(status))throw new DomainError('INVALID_STATUS','Invalid stream status');
  const stream=plan.workstreams.find(s=>s.id===streamId);
  if(!stream)throw new DomainError('UNKNOWN_WORKSTREAM','Workstream not found');
  if(status==='in-progress' && !runnableStreams(plan).some(s=>s.id===streamId))
   throw new DomainError('STREAM_DEPENDENCIES_INCOMPLETE','Cannot start before dependencies complete');
  if(stream.status==='done' && status!=='done')throw new DomainError('DONE_STREAM_IMMUTABLE','Completed streams cannot be reopened');
  if(status==='done' && stream.status!=='in-progress')throw new DomainError('STREAM_START_REQUIRED','Start the stream before completing it');
  if(status==='done' && !evidence?.trim())throw new DomainError('STREAM_EVIDENCE_REQUIRED','Provide completion evidence for this stream');
  const workstreams=plan.workstreams.map(s=>s.id===streamId?{...s,status}:s);
  return this.save({...task,engineering:{...task.engineering!,plan:{...plan,workstreams,updatedAt:now()}}},
   'engineering.parallel.status',actor,{streamId,status,evidence:status==='done'?evidence:undefined});
  });
 }
}
