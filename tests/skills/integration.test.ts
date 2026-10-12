import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {FlowlyApp,execute,capabilities} from '../../packages/core/src/app.js';
import {describeOperation} from '../../packages/core/src/contracts.js';
import {createServer} from '../../apps/api/src/server.js';
const actor={actor:'integration-test',channel:'cli' as const};
async function fixture(fn:(app:FlowlyApp,root:string)=>Promise<void>|void){
 const root=mkdtempSync(join(tmpdir(),'flowly-skill-e2e-'));
 const app=new FlowlyApp(root);
 try{await fn(app,root);}finally{await app.close();rmSync(root,{recursive:true,force:true});}
}
function cli(root:string,op:string,args:string[]=[]){
 const s=execFileSync(process.execPath,['bin/flowly.cjs',op,...args,'--output=compact'],{
   cwd:process.cwd(),encoding:'utf8',timeout:20000,
   env:{...process.env,FLOWLY_DATA_DIR:root}});
 const data=JSON.parse(s);
 assert.equal(data.ok,true);
 return data.result;
}
test('CLI discovers versioned operations and project.list is not a phantom capability',()=>{
 for(const op of ['project.list','bootstrap','next','guide','skills.list','skills.get','skills.route','skills.import','skills.enable'])
   assert.ok(describeOperation(op));
 assert.ok(capabilities().operations.includes('bootstrap'));
});
test('fresh isolated CLI reaches next step and minimal guidance in three calls',()=>fixture(async(app,root)=>{
 const p=app.tasks.createProject({name:'Flowly Cold Start'},actor);
 const t=app.tasks.createTask({projectId:p.id,title:'Fix local view'},actor);
 const history=app.tasks.activity(p.id);
 const bootstrap=cli(root,'bootstrap',['--projectId='+p.id]);
 assert.equal(bootstrap.projectSelection.state,'selected');
 const next=cli(root,'next',['--projectId='+p.id,'--taskId='+t.id]);
 assert.equal(next.reason,'MOVE_TO_TODO');
 assert.equal(next.readOnly,true);
 const guide=cli(root,'guide',['--projectId='+p.id,'--intent=review a card']);
 assert.equal(guide.loadedSkillIds[0],'review');
 assert.match(guide.instructions,/task\.review/);
 assert.equal(guide.truncated,false);
 assert.deepEqual(app.tasks.activity(p.id),history);
}));
test('local HTTP and CLI share domain contracts, project boundary and registry',()=>fixture(async(app,root)=>{
 const one=app.tasks.createProject({name:'One'},actor);
 const two=app.tasks.createProject({name:'Two'},actor);
 const task=app.tasks.createTask({projectId:one.id,title:'task one'},actor);
 const server=await createServer({root});
 try{
  const b=await server.inject({method:'POST',url:'/api/operations/bootstrap',
   headers:{host:'localhost'},payload:{projectId:one.id}});
  assert.equal(b.statusCode,200);assert.equal(b.json().result.projectSelection.project.id,one.id);
  const routed=await server.inject({method:'POST',url:'/api/operations/skills.route',
   headers:{host:'localhost'},payload:{projectId:one.id,intent:'รีวิว card'}});
  assert.equal(routed.statusCode,200);assert.equal(routed.json().result.selected[0].skillId,'review');
  const denied=await server.inject({method:'POST',url:'/api/operations/next',
   headers:{host:'localhost'},payload:{projectId:two.id,taskId:task.id}});
  assert.equal(denied.statusCode,409);
  assert.equal(denied.json().code,'PROJECT_MISMATCH');
  const skills=await execute(app,'skills.list',{},actor) as {id:string}[];
  assert.ok(skills.some(s=>s.id==='agent-bootstrap'));
  const guide=await execute(app,'guide',{intent:'Implement parallel workstreams',projectId:one.id},actor) as {loadedSkillIds:string[]};
  assert.deepEqual(guide.loadedSkillIds,['implementation','decomposition']);
 }finally{await server.close();}
}));
test('project import remains project-scoped and cannot overwrite trusted builtins',()=>fixture(async(app)=>{
 const p=app.tasks.createProject({name:'Custom'},actor);
 const content='---\nname: custom-qa\ndescription: Local customized quality checklist guidance for explicit verification.\n---\n# Checklist\nAll QA verdicts require evidence.';
 const imported=await execute(app,'skills.import',{projectId:p.id,content},actor) as {manifest:{source:string;scope:string}};
 assert.equal(imported.manifest.source,'project');
 const found=await execute(app,'skills.get',{projectId:p.id,id:'custom-qa'},actor) as {content:string};
 assert.equal(found.content,content);
 const filtered=await execute(app,'skills.route',{projectId:p.id,intent:'review'},actor) as {selected:{skillId:string}[]};
 assert.equal(filtered.selected[0]?.skillId,'review');
 await assert.rejects(()=>execute(app,'skills.import',{projectId:p.id,
  content:content.replace('custom-qa','review')},actor),{code:'BUILTIN_SKILL_PROTECTED'});
}));

test('skills.preflight uses exact domain transition validator via CLI and HTTP without writes',()=>fixture(async(app,root)=>{
 const p=app.tasks.createProject({name:'Domain gate'},actor);
 const t=app.tasks.createTask({projectId:p.id,title:'Public contract',risk:{publicContract:true}},actor);
 const history=app.tasks.activity(p.id);
 const result=cli(root,'skills.preflight',['--projectId='+p.id,'--taskId='+t.id,
   '--operation=task.transition','--to=in-progress']);
 assert.equal(result.preflight,'blocked');
 assert.equal(result.reasonCode,'DECISION_GATE_BLOCKED');
 assert.ok(result.blockers.includes('DECISION_APPROVAL_REQUIRED'));
 assert.equal(result.authoritative,false);
 const server=await createServer({root});
 try{
  const response=await server.inject({method:'POST',url:'/api/operations/skills.preflight',
    headers:{host:'localhost'},payload:{projectId:p.id,taskId:t.id,operation:'task.transition',to:'done'}});
  assert.equal(response.statusCode,200);
  assert.equal(response.json().result.preflight,'blocked');
  assert.equal(response.json().result.readOnly,true);
 }finally{await server.close();}
 assert.equal(app.tasks.task(t.id).status,'backlog');
 assert.deepEqual(app.tasks.activity(p.id),history);
}));
