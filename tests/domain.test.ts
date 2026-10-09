import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { FlowlyApp } from '../packages/core/src/app.js';
import { DomainError, type Comparison } from '../packages/core/src/models.js';
import { assessRisk } from '../packages/core/src/workflow.js';

const cli={actor:'test-agent',channel:'cli' as const},user={actor:'test-user',channel:'web' as const};
async function fixture<T>(fn:(app:FlowlyApp,root:string)=>Promise<T>|T){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-test-'));
 const app=new FlowlyApp(root);
 try{return await fn(app,root);}finally{await app.close();fs.rmSync(root,{recursive:true,force:true});}
}
const lowRisk={
 localScope:true,reversible:true,expectedOutcome:true,acceptanceCriteria:true,verificationStep:true
};
const exampleImage=async()=>sharp({create:{width:30,height:25,channels:3,background:{r:64,g:125,b:189}}}).png().toBuffer();
const assertBlocked=(fn:()=>unknown,code:string)=>{
 assert.throws(fn,(error:unknown)=>error instanceof DomainError&&error.code===code);
};

test('deterministic Smart Review classification and terminal Done',async()=>{
 assert.equal(assessRisk({risk:lowRisk}),'LOW');
 assert.equal(assessRisk({risk:{...lowRisk,publicContract:true}}),'HIGH');
 assert.equal(assessRisk({risk:{localScope:true}}),'MEDIUM');
 await fixture(async app=>{
  const project=app.tasks.createProject({name:'Example'},cli);
  const task=app.tasks.createTask({projectId:project.id,title:'Local change',risk:lowRisk},cli);
  assertBlocked(()=>app.tasks.transition(task.id,{to:'done'},cli),'TRANSITION_BLOCKED');
  app.tasks.setTests(task.id,true,'unit tests passed',cli);
  const finished=app.tasks.transition(task.id,{to:'done'},cli);
  assert.equal(finished.status,'done');
  assertBlocked(()=>app.tasks.transition(task.id,{to:'in-progress'},user),'TRANSITION_BLOCKED');
  assertBlocked(()=>app.tasks.updateTask(task.id,{title:'Change history'},cli),'DONE_IS_TERMINAL');
  assert.equal(app.tasks.activity(project.id,task.id).some(e=>e.action==='transition'&&e.to==='done'),true);
 });
});

test('parent Force Done only bypasses unfinished child gate and logs context',async()=>{
 await fixture(async app=>{
  const p=app.tasks.createProject({name:'Subtasks'},cli);
  const parent=app.tasks.createTask({projectId:p.id,title:'Parent',risk:lowRisk},cli);
  const child=app.tasks.createTask({projectId:p.id,title:'Child',parentId:parent.id,risk:lowRisk},cli);
  app.tasks.setTests(parent.id,true,'verification',cli);
  assert.equal(app.tasks.blockers(parent.id).includes('UNFINISHED_SUBTASKS'),true);
  assertBlocked(()=>app.tasks.transition(parent.id,{to:'done'},cli),'TRANSITION_BLOCKED');
  assertBlocked(()=>app.tasks.transition(parent.id,{to:'done',forceDone:true},cli),'TRANSITION_BLOCKED');
  const finished=app.tasks.transition(parent.id,{to:'done',forceDone:true,reason:'Explicit operator override'},cli);
  assert.equal(finished.status,'done');
  assert.equal(app.tasks.task(child.id).status,'backlog');
  const forced=app.tasks.activity(p.id,parent.id).find(e=>e.action==='force-done');
  assert.equal((forced?.evidence?.unfinishedChildren as Array<{id:string}>)[0]?.id,child.id);
 });
});

test('risk review, embedded Bug deduplication and reject -> fix -> re-review',async()=>{
 await fixture(async app=>{
  const p=app.tasks.createProject({name:'Review'},cli);
  const task=app.tasks.createTask({projectId:p.id,title:'Public contract',risk:{publicContract:true}},cli);
  app.tasks.setTests(task.id,true,'build green',cli);
  app.tasks.transition(task.id,{to:'ready-for-review'},cli);
  const first=app.tasks.review(task.id,{verdict:'reject',reason:'API contract mismatch',fingerprint:'api-123'},user);
  assert.equal(first.task.status,'in-progress'); assert.ok(first.bug);
  app.tasks.transition(task.id,{to:'ready-for-review'},cli);
  const second=app.tasks.review(task.id,{verdict:'reject',reason:'Same mismatch',fingerprint:'api-123'},user);
  assert.equal(first.bug?.id,second.bug?.id);
  assert.equal(second.bug?.occurrences.length,2);
  app.tasks.resolveBug(first.bug!.id,'Fixed with contract test',cli);
  app.tasks.transition(task.id,{to:'ready-for-review'},cli);
  app.tasks.review(task.id,{verdict:'approve',reason:'Verified again'},user);
  assert.equal(app.tasks.transition(task.id,{to:'done'},cli).status,'done');
 });
});

