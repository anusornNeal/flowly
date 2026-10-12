import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {FlowlyApp,execute,capabilities} from '../../packages/core/src/app.js';
import {describeOperation} from '../../packages/core/src/contracts.js';
import {createServer} from '../../apps/api/src/server.js';
const worker={actor:'worker-a',channel:'cli' as const},reviewer={actor:'reviewer-b',channel:'cli' as const};
async function fixture(fn:(app:FlowlyApp,root:string)=>Promise<void>|void){
 const root=mkdtempSync(join(tmpdir(),'flowly-extended-skill-')),app=new FlowlyApp(root);
 try{await fn(app,root);}finally{await app.close();rmSync(root,{recursive:true,force:true});}
}
function cli(root:string,operation:string,params:string[]=[]):unknown{
 const output=execFileSync(process.execPath,['bin/flowly.cjs',operation,
 ...params,'--output=compact','--actor=worker-a'],{
 cwd:process.cwd(),encoding:'utf8',timeout:18000,env:{...process.env,FLOWLY_DATA_DIR:root}});
 const result=JSON.parse(output);
 assert.equal(result.ok,true);
 return result.result;
}
const custom=(description='Project QA requires confirmation and evidence.')=>
 '---\nname: custom-quality\ndescription: '+description+'\n---\n# Custom Quality\nRun real checks before approving revisions.\n';

