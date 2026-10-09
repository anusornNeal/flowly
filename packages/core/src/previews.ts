import { randomUUID } from 'node:crypto';
import type { LocalStore } from '../../db/src/store.js';
import type { Actor, Preview, PreviewRevision, ScreenSpec, QaCase, Screenshot, Comparison, TaskRecord } from './models.js';
import { DomainError, isViewport, now, requireText } from './models.js';
import type { Tasks } from './tasks.js';
import { inspectRendered } from '../../capture/src/renderer.js';
import { inspectLocalUIContext } from './context.js';

const found = <T>(record:T|undefined,label:string):T => {
 if(!record)throw new DomainError('NOT_FOUND',label+' not found',404);
 return record;
};
function validScreens(screens: ScreenSpec[]): ScreenSpec[] {
 if(!Array.isArray(screens))throw new DomainError('INVALID_SCREENS','Screens must be an array');
 const seen=new Set<string>();
 return screens.map(s=>{
  const id=requireText(s.id,'screen ID'),stateId=requireText(s.stateId,'state ID');
  requireText(s.name,'screen name');
  if(!isViewport(s.viewport))throw new DomainError('INVALID_VIEWPORT','Screen needs a complete width/height/device tuple');
  const key=[id,stateId,s.viewport.device,s.viewport.width,s.viewport.height].join(':');
  if(seen.has(key))throw new DomainError('DUPLICATE_SCREEN_TARGET','Duplicate screen/state/viewport tuple');
  seen.add(key);
  return {...s,id,stateId};
 });
}
export class Previews {
 constructor(private store:LocalStore,private tasks:Tasks) {}
 get(id:string){return found(this.store.get<Preview>('preview',id),'Preview');}
 getRevision(id:string){return found(this.store.get<PreviewRevision>('revision',id),'Revision');}
 list(projectId:string){this.tasks.project(projectId);return this.store.list<Preview>('preview',{projectId});}
 create(input:{projectId:string;taskId?:string;name:string;html?:string;css?:string;js?:string;screens?:ScreenSpec[]},actor:Actor){
  const project=this.tasks.project(input.projectId);
  if(input.taskId && this.tasks.task(input.taskId).projectId!==project.id)throw new DomainError('PROJECT_MISMATCH','Preview task must belong to this project');
  const t=now();
  const p:Preview={id:'prv_'+randomUUID(),projectId:project.id,taskId:input.taskId,name:requireText(input.name,'preview name'),
   draft:{html:input.html||'',css:input.css||'',js:input.js||'',screens:validScreens(input.screens||[]),contextSnapshot:inspectLocalUIContext(project)},
   revisionIds:[],createdAt:t,updatedAt:t};
  this.store.transaction(()=>{this.store.put('preview',p);this.audit(actor,p.projectId,'preview.create',p.taskId,{previewId:p.id});});
  return p;
 }
 updateDraft(id:string,data:{html?:string;css?:string;js?:string;screens?:ScreenSpec[];name?:string},actor:Actor){
  const p=this.get(id);
  const next={...p,name:data.name===undefined?p.name:requireText(data.name,'preview name'),draft:{...p.draft,
   html:data.html===undefined?p.draft.html:data.html,css:data.css===undefined?p.draft.css:data.css,
   js:data.js===undefined?p.draft.js:data.js,screens:data.screens===undefined?p.draft.screens:validScreens(data.screens)},
   updatedAt:now()};
  this.store.transaction(()=>{this.store.put('preview',next);this.audit(actor,p.projectId,'preview.draft.update',p.taskId,{previewId:id,fields:Object.keys(data)});});
  return next;
 }
 refreshContext(id:string){
  const p=this.get(id),current=inspectLocalUIContext(this.tasks.project(p.projectId));
  const hash=(value:Record<string,unknown>)=>JSON.stringify({...value,capturedAt:undefined});
  return {approvedRevisionId:p.approvedRevisionId,pinnedDraftContext:p.draft.contextSnapshot,currentContext:current,
   changed:hash(p.draft.contextSnapshot)!==hash(current),
   revisions:p.revisionIds.map(revisionId=>{
    const revision=this.getRevision(revisionId);
    return {revisionId,version:revision.version,approved:revisionId===p.approvedRevisionId,
     pinned:revision.contextSnapshot,changed:hash(revision.contextSnapshot)!==hash(current)};
   })};
 }
 updateContextSnapshot(id:string,actor:Actor){
  const p=this.get(id),project=this.tasks.project(p.projectId);
  const next={...p,draft:{...p.draft,contextSnapshot:inspectLocalUIContext(project)},updatedAt:now()};
  this.store.transaction(()=>{this.store.put('preview',next);this.audit(actor,p.projectId,'preview.context.refresh',p.taskId,{previewId:id});});
  return next;
 }
 saveRevision(previewId:string,actor:Actor){
  const p=this.get(previewId);
  if(!p.draft.html.trim())throw new DomainError('HTML_REQUIRED','Preview HTML cannot be empty');
  const rev:PreviewRevision={id:'rev_'+randomUUID(),previewId,projectId:p.projectId,
   version:p.revisionIds.length+1,html:p.draft.html,css:p.draft.css,js:p.draft.js,
   screens:structuredClone(validScreens(p.draft.screens)),contextSnapshot:structuredClone(p.draft.contextSnapshot),createdAt:now()};
  const next={...p,revisionIds:[...p.revisionIds,rev.id],updatedAt:now()};
  this.store.transaction(()=>{this.store.put('revision',rev);this.store.put('preview',next);
   this.audit(actor,p.projectId,'preview.revision.save',p.taskId,{previewId,revisionId:rev.id,version:rev.version});});
  return rev;
 }
 async approve(previewId:string,revisionId:string,actor:Actor,options:{acceptWarnings?:boolean;warningReason?:string}={}){
  const p=this.get(previewId),rev=this.getRevision(revisionId);
  if(rev.previewId!==p.id)throw new DomainError('REVISION_MISMATCH','Revision does not belong to Preview');
  if(p.approvedRevisionId===revisionId)return {preview:p,revision:rev,cases:this.cases({previewId})};
  if(!rev.screens.length)throw new DomainError('NO_SCREEN_TARGETS','Approve requires at least one explicit Screen/State/Viewport target',409);
  const reports=[];
  for(const screen of rev.screens)reports.push(await inspectRendered(rev,screen));
  const issues=reports.flatMap(r=>r.issues.map(i=>({...i,screen:r.screen,state:r.state,viewport:r.viewport})));
  const critical=issues.filter(i=>i.severity==='critical');
  if(critical.length)throw new DomainError('PREVIEW_QUALITY_BLOCKED','Critical rendered Preview QA defects must be resolved before approval',409,{issues:critical});
  const warnings=issues.filter(i=>i.severity==='warning');
  if(warnings.length&&(!options.acceptWarnings||!options.warningReason?.trim()))
   throw new DomainError('PREVIEW_WARNINGS_NEED_ACCEPTANCE','Accept nonblocking renderer warnings explicitly with a reason',409,{issues:warnings});
  const t=now();
  const nextRevision:PreviewRevision={...rev,approvedAt:t,approvedBy:requireText(actor.actor,'actor'),
   approvedQuality:{checkedAt:t,warnings:warnings.map(w=>w.code+':'+w.screen+':'+w.state),
    acceptanceReason:options.warningReason?.trim(),checkedScreenCount:reports.length}};
  const nextPreview={...p,approvedRevisionId:revisionId,updatedAt:t};
  const created:QaCase[]=[];
  if(p.taskId){
   this.tasks.task(p.taskId);
   for(const screen of validScreens(rev.screens)){
    created.push({id:'qa_'+randomUUID(),projectId:p.projectId,taskId:p.taskId,previewId:p.id,revisionId,
     screenId:screen.id,stateId:screen.stateId,viewport:structuredClone(screen.viewport),
     required:screen.required!==false,updatedAt:t});
   }
  }
  this.store.transaction(()=>{
   this.store.put('revision',nextRevision);this.store.put('preview',nextPreview);
   for(const c of created)this.store.put('qa',c);
   this.audit(actor,p.projectId,'preview.approve',p.taskId,{previewId,revisionId,previousRevisionId:p.approvedRevisionId,caseIds:created.map(c=>c.id),qualityPassed:true,acceptedWarnings:nextRevision.approvedQuality?.warnings,warningReason:nextRevision.approvedQuality?.acceptanceReason});
  });
  return {preview:nextPreview,revision:nextRevision,cases:created};
 }
 cases(input:{projectId?:string;taskId?:string;previewId?:string;allRevisions?:boolean}){
  const list=this.store.list<QaCase>('qa',{projectId:input.projectId,taskId:input.taskId});
  return list.filter(c=>(!input.previewId||c.previewId===input.previewId)&&
   (input.allRevisions||this.get(c.previewId).approvedRevisionId===c.revisionId));
 }
 case(id:string){return found(this.store.get<QaCase>('qa',id),'QA Case');}
 setRequired(id:string,required:boolean,actor:Actor){
  const qa=this.case(id),p=this.get(qa.previewId);
  if(p.approvedRevisionId!==qa.revisionId)throw new DomainError('STALE_QA_CASE','Cannot change requirement on superseded revision');
  const next={...qa,required:Boolean(required),updatedAt:now()};
  this.store.transaction(()=>{this.store.put('qa',next);this.audit(actor,qa.projectId,'qa.requirement',qa.taskId,{caseId:id,required:next.required});});
  return next;
 }
 verdict(id:string,verdict:'PASS'|'FAIL'|'WAIVED',reason:string|undefined,actor:Actor){
  const c=this.case(id),task=this.tasks.task(c.taskId),p=this.get(c.previewId);
  if(p.approvedRevisionId!==c.revisionId)throw new DomainError('STALE_QA_CASE','Evidence references old Approved Preview');
  if(!['PASS','FAIL','WAIVED'].includes(verdict))throw new DomainError('INVALID_VERDICT','Verdict must be PASS FAIL or WAIVED');
  if(verdict==='WAIVED')requireText(reason,'waiver reason');
  if(verdict==='PASS'||verdict==='FAIL'){
   if(!c.evidenceId || !c.comparisonId)throw new DomainError('EVIDENCE_REQUIRED','PASS/FAIL needs actual screenshot and comparison');
   const shot=this.store.get<Screenshot>('screenshot',c.evidenceId);
   if(!shot||shot.status!=='active')throw new DomainError('EVIDENCE_UNAVAILABLE','Original screenshot unavailable');
   const cmp=this.store.get<Comparison>('comparison',c.comparisonId);
   if(!cmp||cmp.revisionId!==c.revisionId||cmp.screenshotId!==shot.id)throw new DomainError('STALE_COMPARISON','Comparison does not match current Approved Preview');
  }
  const next:QaCase={...c,verdict,verdictReason:reason?.trim(),verdictAt:now(),verdictBy:requireText(actor.actor,'actor'),updatedAt:now()};
  let bug:unknown;
  this.store.transaction(()=>{
   this.store.put('qa',next);
   if(c.comparisonId){const comparison=this.store.get<Comparison>('comparison',c.comparisonId);
    if(comparison)this.store.put('comparison',{...comparison,status:'decided'});}
   this.audit(actor,c.projectId,'qa.verdict',c.taskId,{caseId:c.id,verdict,reason:next.verdictReason,evidenceId:c.evidenceId,revisionId:c.revisionId});
   if(verdict==='FAIL'){
    const title='Visual QA mismatch: '+c.screenId+' / '+c.stateId;
    if(task.status==='done'){
     bug=this.tasks.linkedPostDoneBug(task.id,{title,description:reason?.trim()||'Post-Done visual mismatch on QA case '+c.id},actor);
    }else{
     bug=this.tasks.bugCreate(task.id,{origin:'visual_qa',
      fingerprint:'visual:'+c.screenId+':'+c.stateId+':'+c.viewport.device,
      title,description:reason?.trim()||'Visual QA mismatch confirmed',evidenceId:c.evidenceId,caseId:c.id},actor);
    }
   }
  });
  return {case:next,bug};
 }
 private audit(actor:Actor,projectId:string,action:string,taskId?:string,evidence?:Record<string,unknown>){
  this.store.audit({projectId,taskId,action,actor:requireText(actor.actor,'actor'),channel:actor.channel,evidence});
 }
}