test('Preview Approved revision, case waiver, upload retains waiver, screenshot cleanup tombstone',async()=>{
 await fixture(async app=>{
  const project=app.tasks.createProject({name:'UI'},user);
  const task=app.tasks.createTask({projectId:project.id,title:'Screen',risk:lowRisk},cli);
  app.tasks.setTests(task.id,true,'unit tests',cli);
  const view={id:'login',name:'Login',stateId:'error',viewport:{width:390,height:800,device:'mobile' as const},required:true};
  const preview=app.previews.create({projectId:project.id,taskId:task.id,name:'Login flow',
   html:'<button>Continue</button>',screens:[view]},cli);
  const frozen=app.previews.saveRevision(preview.id,cli);
  const approved=await app.previews.approve(preview.id,frozen.id,user);
  assert.equal(approved.cases.length,1);
  const qa=approved.cases[0]!;
  assert.equal(qa.required,true);
  app.previews.verdict(qa.id,'WAIVED','Intentional known variance',cli);
  assert.equal(app.tasks.blockers(task.id).includes('REQUIRED_QA_INCOMPLETE'),false);
  const img=await exampleImage();
  const first=await app.images.ingest({source:'external',sourceId:'phone',captureId:'retry-100',
   projectId:project.id,taskId:task.id,screenId:'login',caseId:qa.id,data:img},cli);
  assert.equal(first.duplicate,false);assert.ok(first.comparison);
  assert.equal(app.previews.case(qa.id).verdict,'WAIVED');
  assert.equal(app.tasks.blockers(task.id).includes('REQUIRED_QA_INCOMPLETE'),false);
  assert.equal(app.store.get<Comparison>('comparison',first.comparison!.id)?.status,'awaiting-verdict');
  const duplicate=await app.images.ingest({source:'external',sourceId:'phone',captureId:'retry-100',
   data:img},cli);
  assert.equal(duplicate.screenshot.id,first.screenshot.id);
  assert.equal(duplicate.duplicate,true);
  assert.equal(app.images.list(project.id).length,1);
  const result=app.images.cleanup([first.screenshot.id],user);
  assert.equal(result.deleted,1);assert.equal(result.skipped,0);
  assert.equal(app.images.screenshot(first.screenshot.id).status,'deleted');
  const tombstone=await app.images.ingest({source:'external',sourceId:'phone',captureId:'retry-100',
   data:img},cli);
  assert.equal(tombstone.screenshot.status,'deleted');
  assert.equal(tombstone.duplicate,true);
  assert.equal(app.images.inbox().length,0);
  assert.equal(app.previews.getRevision(frozen.id).html,'<button>Continue</button>');
  app.previews.updateDraft(preview.id,{html:'<h1>New draft</h1>'},cli);
  assert.equal(app.previews.getRevision(frozen.id).html,'<button>Continue</button>');
 });
});

test('confirmed QA PASS protects original across cleanup; QA FAIL adds embedded Bug before Done',async()=>{
 await fixture(async app=>{
  const project=app.tasks.createProject({name:'Visual QA'},cli);
  const task=app.tasks.createTask({projectId:project.id,title:'Preview',risk:lowRisk},cli);
  const screen={id:'home',name:'Home',stateId:'default',viewport:{width:800,height:600,device:'desktop' as const}};
  const preview=app.previews.create({projectId:project.id,taskId:task.id,name:'Home',html:'<h1>Home</h1>',screens:[screen]},cli);
  const rev=app.previews.saveRevision(preview.id,cli),qa=(await app.previews.approve(preview.id,rev.id,cli)).cases[0]!;
  const image=await exampleImage();
  const incoming=await app.images.ingest({source:'manual',data:image,projectId:project.id,taskId:task.id,screenId:'home'},user);
  app.previews.verdict(qa.id,'PASS','Checked',cli);
  const protectedResult=app.images.cleanup([incoming.screenshot.id],user);
  assert.equal(protectedResult.deleted,0);assert.equal(protectedResult.skipped,1);
  assert.match(protectedResult.protectedOrSkipped[0]!.references.join(','),/QA/);
  const other=await app.images.ingest({source:'manual',data:image,projectId:project.id,taskId:task.id,screenId:'home'},user);
  const failed=app.previews.verdict(qa.id,'FAIL','Mismatch confirmed',user);
  assert.ok(failed.bug);
  assert.equal(app.tasks.task(task.id).status,'backlog');
  assert.equal(app.store.list('bug',{taskId:task.id}).length,1);
  const mixed=app.images.cleanup([incoming.screenshot.id,other.screenshot.id],user);
  assert.equal(mixed.deleted,0);assert.equal(mixed.skipped,2);
 });
});

