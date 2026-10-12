import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FlowlyApp, execute, capabilities } from '../packages/core/src/app.js';
import { DomainError } from '../packages/core/src/models.js';
import type { DecisionReportInput, ImplementationReportInput, Workstream } from '../packages/core/src/engineering.js';

const agent={actor:'implementation-agent',channel:'cli' as const};
const owner={actor:'decision-maker',channel:'web' as const};
const report:DecisionReportInput={
 requirements:'Support reports and safe parallel execution',
 currentArchitecture:'Existing task gates and SQLite audit trail',
 alternatives:[
  {id:'a',title:'Extend task records',benefits:'Local and transactional',drawbacks:'Task records grow',effort:'2 days'},
  {id:'b',title:'Separate reports store',benefits:'Independent reporting',drawbacks:'More joins',effort:'3 days'}
 ],
 impacts:'Review risk, maintainability, performance and compatibility',
 recommendation:'Choose a to reuse existing audit and store'
};
const streams:Workstream[]=[
 {id:'domain',title:'Domain',ownedPaths:['packages/core'],dependsOn:[],status:'pending'},
 {id:'ui',title:'UI',ownedPaths:['apps/web'],dependsOn:[],status:'pending'},
 {id:'integration',title:'Integration',ownedPaths:['tests'],dependsOn:['domain','ui'],status:'pending'}
];
const implementation:ImplementationReportInput={
 requirements:'Engineering reports and decision gate',
 changes:[{path:'packages/core/src/engineering.ts',summary:'Add report and parallel policy'}],
 technicalDecisions:'Use record-local report revisions with audited explicit approvals',
 alternativesAndTradeoffs:'Separate table rejected due to implementation overhead',
 verification:'npm run typecheck and npm test, outputs inspected',
 deviations:'None',
 commits:['abc1234']
};
async function fixture<T>(fn:(app:FlowlyApp)=>Promise<T>|T){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-engineering-'));
 const app=new FlowlyApp(root);
 try{return await fn(app);}finally{await app.close();fs.rmSync(root,{recursive:true,force:true});}
}
function blocked(fn:()=>unknown,code:string) {
 assert.throws(fn,(e:unknown)=>e instanceof DomainError&&e.code===code);
}
test('Large projects use explicit decision, parallel streams and implementation evidence gates',async()=>{
 await fixture(app=>{
  const project=app.tasks.createProject({name:'Parallel'},agent);
  const task=app.tasks.createTask({projectId:project.id,title:'Architecture',risk:{publicContract:true}},agent);
  assert.equal(app.engineering.next(task.id).strategy,'parallel-first');
  blocked(()=>app.tasks.transition(task.id,{to:'in-progress'},agent),'DECISION_GATE_BLOCKED');
  app.engineering.writeDecision(task.id,report,agent);
  app.engineering.setPlan(task.id,streams,agent);
  blocked(()=>app.tasks.transition(task.id,{to:'in-progress'},agent),'DECISION_GATE_BLOCKED');
  blocked(()=>app.engineering.resolveDecision(task.id,'approve','yes','unknown',owner),'APPROACH_REQUIRED');
  app.engineering.resolveDecision(task.id,'approve','Simplest maintainable choice','a',owner);
  assert.equal(app.engineering.next(task.id).ready.length,2);
  app.tasks.transition(task.id,{to:'in-progress'},agent);
  blocked(()=>app.engineering.setStreamStatus(task.id,'integration','in-progress',agent),'STREAM_DEPENDENCIES_INCOMPLETE');
  blocked(()=>app.engineering.setStreamStatus(task.id,'domain','done',agent,'evidence'),'STREAM_START_REQUIRED');
  app.engineering.setStreamStatus(task.id,'domain','in-progress',agent);
  blocked(()=>app.engineering.setStreamStatus(task.id,'domain','done',agent),'STREAM_EVIDENCE_REQUIRED');
  blocked(()=>app.engineering.setPlan(task.id,streams,agent),'PLAN_LOCKED');
  app.engineering.setStreamStatus(task.id,'domain','done',agent,'Domain tests passed');
  app.engineering.setStreamStatus(task.id,'ui','in-progress',agent);
  app.engineering.setStreamStatus(task.id,'ui','done',agent,'UI build passed');
  assert.deepEqual(app.engineering.next(task.id).ready.map(s=>s.id),['integration']);
  app.engineering.setStreamStatus(task.id,'integration','in-progress',agent);
  app.engineering.setStreamStatus(task.id,'integration','done',agent,'Integrated regression suite passed');
  app.tasks.setTests(task.id,true,'Focused tests passed',agent);
  blocked(()=>app.tasks.transition(task.id,{to:'ready-for-review'},agent),'ENGINEERING_GATE_BLOCKED');
  app.engineering.writeImplementation(task.id,implementation,agent);
  app.tasks.transition(task.id,{to:'ready-for-review'},agent);
  app.tasks.review(task.id,{verdict:'approve',reason:'Evidence reviewed'},owner);
  assert.equal(app.tasks.transition(task.id,{to:'done'},agent).status,'done');
  blocked(()=>app.engineering.writeImplementation(task.id,implementation,agent),'DONE_IS_TERMINAL');
  assert.ok(app.tasks.activity(project.id,task.id).some(a=>a.action==='engineering.decision.approve'));
  assert.ok(app.tasks.activity(project.id,task.id).some(a=>a.action==='engineering.implementation.report'));
 });
});
test('New report revision invalidates the previous explicit decision',async()=>{
 await fixture(app=>{
  const p=app.tasks.createProject({name:'Revisions'},agent);
  const task=app.tasks.createTask({projectId:p.id,title:'Large'},agent);
  app.engineering.updateSize(task.id,'large',agent);
  app.engineering.setPlan(task.id,streams,agent);
  app.engineering.writeDecision(task.id,report,agent);
  app.engineering.resolveDecision(task.id,'approve','Proceed','a',owner);
  app.engineering.writeDecision(task.id,{...report,recommendation:'Reconsider option b'},agent);
  assert.ok(app.tasks.blockers(task.id).includes('DECISION_APPROVAL_REQUIRED'));
  blocked(()=>app.tasks.transition(task.id,{to:'in-progress'},agent),'DECISION_GATE_BLOCKED');
  app.engineering.resolveDecision(task.id,'approve','Approved revised report','b',owner);
  assert.ok(!app.tasks.blockers(task.id).includes('DECISION_APPROVAL_REQUIRED'));
 });
});
test('Parallel scheduling rejects cycles and independent ownership conflicts',async()=>{
 await fixture(app=>{
  const p=app.tasks.createProject({name:'Plan'},agent);
  const t=app.tasks.createTask({projectId:p.id,title:'Graph'},agent);
  blocked(()=>app.engineering.setPlan(t.id,[
   {...streams[0]!,dependsOn:['ui']},{...streams[1]!,dependsOn:['domain']}
  ],agent),'PLAN_CYCLE');
  blocked(()=>app.engineering.setPlan(t.id,[
   {...streams[0]!,ownedPaths:['src/shared.ts']},{...streams[1]!,ownedPaths:['SRC\\shared.ts']}
  ],agent),'PARALLEL_PATH_CONFLICT');
  blocked(()=>app.engineering.setPlan(t.id,[
   {...streams[0]!,ownedPaths:['src']},{...streams[1]!,ownedPaths:['src/shared.ts']}
  ],agent),'PARALLEL_PATH_CONFLICT');
  app.engineering.setPlan(t.id,[
   {...streams[0]!,ownedPaths:['src/shared.ts']},{...streams[1]!,ownedPaths:['src/shared.ts'],dependsOn:['domain']}
  ],agent);
  assert.equal(app.engineering.next(t.id).ready.length,1);
 });
});
test('Report validation and public CLI/API contracts reject unsupported evidence',async()=>{
 await fixture(async app=>{
  const p=app.tasks.createProject({name:'CLI'},agent);
  const t=app.tasks.createTask({projectId:p.id,title:'Evidence'},agent);
  blocked(()=>app.engineering.writeDecision(t.id,{...report,alternatives:[]},agent),'ALTERNATIVES_REQUIRED');
  blocked(()=>app.engineering.writeImplementation(t.id,{...implementation,commits:['not-a-commit']},agent),'INVALID_COMMIT');
  await assert.rejects(execute(app,'engineering.git.inspect',{id:t.id,commit:'not-a-commit'},agent),
   (e:unknown)=>e instanceof DomainError&&e.code==='INVALID_COMMIT');
  await assert.rejects(execute(app,'engineering.git.inspect',{id:t.id,commit:'abcdef0'},agent),
   (e:unknown)=>e instanceof DomainError&&e.code==='SOURCE_PATH_REQUIRED');
  assert.equal(app.tasks.task(t.id).engineering?.size,'auto');
  const result=await execute(app,'engineering.decision.report',{id:t.id,report},agent);
  assert.ok(result);
  assert.ok(capabilities().operations.includes('engineering.parallel.next'));
  assert.ok(app.tasks.task(t.id).engineering?.decision);
 });
});
