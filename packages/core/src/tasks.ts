import { randomUUID } from 'node:crypto';
import type { LocalStore } from '../../db/src/store.js';
import { assessRisk, attemptTransition, type Lane, type ReviewMode } from './workflow.js';
import type { Actor, BugThread, ChecklistItem, Project, ReviewerDecision, RiskFactors, TaskRecord, QaCase, Preview } from './models.js';
import { DomainError, now, requireText } from './models.js';

const lanes = ['backlog','todo','in-progress','ready-for-review','done'] as const;
const reviews = ['auto','require-review','skip-review'] as const;
const priorities = ['low','medium','high'] as const;
function member<T extends string>(value: unknown, options: readonly T[], name: string): T {
 if (!options.includes(value as T)) throw new DomainError('INVALID_'+name.toUpperCase(),name+' must be one of '+options.join(', '));
 return value as T;
}
function has<T>(item: T | undefined, label: string): T {
 if (!item) throw new DomainError('NOT_FOUND',label+' not found',404);
 return item;
}
export class Tasks {
 constructor(private store: LocalStore) {}
 project(id:string) { return has(this.store.get<Project>('project',id),'Project'); }
 listProjects() { return this.store.list<Project>('project'); }
 createProject(data:{name:string;platform?:Project['platform'];baseUrl?:string;sourcePath?:string;uiContext?:Record<string,unknown>},actor:Actor):Project {
  const name=requireText(data.name,'project name');
  const platform=member(data.platform || 'web',['web','desktop','mobile'] as const,'platform');
  const timestamp=now();
  const result:Project={id:'proj_'+randomUUID(),name,platform,baseUrl:data.baseUrl?.trim(),sourcePath:data.sourcePath?.trim(),uiContext:data.uiContext || {},createdAt:timestamp,updatedAt:timestamp};
  this.store.transaction(()=>{this.store.put('project',result);this.audit(actor,result.id,'project.create',undefined,undefined,undefined,{name,platform});});
  return result;
 }
 updateProject(id:string,data:Partial<Pick<Project,'name'|'platform'|'baseUrl'|'sourcePath'|'uiContext'>>,actor:Actor):Project {
  const p=this.project(id);
  const updated:Project={...p,...data,name:data.name===undefined?p.name:requireText(data.name,'project name'),updatedAt:now()};
  if(data.platform) member(data.platform,['web','desktop','mobile'] as const,'platform');
  this.store.transaction(()=>{this.store.put('project',updated);this.audit(actor,id,'project.update');});
  return updated;
 }
 task(id:string) {return has(this.store.get<TaskRecord>('task',id),'Task');}
 listTasks(projectId:string){this.project(projectId);return this.store.list<TaskRecord>('task',{projectId});}
 createTask(data:{projectId:string;title:string;description?:string;parentId?:string;originTaskId?:string;
 type?:TaskRecord['type'];priority?:TaskRecord['priority'];reviewMode?:ReviewMode;risk?:RiskFactors;acceptanceCriteria?:string;verificationStep?:string},actor:Actor):TaskRecord {
  this.project(data.projectId);
  const title=requireText(data.title,'title');
  if(data.parentId){
   const parent=this.task(data.parentId);
   if(parent.projectId!==data.projectId) throw new DomainError('PROJECT_MISMATCH','Parent must belong to same project');
   if(parent.status==='done') throw new DomainError('DONE_IS_TERMINAL','Cannot add a subtask to a completed task');
   if(parent.parentId) throw new DomainError('SUBTASK_DEPTH','V1 supports direct child subtasks only');
  }
  if(data.originTaskId){
   const origin=this.task(data.originTaskId);
   if(origin.projectId!==data.projectId || origin.status!=='done') throw new DomainError('INVALID_BUG_ORIGIN','Post-Done linked Bug must originate in completed task in same project');
   if(data.parentId) throw new DomainError('BUG_PARENT_FORBIDDEN','Post-Done Bug must be top-level');
  }
  const t=now();
  return this.store.transaction(()=>{
   const id='tsk_'+randomUUID();
   const displayId='FLY-'+String(this.store.nextSequence('task')).padStart(4,'0');
   const task:TaskRecord={id,displayId,projectId:data.projectId,title,description:data.description??'',type:data.type||'task',parentId:data.parentId,
    originTaskId:data.originTaskId,status:'backlog',priority:member(data.priority||'medium',priorities,'priority'),reviewMode:member(data.reviewMode||'auto',reviews,'review mode'),
    risk:data.risk||{},acceptanceCriteria:data.acceptanceCriteria||'',verificationStep:data.verificationStep||'',
    checklist:[],childIds:[],testsPassed:false,reviewApproved:false,createdAt:t,updatedAt:t};
   this.store.put('task',task);
   if(data.parentId){ const parent=this.task(data.parentId);this.store.put('task',{...parent,childIds:[...parent.childIds,id],updatedAt:t}); }
   this.audit(actor,data.projectId,'task.create',id,undefined,'backlog',{displayId,parentId:data.parentId,originTaskId:data.originTaskId});
   return task;
  });
 }
 updateTask(id:string,input:Partial<Pick<TaskRecord,'title'|'description'|'priority'|'reviewMode'|'reviewSkipReason'|'risk'|'acceptanceCriteria'|'verificationStep'>>,actor:Actor){
  const task=this.task(id);
  if(task.status==='done') throw new DomainError('DONE_IS_TERMINAL','Completed tasks are immutable; create a linked Bug for new defects');
  if(input.reviewMode) member(input.reviewMode,reviews,'review mode');
  if(input.priority) member(input.priority,priorities,'priority');
  const next={...task,...input,updatedAt:now()};
  if(input.title!==undefined)next.title=requireText(input.title,'title');
  if(next.reviewMode==='skip-review' && assessRisk(next)!=='LOW' && !next.reviewSkipReason?.trim())
   throw new DomainError('REVIEW_SKIP_REASON_REQUIRED','Manual Review bypass at medium/high risk requires a reason');
  const substantive=['description','risk','acceptanceCriteria','verificationStep','title'].some(key=>key in input);
  if(substantive){next.testsPassed=false;next.reviewApproved=false;}
  this.store.transaction(()=>{this.store.put('task',next);this.audit(actor,task.projectId,'task.update',id,undefined,undefined,{fields:Object.keys(input),risk:assessRisk(next)});});
  return next;
 }
 private audit(actor:Actor,projectId:string,action:string,taskId?:string,from?:string,to?:string,evidence?:Record<string,unknown>,reason?:string){
  requireText(actor.actor,'actor');
  return this.store.audit({projectId,taskId,action,actor:actor.actor,channel:actor.channel,from,to,reason,evidence});
 }
 activity(projectId:string,taskId?:string,limit=150){return this.store.history(projectId,taskId,limit);}
 blockers(id:string):string[]{
  const task=this.task(id);
  const children=task.childIds.map(cid=>this.task(cid));
  const unfinished=children.filter(c=>c.status!=='done');
  const allCases=this.store.list<QaCase>('qa',{taskId:id});
  const current=this.currentQa(task,allCases);
  const reasons:string[]=[];
  if(!task.testsPassed)reasons.push('TESTS_NOT_PASSED');
  if(task.checklist.some(item=>!item.done))reasons.push('CHECKLIST_INCOMPLETE');
  if(unfinished.length)reasons.push('UNFINISHED_SUBTASKS');
  if(this.store.list<BugThread>('bug',{taskId:id}).some(b=>b.status==='open'))reasons.push('OPEN_BUGS');
  if(current.some(c=>c.required && (c.verdict!=='PASS' && c.verdict!=='WAIVED')))reasons.push('REQUIRED_QA_INCOMPLETE');
  if(current.some(c=>c.required && !c.revisionId))reasons.push('REQUIRED_QA_STALE');
  if((task.reviewMode==='require-review'||task.reviewMode==='auto'&&assessRisk(task)!=='LOW')&&!task.reviewApproved)reasons.push('REVIEW_NOT_APPROVED');
  if(task.reviewMode==='skip-review'&&assessRisk(task)!=='LOW'&&!task.reviewSkipReason?.trim())reasons.push('REVIEW_SKIP_REASON_REQUIRED');
  return reasons;
 }
 private currentQa(task:TaskRecord,cases:QaCase[]){
  return cases.filter(c=>{
   const preview=this.store.get<Preview>('preview',c.previewId);
   return preview?.approvedRevisionId===c.revisionId;
  });
 }
 transition(id:string,input:{to:Lane;reason?:string;forceDone?:boolean},actor:Actor){
  const task=this.task(id);
  const to=member(input.to,lanes,'lane');
  const children=task.childIds.map(childId=>this.task(childId));
  const cases=this.currentQa(task,this.store.list<QaCase>('qa',{taskId:id}));
  const mapped={
   ...task,
   requiredQa:cases.filter(c=>c.required).map(c=>({id:c.id,approvedRevision:c.revisionId,currentApprovedRevision:c.revisionId,verdict:c.verdict})),
  };
  const decision=attemptTransition(mapped,{to,actor:actor.actor,channel:actor.channel,reason:input.reason,forceDone:input.forceDone},children,now());
  if(!decision.ok) throw new DomainError('TRANSITION_BLOCKED','Task transition rejected',409,{blockers:decision.blockers});
  const blockers=this.blockers(id).filter(b=>b!=='UNFINISHED_SUBTASKS' || !input.forceDone);
  if(to==='done' && blockers.length)throw new DomainError('DONE_BLOCKED','Task completion gates not satisfied',409,{blockers});
  if(to==='done' && task.status!=='ready-for-review' && task.reviewMode==='require-review' && !task.reviewApproved)
   throw new DomainError('REVIEW_REQUIRED','This card requires review');
  const next:TaskRecord={...task,status:to,updatedAt:now(),doneAt:to==='done'?now():task.doneAt};
  const evidence=decision.audit.evidence as Record<string,unknown>|undefined;
  this.store.transaction(()=>{this.store.put('task',next);this.audit(actor,task.projectId,decision.audit.action,id,task.status,to,{risk:assessRisk(task),...evidence},input.reason?.trim());});
  return next;
 }
 setTests(id:string,passed:boolean,evidence:string,actor:Actor){
  const task=this.task(id);
  if(task.status==='done')throw new DomainError('DONE_IS_TERMINAL','Completed task evidence is immutable');
  if(passed)requireText(evidence,'verification evidence');
  const next={...task,testsPassed:passed,updatedAt:now()};
  this.store.transaction(()=>{this.store.put('task',next);this.audit(actor,task.projectId,'tests.record',id,undefined,undefined,{passed,evidence});});
  return next;
 }
 checklist(id:string,action:'add'|'edit'|'toggle'|'remove'|'reorder',input:{itemId?:string;text?:string;done?:boolean;index?:number},actor:Actor){
  const task=this.task(id);
  if(task.status==='done')throw new DomainError('DONE_IS_TERMINAL','Completed task checklist is immutable');
  let items:ChecklistItem[]=task.checklist.map(item=>({...item}));
  if(action==='add')items.push({id:'check_'+randomUUID(),text:requireText(input.text,'checklist text'),done:false});
  else {
   const index=items.findIndex(item=>item.id===input.itemId);
   if(index<0)throw new DomainError('NOT_FOUND','Checklist item not found',404);
   if(action==='edit')items[index]!.text=requireText(input.text,'checklist text');
   if(action==='toggle')items[index]!.done=Boolean(input.done);
   if(action==='remove')items.splice(index,1);
   if(action==='reorder'){
    if(!Number.isInteger(input.index)||input.index!<0||input.index!>=items.length)throw new DomainError('INVALID_INDEX','Reorder index is out of range');
    const [item]=items.splice(index,1);items.splice(input.index!,0,item!);
   }
  }
  const next={...task,checklist:items,updatedAt:now()};
  this.store.transaction(()=>{this.store.put('task',next);this.audit(actor,task.projectId,'checklist.'+action,id,undefined,undefined,{itemId:input.itemId,itemCount:items.length});});
  return next;
 }
 review(id:string,decision:ReviewerDecision,actor:Actor){
  const task=this.task(id);
  if(task.status!=='ready-for-review')throw new DomainError('REVIEW_NOT_READY','Review requires Ready for Review lane');
  if(decision.verdict==='reject'){
   const reason=requireText(decision.reason,'rejection reason');
   const bug=this.bugCreate(id,{origin:'review',fingerprint:decision.fingerprint||reason,title:'Review rejected',description:reason,evidenceId:decision.evidenceId},actor);
   const next={...task,status:'in-progress' as Lane,reviewApproved:false,updatedAt:now()};
   this.store.transaction(()=>{this.store.put('task',next);this.audit(actor,task.projectId,'review.reject',id,'ready-for-review','in-progress',{bugId:bug.id},reason);});
   return {task:next,bug};
  }
  if(decision.verdict!=='approve')throw new DomainError('INVALID_REVIEW','Review verdict must be approve or reject');
  const next={...task,reviewApproved:true,updatedAt:now()};
  this.store.transaction(()=>{this.store.put('task',next);this.audit(actor,task.projectId,'review.approve',id,undefined,undefined,{risk:assessRisk(task)},decision.reason?.trim());});
  return {task:next};
 }
 bugCreate(taskId:string,input:{origin:BugThread['origin'];fingerprint:string;title:string;description:string;evidenceId?:string;caseId?:string},actor:Actor){
  const task=this.task(taskId);
  if(task.status==='done')throw new DomainError('DONE_IS_TERMINAL','Use post-Done linked Bug Task');
  const fingerprint=requireText(input.fingerprint,'bug fingerprint').toLowerCase();
  const list=this.store.list<BugThread>('bug',{taskId});
  const existing=list.find(b=>b.origin===input.origin && b.fingerprint===fingerprint);
  const event={timestamp:now(),actor:actor.actor,channel:actor.channel,detail:requireText(input.description,'bug description'),evidenceId:input.evidenceId,caseId:input.caseId};
  const bug:BugThread=existing?{...existing,status:'open',occurrences:[...existing.occurrences,event],updatedAt:now()}:
   {id:'bug_'+randomUUID(),projectId:task.projectId,taskId,origin:input.origin,fingerprint,
    title:requireText(input.title,'bug title'),description:input.description,status:'open',occurrences:[event],createdAt:now(),updatedAt:now()};
  this.store.transaction(()=>{this.store.put('bug',bug);this.audit(actor,task.projectId,existing?'bug.reopen':'bug.create',taskId,undefined,undefined,{bugId:bug.id,origin:input.origin,evidenceId:input.evidenceId});});
  return bug;
 }
 resolveBug(bugId:string,reason:string,actor:Actor){
  const bug=has(this.store.get<BugThread>('bug',bugId),'Bug');
  requireText(reason,'resolution evidence');
  const task=this.task(bug.taskId);
  if(task.status==='done')throw new DomainError('DONE_IS_TERMINAL','Cannot mutate embedded Bugs in completed tasks');
  const next={...bug,status:'resolved' as const,updatedAt:now(),occurrences:[...bug.occurrences,{timestamp:now(),actor:actor.actor,channel:actor.channel,detail:'Resolved: '+reason}]};
  this.store.transaction(()=>{this.store.put('bug',next);this.audit(actor,task.projectId,'bug.resolve',task.id,undefined,undefined,{bugId,reason});});
  return next;
 }
 linkedPostDoneBug(originId:string,input:{title:string;description:string},actor:Actor){
  const origin=this.task(originId);
  if(origin.status!=='done')throw new DomainError('NOT_DONE','Separate linked Bug tasks are only for post-Done defects');
  return this.createTask({projectId:origin.projectId,type:'bug',originTaskId:origin.id,title:input.title,description:input.description},actor);
 }
 taskDetail(id:string){
  const task=this.task(id);const bugs=this.store.list<BugThread>('bug',{taskId:id});
  const children=task.childIds.map(childId=>this.task(childId));
  const cases=this.currentQa(task,this.store.list<QaCase>('qa',{taskId:id}));
  const linked=this.store.list<TaskRecord>('task',{projectId:task.projectId}).filter(t=>t.originTaskId===id);
  return {task,children,bugs,cases,linked,blockers:this.blockers(id),risk:assessRisk(task),history:this.activity(task.projectId,id)};
 }
}
