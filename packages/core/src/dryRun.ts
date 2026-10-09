import type { FlowlyApp } from './app.js';
import type { Actor } from './models.js';
import { DomainError } from './models.js';
import { runTaskBatch } from './taskBatch.js';

// Scope is intentionally limited to DB-only mutations. Browser, image files,
// access-token rotation and network calls are never invoked by simulation.
export const DRY_RUN_OPERATIONS=[
 'project.create','project.update','task.create','task.subtask','task.update',
 'task.transition','task.tests','task.checklist','task.review','task.bug.create',
 'task.bug.resolve','task.post-done-bug','task.batch','qa.required','qa.verdict',
 'qa.waiver.cancel','preview.create','preview.draft','preview.revision.save',
 'preview.context.refresh','screenshot.assign'
] as const;
export function simulateOperation(app:FlowlyApp,operation:string,data:Record<string,any>,actor:Actor){
 if(!(DRY_RUN_OPERATIONS as readonly string[]).includes(operation))
  throw new DomainError('DRY_RUN_UNSUPPORTED',
   'Dry-run is not available for this operation because it may perform external side effects',409,
   {supported:DRY_RUN_OPERATIONS});
 const t=app.tasks,p=app.previews,i=app.images;
 const result=app.store.dryRun(()=>{
  switch(operation){
   case 'project.create':return t.createProject(data as Parameters<typeof t.createProject>[0],actor);
   case 'project.update':return t.updateProject(String(data.id),data,actor);
   case 'task.create':return t.createTask(data as Parameters<typeof t.createTask>[0],actor);
   case 'task.subtask':return t.createTask({...data,parentId:String(data.parentId)} as Parameters<typeof t.createTask>[0],actor);
   case 'task.update':return t.updateTask(String(data.id),data,actor);
   case 'task.transition':return t.transition(String(data.id),data as Parameters<typeof t.transition>[1],actor);
   case 'task.tests':return t.setTests(String(data.id),Boolean(data.passed),String(data.evidence||''),actor);
   case 'task.checklist':return t.checklist(String(data.id),data.action,data,actor);
   case 'task.review':return t.review(String(data.id),data as Parameters<typeof t.review>[1],actor);
   case 'task.bug.create':return t.bugCreate(String(data.id),data as Parameters<typeof t.bugCreate>[1],actor);
   case 'task.bug.resolve':return t.resolveBug(String(data.id),String(data.reason||''),actor);
   case 'task.post-done-bug':return t.linkedPostDoneBug(String(data.id),data as Parameters<typeof t.linkedPostDoneBug>[1],actor);
   case 'task.batch':return runTaskBatch(app.store,t,data as Parameters<typeof runTaskBatch>[2],actor);
   case 'qa.required':return p.setRequired(String(data.id),Boolean(data.required),actor);
   case 'qa.verdict':return p.verdict(String(data.id),data.verdict,data.reason,actor);
   case 'qa.waiver.cancel':return p.cancelWaiver(String(data.id),actor,data.reason);
   case 'preview.create':return p.create(data as Parameters<typeof p.create>[0],actor);
   case 'preview.draft':return p.updateDraft(String(data.id),data,actor);
   case 'preview.revision.save':return p.saveRevision(String(data.id),actor);
   case 'preview.context.refresh':return p.updateContextSnapshot(String(data.id),actor);
   case 'screenshot.assign':return i.assign(String(data.id),data as Parameters<typeof i.assign>[1],actor);
   default:throw new DomainError('DRY_RUN_UNSUPPORTED','Operation not supported for dry-run',409);
  }
 });
 return {eligible:true,simulation:true,result,committed:false};
}
