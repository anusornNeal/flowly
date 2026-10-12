import test from 'node:test';
import assert from 'node:assert/strict';
import { coldStartRoutingCases, runSkillEngineEvaluation } from '../../scripts/verify-skill-engine.js';
test('at least 95% correct next specialist across representative fresh agent intents',async()=>{
  const result=await runSkillEngineEvaluation();
  assert.ok(result.cases>=30);
  assert.ok(result.accuracy>=0.95,JSON.stringify(result.failures));
  assert.equal(result.correct,result.cases-result.failures.length);
  assert.ok(result.routeP95Ms>=0);
});
test('fresh projects explicit selection; side effect-free next-action and project isolation',async()=>{
  const r=await runSkillEngineEvaluation();
  assert.equal(r.coldStart,'passed');
  assert.equal(r.crossProject,'passed');
  assert.equal(r.gateBypassCount,0);
  assert.equal(r.discoveryCalls,3);
});
test('evaluation corpus is labelled, stable and has non-duplicate cases',()=>{
  const labels=coldStartRoutingCases.map(x=>x.label);
  assert.equal(new Set(labels).size,labels.length);
  assert.ok(labels.some(x=>x.includes('Thai')));
  assert.ok(labels.some(x=>x.includes('English')));
});
