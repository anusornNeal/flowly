import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FlowlyApp } from '../../packages/core/src/app.js';
import { preflightSkillAction } from '../../packages/core/src/skillGateAdapter.js';

const actor={actor:'gate-test',channel:'cli' as const};
async function fixture(fn:(app:FlowlyApp)=>void|Promise<void>) {
  const root=mkdtempSync(join(tmpdir(),'flowly-preflight-'));
  const app=new FlowlyApp(root);
  try {await fn(app);} finally {await app.close();rmSync(root,{recursive:true,force:true});}
}
test('real transition validator can preflight without changing Task or audit',()=>fixture(app=>{
  const p=app.tasks.createProject({name:'A'},actor);
  const t=app.tasks.createTask({projectId:p.id,title:'Local',risk:{
    localScope:true,reversible:true,expectedOutcome:true,acceptanceCriteria:true,verificationStep:true}},actor);
  const before=app.tasks.activity(p.id),task=app.tasks.task(t.id);
  const result=preflightSkillAction(app,{projectId:p.id,taskId:t.id,
    operation:'task.transition',to:'in-progress'});
  assert.equal(result.preflight,'passed');
  assert.equal(result.authoritative,false);
  assert.equal(app.tasks.task(t.id).status,task.status);
  assert.deepEqual(app.tasks.activity(p.id),before);
}));
test('high-risk card blocks progress until actual approved decision and plan',()=>fixture(app=>{
 const p=app.tasks.createProject({name:'High'},actor);
 const t=app.tasks.createTask({projectId:p.id,title:'Public API',risk:{publicContract:true}},actor);
 const before=app.tasks.activity(p.id);
 const x=preflightSkillAction(app,{projectId:p.id,taskId:t.id,operation:'task.transition',to:'in-progress'});
 assert.equal(x.preflight,'blocked');
 assert.equal(x.reasonCode,'DECISION_GATE_BLOCKED');
 assert.ok(x.blockers.includes('DECISION_APPROVAL_REQUIRED'));
 assert.ok(x.blockers.includes('PARALLEL_PLAN_REQUIRED'));
 assert.deepEqual(app.tasks.activity(p.id),before);
}));
test('neither tests nor independent review are auto-approved by a passing preflight',()=>fixture(app=>{
 const p=app.tasks.createProject({name:'Review'},actor);
 const t=app.tasks.createTask({projectId:p.id,title:'Needs review',risk:{
  localScope:true,reversible:true,expectedOutcome:true,acceptanceCriteria:true,verificationStep:true
 },reviewMode:'require-review'},actor);
 const x=preflightSkillAction(app,{projectId:p.id,taskId:t.id,operation:'task.transition',to:'done'});
 assert.equal(x.preflight,'blocked');
 assert.ok(x.blockers.includes('TESTS_NOT_PASSED'));
 assert.ok(x.blockers.includes('REVIEW_NOT_APPROVED'));
 assert.equal(app.tasks.task(t.id).reviewApproved,false);
 assert.equal(app.tasks.task(t.id).testsPassed,false);
 const qa=preflightSkillAction(app,{projectId:p.id,taskId:t.id,operation:'qa.verdict'});
 assert.equal(qa.preflight,'explicit-action-required');
 assert.equal(qa.authoritative,false);
}));
test('explicit operation and task project boundary remain required',()=>fixture(app=>{
 const a=app.tasks.createProject({name:'A'},actor),b=app.tasks.createProject({name:'B'},actor);
 const t=app.tasks.createTask({projectId:a.id,title:'Task'},actor);
 assert.throws(()=>preflightSkillAction(app,{projectId:b.id,taskId:t.id,operation:'qa.verdict'}),{code:'PROJECT_MISMATCH'});
 assert.throws(()=>preflightSkillAction(app,{projectId:a.id,taskId:t.id,operation:'task.transition'}),{code:'TARGET_STATUS_REQUIRED'});
}));
