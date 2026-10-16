import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FlowlyApp} from '../../packages/core/src/app.js';
import {getNextAction} from '../../packages/core/src/skillNextAction.js';
import type {JobRecord} from '../../packages/core/src/models.js';
const actor={actor:'next-action-test',channel:'cli' as const};
async function fixture(fn:(app:FlowlyApp)=>void|Promise<void>){
 const root=mkdtempSync(join(tmpdir(),'flowly-next-')),app=new FlowlyApp(root);
 try{await fn(app);}finally{await app.close();rmSync(root,{recursive:true,force:true});}
}
test('project selection safe for fresh agents and cross-project IDs rejected',()=>fixture(app=>{
 assert.equal(getNextAction(app).reason,'NO_PROJECTS');
 const a=app.tasks.createProject({name:'A'},actor),b=app.tasks.createProject({name:'B'},actor);
 assert.equal(getNextAction(app).reason,'PROJECT_SELECTION_REQUIRED');
 const t=app.tasks.createTask({projectId:a.id,title:'A task'},actor);
 assert.throws(()=>getNextAction(app,{projectId:b.id,taskId:t.id}),{code:'PROJECT_MISMATCH'});
 assert.throws(()=>getNextAction(app,{projectId:'proj_missing'}),{code:'NOT_FOUND'});
}));
test('high risk card recommends the true decision gate, read only',()=>fixture(app=>{
 const p=app.tasks.createProject({name:'Flowly'},actor);
 const task=app.tasks.createTask({projectId:p.id,title:'Public contract',risk:{publicContract:true}},actor);
 const history=app.tasks.activity(p.id);
 const x=getNextAction(app,{projectId:p.id,taskId:task.id,sessionId:'new-chat'});
 assert.equal(x.operation,'engineering.decision.report');
 assert.equal(x.reason,'DECISION_REQUIRED');
 assert.equal(x.ownership.status,'AVAILABLE');
 assert.ok(x.blockers.includes('DECISION_APPROVAL_REQUIRED'));
 assert.equal(app.tasks.task(task.id).status,'backlog');
 assert.deepEqual(app.tasks.activity(p.id),history);
}));
test('a small ready task provides transition then real test evidence hint',()=>fixture(app=>{
 const p=app.tasks.createProject({name:'Tiny'},actor);
 const t=app.tasks.createTask({projectId:p.id,title:'Fix local copy',risk:{
   localScope:true,reversible:true,expectedOutcome:true,acceptanceCriteria:true,verificationStep:true
 }},actor);
 assert.equal(getNextAction(app,{projectId:p.id,taskId:t.id}).reason,'MOVE_TO_TODO');
 app.tasks.transition(t.id,{to:'todo'},actor);
 assert.equal(getNextAction(app,{projectId:p.id,taskId:t.id}).reason,'READY_TO_START');
 app.tasks.transition(t.id,{to:'in-progress'},actor);
 const x=getNextAction(app,{projectId:p.id,taskId:t.id});
 assert.equal(x.reason,'TEST_EVIDENCE_REQUIRED');
 assert.equal(x.operation,'task.tests');
 app.tasks.setTests(t.id,true,'Tested real local change',actor);
 assert.equal(getNextAction(app,{projectId:p.id,taskId:t.id}).reason,'READY_FOR_REVIEW');
 app.tasks.transition(t.id,{to:'ready-for-review'},actor);
 assert.equal(getNextAction(app,{projectId:p.id,taskId:t.id}).reason,'READY_TO_DONE');
}));
test('pending visual QA and QA checklist do not strand completed implementation in progress',()=>fixture(app=>{
 const p=app.tasks.createProject({name:'Visual review handoff'},actor);
 const t=app.tasks.createTask({projectId:p.id,title:'Screen with device QA pending',
  risk:{localScope:true,reversible:true,expectedOutcome:true,acceptanceCriteria:true,verificationStep:true}},actor);
 app.tasks.transition(t.id,{to:'in-progress'},actor);
 app.tasks.checklist(t.id,'add',{text:'Run Figma Visual QA and capture device screenshot'},actor);
 const preview=app.previews.create({projectId:p.id,taskId:t.id,name:'Device screen',
  html:'<main>Screen</main>',screens:[{id:'main',name:'Main',stateId:'default',
   viewport:{device:'mobile',width:390,height:844},required:true}]},actor);
 const revision=app.previews.saveRevision(preview.id,actor);
 app.store.put('preview',{...preview,revisionIds:[revision.id],approvedRevisionId:revision.id});
 app.store.put('qa',{id:'qa_pending',projectId:p.id,taskId:t.id,previewId:preview.id,
  revisionId:revision.id,screenId:'main',stateId:'default',viewport:{device:'mobile',width:390,height:844},
  required:true,updatedAt:'2026-10-16T00:00:00.000Z'});
 assert.equal(getNextAction(app,{projectId:p.id,taskId:t.id}).reason,'TEST_EVIDENCE_REQUIRED');
 app.tasks.setTests(t.id,true,'Kotlin compile and unit tests passed',actor);
 const before=app.tasks.activity(p.id,t.id).length;
 const advice=getNextAction(app,{projectId:p.id,taskId:t.id});
 assert.equal(advice.reason,'READY_FOR_REVIEW');
 assert.equal(advice.params.to,'ready-for-review');
 assert.ok(advice.blockers.includes('REQUIRED_QA_INCOMPLETE'));
 assert.ok(advice.blockers.includes('CHECKLIST_INCOMPLETE'));
 assert.equal(app.tasks.activity(p.id,t.id).length,before,'recommendation must not move task');
 app.tasks.transition(t.id,{to:'ready-for-review'},actor);
 assert.equal(getNextAction(app,{projectId:p.id,taskId:t.id}).reason,'QA_EVIDENCE_REQUIRED');
 assert.throws(()=>app.tasks.transition(t.id,{to:'done'},actor),
  {code:'TRANSITION_BLOCKED'});
 assert.equal(app.tasks.task(t.id).status,'ready-for-review');
}));