test('P1/P2 endpoints are discoverable, correctly typed and marked read-only',()=>{
 const ro=['skills.session.list','skills.audit.list','skills.audit.report','skills.learning.list','skills.learning.get'];
 const mut=['skills.session.claim','skills.session.renew','skills.session.release','skills.audit.record',
  'skills.learning.propose','skills.learning.decide','skills.learning.rollback'];
 for(const operation of [...ro,...mut]){
  assert.ok((capabilities().operations as readonly string[]).includes(operation));
  assert.equal(describeOperation(operation).readOnly,ro.includes(operation));
 }
 assert.equal(describeOperation('skills.learning.decide').parameters.verdict.required,true);
});
test('CLI claims persist across process, appear in Next Action and enforce project isolation',()=>fixture(async(app,root)=>{
 const p=app.tasks.createProject({name:'Work'},worker);
 const task=app.tasks.createTask({projectId:p.id,title:'Parallel Work',risk:{
  localScope:true,reversible:true,expectedOutcome:true,acceptanceCriteria:true,verificationStep:true}},worker);
 app.engineering.setPlan(task.id,[
  {id:'core',title:'Core',ownedPaths:['packages/core'],dependsOn:[],status:'pending'},
  {id:'qa',title:'QA',ownedPaths:['tests/skills'],dependsOn:[],status:'pending'}],worker);
 app.tasks.transition(task.id,{to:'todo'},worker);
 app.tasks.transition(task.id,{to:'in-progress'},worker);
 app.engineering.setStreamStatus(task.id,'core','in-progress',worker);
 const args=['--projectId='+p.id,'--taskId='+task.id,'--streamId=core','--sessionId=chat-a'];
 const claimed=cli(root,'skills.session.claim',args) as {id:string;availability:string};
 assert.equal(claimed.availability,'active');
 assert.equal((cli(root,'skills.session.claim',args) as {id:string}).id,claimed.id);
 const owned=cli(root,'next',['--projectId='+p.id,'--taskId='+task.id,'--sessionId=chat-a']) as {ownership:{status:string}};
 assert.equal(owned.ownership.status,'OWNED');
 const foreign=cli(root,'next',['--projectId='+p.id,'--taskId='+task.id,'--sessionId=chat-b']) as {ownership:{status:string};reason:string};
 assert.equal(foreign.ownership.status,'FOREIGN');
 assert.equal(foreign.reason,'FOREIGN_SESSION_CLAIMED');
 const api=await createServer({root});
 try{
  const list=await api.inject({method:'POST',url:'/api/operations/skills.session.list',
   headers:{host:'localhost'},payload:{projectId:p.id}});
  assert.equal(list.statusCode,200);assert.equal(list.json().result[0].id,claimed.id);
 }finally{await api.close();}
 const released=cli(root,'skills.session.release',['--projectId='+p.id,'--id='+claimed.id,'--sessionId=chat-a']) as {availability:string};
 assert.equal(released.availability,'released');
 assert.equal((cli(root,'skills.session.list',['--projectId='+p.id]) as unknown[]).length,0);
}));
test('approved learning is separate-reviewer-only, routable by optional project trigger and rollback-safe',()=>fixture(async(app,root)=>{
 const project=app.tasks.createProject({name:'Learn'},worker);
 const registered=app.skills.importProject({projectId:project.id,content:custom(),
  triggers:['custom quality']},worker);
 const proposal=await execute(app,'skills.learning.propose',{projectId:project.id,skillId:'custom-quality',
  candidateVersion:'1.1.0',candidateContent:custom('Project QA revised with stricter evidence.'),
  explanation:'Agent missed current revision evidence requirements'},worker) as {id:string;candidateSha256:string};
 assert.equal(app.skills.get({projectId:project.id,id:'custom-quality'}).manifest.version,'1.0.0');
 const api=await createServer({root});
 try{
  const result=await api.inject({method:'POST',url:'/api/operations/skills.learning.decide',headers:{host:'localhost'},
   payload:{projectId:project.id,id:proposal.id,verdict:'approve',
    confirm:'APPLY:'+proposal.candidateSha256.slice(0,12),reason:'Verified independent QA improvement'}});
  assert.equal(result.statusCode,200,JSON.stringify(result.json()));
  assert.equal(result.json().result.status,'approved');
 }finally{await api.close();}
 assert.equal(app.skills.get({projectId:project.id,id:'custom-quality'}).manifest.version,'1.1.0');
 assert.equal(app.skills.get({projectId:project.id,id:'custom-quality',version:'1.0.0'}).manifest.enabled,false);
 const yes=await execute(app,'skills.route',{projectId:project.id,intent:'review custom quality',
  allowProjectGuidance:true},worker) as {selected:Array<{skillId:string;version:string}>};
 assert.ok(yes.selected.some(x=>x.skillId==='custom-quality'&&x.version==='1.1.0'));
 const no=await execute(app,'skills.route',{projectId:project.id,intent:'review custom quality'},worker) as {selected:Array<{skillId:string}>};
 assert.ok(!no.selected.some(x=>x.skillId==='custom-quality'));
 await execute(app,'skills.learning.rollback',{projectId:project.id,id:proposal.id,
  confirm:'ROLLBACK:'+proposal.id,reason:'Revised policy rejected during QA regression'},reviewer);
 assert.equal(app.skills.get({projectId:project.id,id:'custom-quality'}).manifest.version,registered.manifest.version);
}));
test('audit links authoritative Activity and exact Skill hash without becoming an approval',()=>fixture(async(app)=>{
 const p=app.tasks.createProject({name:'Proof'},worker);
 const t=app.tasks.createTask({projectId:p.id,title:'Work',risk:{
  localScope:true,reversible:true,expectedOutcome:true,acceptanceCriteria:true,verificationStep:true}},worker);
 app.tasks.transition(t.id,{to:'todo'},worker);
 const activity=app.tasks.activity(p.id,t.id).find(x=>x.action==='transition');
 assert.ok(activity);
 const skill=app.skills.get({id:'implementation'}).manifest;
 const recorded=await execute(app,'skills.audit.record',{projectId:p.id,taskId:t.id,skillId:skill.id,
  version:skill.version,sha256:skill.sha256,reason:'IMPLEMENTATION',
  operation:'task.transition',sourceActivityId:activity?.id},worker) as {status:string;sourceActivityId:string};
 assert.equal(recorded.status,'correlated');
 assert.equal(recorded.sourceActivityId,activity?.id);
 const report=await execute(app,'skills.audit.report',{projectId:p.id,taskId:t.id},worker) as {selectionHistory:unknown[]};
 assert.equal(report.selectionHistory.length,1);
 assert.equal(app.tasks.task(t.id).testsPassed,false);
 assert.equal(app.tasks.task(t.id).reviewApproved,false);
}));
