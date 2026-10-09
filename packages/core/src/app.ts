import type { Actor, BrowserStep, PreviewRevision, QaCase, ScreenSpec, Screenshot, Comparison } from './models.js';
import { DomainError } from './models.js';
import { LocalStore } from '../../db/src/store.js';
import { Tasks } from './tasks.js';
import { Previews } from './previews.js';
import { Images } from './images.js';
import { BrowserRecorder } from '../../capture/src/recorder.js';
import { runTaskBatch } from './taskBatch.js';
import { compareImage, inspectRendered, renderApproved, targetScreen } from '../../capture/src/renderer.js';

export class FlowlyApp {
 readonly store:LocalStore;readonly tasks:Tasks;readonly previews:Previews;readonly images:Images;readonly recorder:BrowserRecorder;
 constructor(root?:string){
  this.store=new LocalStore(root);
  this.tasks=new Tasks(this.store);
  this.previews=new Previews(this.store,this.tasks);
  this.images=new Images(this.store,this.tasks,this.previews);
  this.recorder=new BrowserRecorder(this.store,this.tasks,this.images);
 }
 snapshot(projectId:string){
  return {project:this.tasks.project(projectId),tasks:this.tasks.listTasks(projectId),previews:this.previews.list(projectId),
   cases:this.previews.cases({projectId}),screenshots:this.images.list().filter(s=>s.projectId===projectId||s.projectId==='unassigned'),bugs:this.store.list('bug',{projectId}),
   activity:this.tasks.activity(projectId)};
 }
 async compare(screenshotId:string,withDiff=false){
  const s=this.images.screenshot(screenshotId);
  if(!s.caseId||!s.taskId)throw new DomainError('UNASSIGNED_SCREENSHOT','Assign screenshot to a current QA Case before comparison');
  const c=this.previews.case(s.caseId);
  const comparison=this.store.list<Comparison>('comparison',{taskId:s.taskId})
   .find(x=>x.screenshotId===s.id&&x.qaCaseId===c.id);
  if(!comparison)throw new DomainError('COMPARISON_NOT_FOUND','Screenshot lacks matched approved Preview comparison',409);
  const rev=this.previews.getRevision(comparison.revisionId);
  const original=this.images.original(s.id);
  const result=await compareImage(rev,{...c,revisionId:comparison.revisionId},original.bytes,withDiff?'diff':'stats');
  this.store.put('comparison',{...comparison,differencePercent:result.differencePercent,comparedAt:new Date().toISOString()});
  return result;
 }
 async baseline(caseId:string){
  const c=this.previews.case(caseId),rev=this.previews.getRevision(c.revisionId);
  return renderApproved(rev,c);
 }
 async layoutCheck(revisionId:string,screenId?:string){
  const rev=this.previews.getRevision(revisionId);
  const targets=screenId?rev.screens.filter(s=>s.id===screenId):rev.screens;
  if(!targets.length)throw new DomainError('NO_TARGET_SCREENS','No screen targets defined for layout QA');
  const result=[];
  for(const s of targets)result.push(await inspectRendered(rev,s));
  return {passed:result.every(x=>x.passed),screens:result};
 }
 async close(){await this.recorder.closeAll();this.store.close();}
}

