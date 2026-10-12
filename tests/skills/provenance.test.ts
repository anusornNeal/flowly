import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FlowlyApp} from '../../packages/core/src/app.js';
import {SkillProvenance} from '../../packages/core/src/skillProvenance.js';
const actor={actor:'agent-a',channel:'cli' as const},foreign={actor:'other-agent',channel:'cli' as const};
async function fixture(fn:(app:FlowlyApp,trace:SkillProvenance)=>void|Promise<void>){
 const root=mkdtempSync(join(tmpdir(),'flowly-trace-')),app=new FlowlyApp(root);
 try{await fn(app,new SkillProvenance(app.store,app.skills));}finally{await app.close();rmSync(root,{recursive:true,force:true});}
}
test('read-only advice selection creates an auditable trace but no fake task completion',()=>fixture((app,trace)=>{
 const p=app.tasks.createProject({name:'Audit'},actor);
 const skill=app.skills.get({id:'review'}).manifest;
 const x=trace.record({projectId:p.id,skillId:'review',version:skill.version,sha256:skill.sha256,
  reason:'REVIEW',operation:'guide',sessionId:'new-chat'},actor);
 assert.equal(x.status,'selected');
 assert.equal(trace.list(p.id).length,1);
 assert.equal(trace.list(p.id)[0]?.skillId,'review');
 assert.equal(app.tasks.listTasks(p.id).length,0);
}));
test('mutation trace must correlate to a real same-actor authoritative activity',()=>fixture((app,trace)=>{
 const p=app.tasks.createProject({name:'Task'},actor);
 const task=app.tasks.createTask({projectId:p.id,title:'Task',risk:{
  localScope:true,reversible:true,expectedOutcome:true,acceptanceCriteria:true,verificationStep:true}},actor);
 const skill=app.skills.get({id:'implementation'}).manifest;
 const base={projectId:p.id,taskId:task.id,skillId:skill.id,version:skill.version,sha256:skill.sha256,
  reason:'IMPLEMENTATION' as const,operation:'task.transition'};
 assert.throws(()=>trace.record(base,actor),{code:'SOURCE_ACTIVITY_REQUIRED'});
 app.tasks.transition(task.id,{to:'todo'},actor);
 const activity=app.tasks.activity(p.id,task.id).find(x=>x.action==='transition');
 assert.ok(activity);
 assert.throws(()=>trace.record({...base,sourceActivityId:activity?.id},foreign),{code:'ACTIVITY_NOT_VERIFIED'});
 const proof=trace.record({...base,sourceActivityId:activity?.id},actor);
 assert.equal(proof.status,'correlated');
 assert.equal(proof.sourceActivityId,activity?.id);
 assert.equal(trace.report(p.id,task.id).selectionHistory[0]?.id,proof.id);
 assert.equal(app.tasks.task(task.id).status,'todo');
}));
test('untrusted or disabled revisions and project mismatch rejected',()=>fixture((app,trace)=>{
 const p=app.tasks.createProject({name:'A'},actor),q=app.tasks.createProject({name:'B'},actor);
 const t=app.tasks.createTask({projectId:p.id,title:'A'},actor);
 const skill=app.skills.get({id:'skill-router'}).manifest;
 const common={projectId:q.id,taskId:t.id,skillId:skill.id,version:skill.version,
  sha256:skill.sha256,reason:'NO_MATCH' as const,operation:'skills.route'};
 assert.throws(()=>trace.record(common,actor),{code:'PROJECT_MISMATCH'});
 assert.throws(()=>trace.record({...common,projectId:p.id,sha256:'f'.repeat(64)},actor),{code:'SKILL_REVISION_MISMATCH'});
 app.skills.setEnabled({id:skill.id,enabled:false},actor);
 assert.throws(()=>trace.record({...common,projectId:p.id},actor),{code:'SKILL_REVISION_MISMATCH'});
}));
test('do not accept secrets or evidence text in audit identifiers',()=>fixture((app,trace)=>{
 const p=app.tasks.createProject({name:'Redacted'},actor);
 const skill=app.skills.get({id:'review'}).manifest;
 const common={projectId:p.id,skillId:skill.id,version:skill.version,sha256:skill.sha256,
  reason:'REVIEW' as const,operation:'guide'};
 assert.throws(()=>trace.record({...common,evidenceIds:['bearer token secret value']},actor),{code:'INVALID_TRACE_EVIDENCE'});
 assert.throws(()=>trace.record({...common,commitHash:'abc'},actor),{code:'INVALID_COMMIT_HASH'});
 assert.equal(trace.list(p.id).length,0);
}));