test('post-Done QA FAIL never reopens origin and makes independent top-level linked Bug',async()=>{
 await fixture(async app=>{
  const project=app.tasks.createProject({name:'Historical QA'},cli);
  const task=app.tasks.createTask({projectId:project.id,title:'Done screen',risk:lowRisk},cli);
  const screen={id:'panel',name:'Panel',stateId:'ready',viewport:{width:800,height:600,device:'desktop' as const}};
  const preview=app.previews.create({projectId:project.id,taskId:task.id,name:'Panel',html:'<h1>Done</h1>',screens:[screen]},cli);
  const rev=app.previews.saveRevision(preview.id,cli),qa=(await app.previews.approve(preview.id,rev.id,cli)).cases[0]!;
  const data=await exampleImage();
  await app.images.ingest({source:'manual',projectId:project.id,taskId:task.id,screenId:'panel',data},cli);
  app.previews.verdict(qa.id,'PASS','Initial green',cli);
  app.tasks.setTests(task.id,true,'tests green',cli);
  app.tasks.transition(task.id,{to:'done'},cli);
  await app.images.ingest({source:'manual',projectId:project.id,taskId:task.id,screenId:'panel',data},cli);
  assert.equal(app.previews.case(qa.id).verdict,undefined);
  const fail=app.previews.verdict(qa.id,'FAIL','New defect after Done',cli);
  const linked=fail.bug as {originTaskId?:string;parentId?:string;status:string;type:string};
  assert.equal(linked.originTaskId,task.id);assert.equal(linked.parentId,undefined);
  assert.equal(linked.status,'backlog');assert.equal(linked.type,'bug');
  assert.equal(app.tasks.task(task.id).status,'done');
  assert.equal(app.tasks.activity(project.id,task.id).some(e=>e.action==='qa.verdict'&&e.evidence?.verdict==='PASS'),true);
 });
});

test('invalid images, missing sender namespace and token regeneration do not alter evidence',async()=>{
 await fixture(async (app,root)=>{
  const project=app.tasks.createProject({name:'Secure'},cli);
  const token=app.images.token();
  assert.equal(app.images.authorize(token),true);
  assert.equal(app.images.authorize('wrong'),false);
  assert.equal(app.images.token(),token);
  await assert.rejects(()=>app.images.ingest({source:'external',data:Buffer.from('GIF89a'),projectId:project.id},cli),
   (e:unknown)=>e instanceof DomainError && e.code==='INVALID_IMAGE');
  await assert.rejects(()=>app.images.ingest({source:'external',data:Buffer.from('still invalid'),captureId:'id123',projectId:project.id},cli),
   (e:unknown)=>e instanceof DomainError && e.code==='SOURCE_ID_REQUIRED');
  await assert.rejects(()=>app.images.ingest({source:'external',data:Buffer.alloc(25*1024*1024+1)},cli),
   (e:unknown)=>e instanceof DomainError && e.code==='IMAGE_TOO_LARGE');
  assert.equal(app.images.list(project.id).length,0);
  assert.equal(app.images.regenerateToken(true,user).regenerated,true);
  assert.equal(app.images.authorize(token),false);
  assert.equal(app.images.authorize(app.images.token()),true);
 });
});

test('Preview approval enforces rendered critical QA and explicit warning acceptance',async()=>{
 await fixture(async app=>{
  const project=app.tasks.createProject({name:'Quality gate'},cli);
  const task=app.tasks.createTask({projectId:project.id,title:'Layout verification',risk:lowRisk},cli);
  const viewport={width:390,height:800,device:'mobile' as const};
  const target={id:'home',name:'Home',stateId:'default',viewport};
  const preview=app.previews.create({projectId:project.id,taskId:task.id,name:'Quality',
   html:'<div style="width:1000px">Confirmed overflow</div>',screens:[target]},cli);
  const bad=app.previews.saveRevision(preview.id,cli);
  await assert.rejects(()=>app.previews.approve(preview.id,bad.id,cli),
   (e:unknown)=>e instanceof DomainError&&e.code==='PREVIEW_QUALITY_BLOCKED');
  assert.equal(app.previews.get(preview.id).approvedRevisionId,undefined);
  // Offscreen advisory element without root horizontal overflow: explicit acknowledgement is required.
  app.previews.updateDraft(preview.id,{html:'<button>Continue</button><div id="hint" style="position:absolute;left:-100px;width:80px;height:20px">Help</div>'},cli);
  const revision=app.previews.saveRevision(preview.id,cli);
  await assert.rejects(()=>app.previews.approve(preview.id,revision.id,cli),
   (e:unknown)=>e instanceof DomainError&&e.code==='PREVIEW_WARNINGS_NEED_ACCEPTANCE');
  await assert.rejects(()=>app.previews.approve(preview.id,revision.id,cli,{acceptWarnings:true}),
   (e:unknown)=>e instanceof DomainError&&e.code==='PREVIEW_WARNINGS_NEED_ACCEPTANCE');
  const approved=await app.previews.approve(preview.id,revision.id,cli,{acceptWarnings:true,warningReason:'Intentionally offscreen decorative element'});
  assert.equal(approved.revision.approvedQuality?.warnings.length!>0,true);
  assert.equal(approved.revision.approvedQuality?.acceptanceReason,'Intentionally offscreen decorative element');
  assert.equal(app.store.history(project.id,task.id).some(e=>e.action==='preview.approve'&&e.evidence?.qualityPassed),true);
 });
});