const OPERATIONS=[
 'project.list','project.create','project.update','project.get',
 'task.list','task.create','task.get','task.detail','task.context','task.batch','task.update','task.transition','task.tests',
 'task.checklist','task.subtask','task.review','task.bugs','task.bug.create','task.bug.resolve','task.post-done-bug',
 'task.history','task.blockers',
 'preview.list','preview.create','preview.get','preview.draft','preview.context','preview.context.refresh',
 'preview.revision.save','preview.revision.get','preview.approve','preview.quality',
 'qa.list','qa.get','qa.required','qa.verdict','qa.waiver.cancel',
 'screenshot.list','screenshot.inbox','screenshot.get','screenshot.assign','screenshot.compare',
 'screenshot.cleanup','screenshot.storage','screenshot.ingest-file',
 'recorder.start','recorder.stop','recorder.steps','recorder.steps.save','recorder.replay','recorder.capture','recorder.session.reset',
 'settings.token.reveal','settings.token.regenerate','activity','snapshot'
] as const;
export function capabilities(){
 return {name:'flowly',version:1,localFirst:true,agentFirst:true,webRequiresAgent:false,
  transports:['cli-json','localhost-http'],approvalAuthority:['cli','web'],operations:OPERATIONS};
}
export async function execute(app:FlowlyApp,op:string,data:Record<string,any>,actor:Actor):Promise<unknown>{
 const t=app.tasks,p=app.previews,i=app.images,r=app.recorder;
 switch(op){
  case 'project.list':return t.listProjects();
  case 'project.create':return t.createProject(data as Parameters<typeof t.createProject>[0],actor);
  case 'project.get':return t.project(String(data.id));
  case 'project.update':return t.updateProject(String(data.id),data,actor);
  case 'task.list':return t.listTasks(String(data.projectId));
  case 'task.create':return t.createTask(data as Parameters<typeof t.createTask>[0],actor);
  case 'task.subtask':return t.createTask({...data,parentId:String(data.parentId)} as Parameters<typeof t.createTask>[0],actor);
  case 'task.get':return t.task(String(data.id));
  case 'task.detail':return t.taskDetail(String(data.id));
  case 'task.batch':return runTaskBatch(app.store,t,data as Parameters<typeof runTaskBatch>[2],actor);
  case 'task.context':{
   const detail=t.taskDetail(String(data.id));
   const previewRefs=p.list(detail.task.projectId).filter(v=>v.taskId===detail.task.id)
    .map(v=>({previewId:v.id,approvedRevisionId:v.approvedRevisionId,draftUpdatedAt:v.updatedAt}));
   return {task:detail.task,children:detail.children.map(c=>({id:c.id,status:c.status,title:c.title})),
    checklist:detail.task.checklist,risk:detail.risk,blockers:detail.blockers,
    bugs:detail.bugs.map(b=>({id:b.id,status:b.status,origin:b.origin})),
    qa:detail.cases.map(c=>({id:c.id,screenId:c.screenId,stateId:c.stateId,required:c.required,verdict:c.verdict||'PENDING',revisionId:c.revisionId})),
    previews:previewRefs,recentActivity:detail.history.slice(0,8),nextActions:detail.task.status==='done'?['task.post-done-bug']:
    detail.blockers.length?['resolve blockers','task.tests','task.review','qa.verdict','task.transition']:['task.transition']};
  }
  case 'task.update':return t.updateTask(String(data.id),data,actor);
  case 'task.transition':return t.transition(String(data.id),data as Parameters<typeof t.transition>[1],actor);
  case 'task.tests':return t.setTests(String(data.id),Boolean(data.passed),String(data.evidence||''),actor);
  case 'task.checklist':return t.checklist(String(data.id),data.action,data,actor);
  case 'task.review':return t.review(String(data.id),data as Parameters<typeof t.review>[1],actor);
  case 'task.bugs':return app.store.list('bug',{taskId:String(data.id)});
  case 'task.bug.create':return t.bugCreate(String(data.id),data as Parameters<typeof t.bugCreate>[1],actor);
  case 'task.bug.resolve':return t.resolveBug(String(data.id),String(data.reason||''),actor);
  case 'task.post-done-bug':return t.linkedPostDoneBug(String(data.id),data as Parameters<typeof t.linkedPostDoneBug>[1],actor);
  case 'task.history':return t.activity(String(data.projectId),data.id?String(data.id):undefined);
  case 'task.blockers':return t.blockers(String(data.id));
  case 'preview.list':return p.list(String(data.projectId));
  case 'preview.create':return p.create(data as Parameters<typeof p.create>[0],actor);
  case 'preview.get':return p.get(String(data.id));
  case 'preview.draft':return p.updateDraft(String(data.id),data,actor);
  case 'preview.context':return p.refreshContext(String(data.id));
  case 'preview.context.refresh':return p.updateContextSnapshot(String(data.id),actor);
  case 'preview.revision.save':return p.saveRevision(String(data.id),actor);
  case 'preview.revision.get':return p.getRevision(String(data.id));
  case 'preview.approve':return p.approve(String(data.id),String(data.revisionId),actor,{acceptWarnings:data.acceptWarnings===true,warningReason:typeof data.warningReason==='string'?data.warningReason:undefined});
  case 'preview.quality':return app.layoutCheck(String(data.revisionId),data.screenId);
  case 'qa.list':return p.cases(data);
  case 'qa.get':return p.case(String(data.id));
  case 'qa.required':return p.setRequired(String(data.id),Boolean(data.required),actor);
  case 'qa.verdict':return p.verdict(String(data.id),data.verdict,data.reason,actor);
  case 'qa.waiver.cancel':return p.cancelWaiver(String(data.id),actor,data.reason);
  case 'screenshot.list':return i.list(data.projectId,Boolean(data.includeDeleted));
  case 'screenshot.inbox':return i.inbox(data.projectId);
  case 'screenshot.get':return i.screenshot(String(data.id));
  case 'screenshot.assign':return i.assign(String(data.id),data as Parameters<typeof i.assign>[1],actor);
  case 'screenshot.compare':{const {diff,...result}=await app.compare(String(data.id));return result;}
  case 'screenshot.cleanup':return i.cleanup(data.ids,actor);
  case 'screenshot.storage':return i.storage();
  case 'screenshot.ingest-file':{
   const fs=await import('node:fs');
   const bytes=fs.readFileSync(String(data.path));
   return i.ingest({...data,data:bytes,source:'manual'},actor);
  }
  case 'recorder.start':return r.start(String(data.projectId),String(data.screenId),data.route,actor);
  case 'recorder.stop':return r.stop(String(data.projectId),actor);
  case 'recorder.steps':return data.screenId?r.recipe(String(data.projectId),String(data.screenId)):r.recipes(String(data.projectId));
  case 'recorder.steps.save':return r.saveRecipe(String(data.projectId),String(data.screenId),data.steps as BrowserStep[],actor);
  case 'recorder.replay':return r.replay(String(data.projectId),String(data.screenId),data.route,actor);
  case 'recorder.capture':return r.capture(data as Parameters<typeof r.capture>[0],actor);
  case 'recorder.session.reset':return r.reset(String(data.projectId),data.confirm===true,actor);
  case 'settings.token.reveal':return {token:i.token()};
  case 'settings.token.regenerate':return i.regenerateToken(data.confirm===true,actor);
  case 'activity':return t.activity(String(data.projectId),data.taskId);
  case 'snapshot':return app.snapshot(String(data.projectId));
  default:throw new DomainError('UNKNOWN_OPERATION','Unknown operation. Run capabilities for available CLI operations.',404);
 }
}