test('small skip-review still passes through Ready for Review before suggested Done',()=>fixture(app=>{
 const p=app.tasks.createProject({name:'Small skip'},actor);
 const t=app.tasks.createTask({projectId:p.id,title:'Minor fix',reviewMode:'skip-review',
  risk:{localScope:true,reversible:true,expectedOutcome:true,acceptanceCriteria:true,verificationStep:true}},actor);
 app.tasks.transition(t.id,{to:'in-progress'},actor);
 app.tasks.setTests(t.id,true,'Focused checks green',actor);
 assert.equal(getNextAction(app,{projectId:p.id,taskId:t.id}).reason,'READY_FOR_REVIEW');
 app.tasks.transition(t.id,{to:'ready-for-review'},actor);
 assert.equal(getNextAction(app,{projectId:p.id,taskId:t.id}).reason,'READY_TO_DONE');
}));

test('multiple cards return bounded candidates without implicit choice',()=>fixture(app=>{
 const p=app.tasks.createProject({name:'Multiple'},actor);
 app.tasks.createTask({projectId:p.id,title:'One'},actor);
 app.tasks.createTask({projectId:p.id,title:'Two'},actor);
 const x=getNextAction(app,{projectId:p.id});
 assert.equal(x.reason,'TASK_SELECTION_REQUIRED');
 assert.equal(x.candidates?.length,2);
 assert.equal(x.operation,'task.list');
}));
test('interrupted persistent Job is inspected instead of silently restarted',()=>fixture(app=>{
 const p=app.tasks.createProject({name:'Pending'},actor),t=app.tasks.createTask({projectId:p.id,title:'Capture'},actor);
 const job:JobRecord={id:'job_interrupted',projectId:p.id,operation:'recorder.capture',input:{taskId:t.id},
   requestHash:'test',actor,status:'interrupted',progress:0,attempts:1,
   createdAt:'2026-10-12T00:00:00Z',updatedAt:'2026-10-12T00:00:00Z'};
 app.store.put('job',job);
 const before=app.tasks.activity(p.id);
 const x=getNextAction(app,{projectId:p.id,taskId:t.id});
 assert.equal(x.reason,'JOB_INTERRUPTED');assert.equal(x.operation,'job.status');
 assert.equal(x.params.id,job.id);
 assert.deepEqual(app.tasks.activity(p.id),before);
}));
test('approved high risk parallel plan exposes runnable DAG work',()=>fixture(app=>{
 const p=app.tasks.createProject({name:'DAG'},actor),t=app.tasks.createTask({projectId:p.id,title:'Shared runtime',risk:{sharedRuntimeConfig:true}},actor);
 app.engineering.writeDecision(t.id,{requirements:'Runtime',currentArchitecture:'Existing CLI',
  alternatives:[{id:'a',title:'Inline',benefits:'Simple',drawbacks:'Coupled',effort:'Small'},
    {id:'b',title:'Module',benefits:'Isolated',drawbacks:'More files',effort:'Medium'}],
  impacts:'Boundary',recommendation:'Module'},actor);
 app.engineering.setPlan(t.id,[{id:'code',title:'Code',ownedPaths:['packages/core'],dependsOn:[],status:'pending'},
   {id:'tests',title:'Tests',ownedPaths:['tests/skills'],dependsOn:[],status:'pending'}],actor);
 app.engineering.resolveDecision(t.id,'approve','Approved for tests','b',actor);
 app.tasks.transition(t.id,{to:'in-progress'},actor);
 const next=getNextAction(app,{projectId:p.id,taskId:t.id});
 assert.equal(next.reason,'RUNNABLE_WORKSTREAMS');
 assert.deepEqual(next.prerequisites,['code','tests']);
}));
