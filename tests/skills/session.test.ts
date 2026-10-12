import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FlowlyApp} from '../../packages/core/src/app.js';
import {SkillSessions} from '../../packages/core/src/skillSession.js';
const actor={actor:'worker-a',channel:'cli' as const},other={actor:'worker-b',channel:'cli' as const};
async function fixture(fn:(app:FlowlyApp,root:string)=>void|Promise<void>){
 const root=mkdtempSync(join(tmpdir(),'flowly-leases-')),app=new FlowlyApp(root);
 try{await fn(app,root);}finally{await app.close();rmSync(root,{recursive:true,force:true});}
}
function activeTask(app:FlowlyApp,projectId:string,title:string,paths=['src/one','tests/one']){
 const task=app.tasks.createTask({projectId,title,risk:{
  localScope:true,reversible:true,expectedOutcome:true,acceptanceCriteria:true,verificationStep:true}},actor);
 app.engineering.setPlan(task.id,[
  {id:'code',title:'Code',ownedPaths:[paths[0]!],dependsOn:[],status:'pending'},
  {id:'proof',title:'Tests',ownedPaths:[paths[1]!],dependsOn:[],status:'pending'},
 ],actor);
 app.tasks.transition(task.id,{to:'todo'},actor);
 app.tasks.transition(task.id,{to:'in-progress'},actor);
 app.engineering.setStreamStatus(task.id,'code','in-progress',actor);
 return task;
}
test('same actor/session idempotently resumes and a foreign session cannot steal WIP',()=>fixture(app=>{
 const p=app.tasks.createProject({name:'Leases'},actor),t=activeTask(app,p.id,'First');
 const sessions=new SkillSessions(app.store);
 const first=sessions.claim({projectId:p.id,taskId:t.id,streamId:'code',sessionId:'chat-1'},actor);
 assert.equal(first.availability,'active');
 const repeated=sessions.claim({projectId:p.id,taskId:t.id,streamId:'code',sessionId:'chat-1'},actor);
 assert.equal(repeated.id,first.id);
 assert.throws(()=>sessions.claim({projectId:p.id,taskId:t.id,streamId:'code',sessionId:'other'},other),{code:'LEASE_CONFLICT'});
 assert.throws(()=>sessions.renew({projectId:p.id,id:first.id,sessionId:'chat-1'},other),{code:'LEASE_OWNER_MISMATCH'});
 assert.equal(app.tasks.activity(p.id).filter(x=>x.action==='skill.session.claim').length,1);
}));
test('disjoint streams run parallel but overlapping path ownership across Task rejected',()=>fixture(app=>{
 const p=app.tasks.createProject({name:'Parallel'},actor);
 const t=activeTask(app,p.id,'Shared code',['src/api','tests/api']);
 const u=activeTask(app,p.id,'Same module',['src/api/subdir','tests/other']);
 const s=new SkillSessions(app.store);
 const claimed=s.claim({projectId:p.id,taskId:t.id,streamId:'code',sessionId:'agent-a'},actor);
 assert.throws(()=>s.claim({projectId:p.id,taskId:u.id,streamId:'code',sessionId:'agent-b'},other),{code:'LEASE_PATH_CONFLICT'});
 const x=activeTask(app,p.id,'Independent',['src/web','tests/web']);
 const second=s.claim({projectId:p.id,taskId:x.id,streamId:'code',sessionId:'agent-b'},other);
 assert.notEqual(claimed.id,second.id);
 assert.equal(s.list(p.id).length,2);
}));
test('expired lease is attention, not automatic takeover; same owner renews',()=>fixture(app=>{
 const p=app.tasks.createProject({name:'Recover'},actor),t=activeTask(app,p.id,'Recover');
 let now=new Date('2026-10-12T00:00:00.000Z');
 const sessions=new SkillSessions(app.store,()=>now);
 const first=sessions.claim({projectId:p.id,taskId:t.id,streamId:'code',sessionId:'session-a',ttlSeconds:60},actor);
 now=new Date('2026-10-12T00:02:00.000Z');
 assert.equal(sessions.list(p.id)[0]?.availability,'expired');
 assert.throws(()=>sessions.claim({projectId:p.id,taskId:t.id,streamId:'code',sessionId:'session-b'},other),{code:'LEASE_CONFLICT'});
 const returned=sessions.renew({projectId:p.id,id:first.id,sessionId:'session-a'},actor);
 assert.equal(returned.availability,'active');
 assert.equal(sessions.release({projectId:p.id,id:first.id,sessionId:'session-a'},actor).availability,'released');
 assert.equal(sessions.list(p.id).length,0);
 assert.equal(sessions.list(p.id,{includeReleased:true})[0]?.availability,'released');
}));
test('same persisted lease survives app restart; explicit release unlocks WIP',()=>fixture(async(app,root)=>{
 const p=app.tasks.createProject({name:'Restart'},actor),t=activeTask(app,p.id,'Before restart');
 const first=new SkillSessions(app.store).claim({projectId:p.id,taskId:t.id,streamId:'code',sessionId:'stable'},actor);
 const another=new FlowlyApp(root);
 try{
  const s=new SkillSessions(another.store);
  assert.equal(s.list(p.id).find(x=>x.id===first.id)?.id,first.id);
  assert.throws(()=>s.release({projectId:p.id,id:first.id,sessionId:'foreign'},actor),{code:'LEASE_OWNER_MISMATCH'});
  s.release({projectId:p.id,id:first.id,sessionId:'stable'},actor);
  const second=s.claim({projectId:p.id,taskId:t.id,streamId:'code',sessionId:'new-session'},other);
  assert.notEqual(second.id,first.id);
 }finally{await another.close();}
}));
test('cross-project claims and inactive workstreams fail',()=>fixture(app=>{
 const a=app.tasks.createProject({name:'Project A'},actor),b=app.tasks.createProject({name:'Project B'},actor);
 const t=activeTask(app,a.id,'Guard');
 const sessions=new SkillSessions(app.store);
 assert.throws(()=>sessions.claim({projectId:b.id,taskId:t.id,streamId:'code',sessionId:'x'},actor),{code:'PROJECT_MISMATCH'});
 assert.throws(()=>sessions.claim({projectId:a.id,taskId:t.id,streamId:'proof',sessionId:'x'},actor),{code:'WORKSTREAM_NOT_ACTIVE'});
 assert.throws(()=>sessions.claim({projectId:a.id,taskId:t.id,streamId:'code',sessionId:'x',ttlSeconds:1},actor),{code:'INVALID_LEASE_TTL'});
}));
