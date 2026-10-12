import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FlowlyApp} from '../../packages/core/src/app.js';
import {getAgentBootstrap} from '../../packages/core/src/skillBootstrap.js';
const actor={actor:'bootstrap-test',channel:'cli' as const};
async function fixture(fn:(app:FlowlyApp)=>void|Promise<void>){
 const root=mkdtempSync(join(tmpdir(),'flowly-bootstrap-')),app=new FlowlyApp(root);
 try{await fn(app);}finally{await app.close();rmSync(root,{recursive:true,force:true});}
}
test('empty installation gives safe project-create discovery without writing',()=>fixture(app=>{
 const x=getAgentBootstrap(app);assert.equal(x.readOnly,true);assert.equal(x.authority,'advisory');
 assert.deepEqual(x.projectSelection,{state:'none',total:0});assert.equal(x.next.reason,'NO_PROJECTS');
}));
test('multiple projects require explicit choice and no mutation',()=>fixture(app=>{
 const a=app.tasks.createProject({name:'Alpha'},actor);
 app.tasks.createProject({name:'Beta'},actor);
 const before=JSON.stringify(app.tasks.listProjects());
 const result=getAgentBootstrap(app,{sessionId:'fresh'});
 assert.equal(result.projectSelection.state,'choose-project');assert.equal(result.next.reason,'PROJECT_SELECTION_REQUIRED');
 assert.equal(getAgentBootstrap(app,{projectId:a.id}).projectSelection.state,'selected');
 assert.equal(JSON.stringify(app.tasks.listProjects()),before);
 assert.throws(()=>getAgentBootstrap(app,{projectId:'unknown'}),{code:'NOT_FOUND'});
 assert.throws(()=>getAgentBootstrap(app,{projectId:' '}),{code:'INVALID_PROJECT_ID'});
}));
test('single project and top-level task yield context hint without any audit write',()=>fixture(app=>{
 const p=app.tasks.createProject({name:'Flowly'},actor);
 const task=app.tasks.createTask({projectId:p.id,title:'Implement'},actor);
 const before=app.tasks.activity(p.id);
 const x=getAgentBootstrap(app);
 assert.equal(x.projectSelection.state,'selected');
 assert.equal(x.next.operation,'task.context');assert.equal(x.next.params.id,task.id);
 assert.equal(x.summary?.counts.backlog,1);
 assert.deepEqual(app.tasks.activity(p.id),before);
}));
test('ambiguous tasks sort deterministically and stay isolated',()=>fixture(app=>{
 const p=app.tasks.createProject({name:'One'},actor),other=app.tasks.createProject({name:'Two'},actor);
 app.tasks.createTask({projectId:p.id,title:'Low',priority:'low'},actor);
 app.tasks.createTask({projectId:p.id,title:'High',priority:'high'},actor);
 app.tasks.createTask({projectId:other.id,title:'Other'},actor);
 const x=getAgentBootstrap(app,{projectId:p.id});
 assert.equal(x.next.reason,'TASK_SELECTION_REQUIRED');
 assert.deepEqual(x.summary?.candidates.map(y=>y.title),['High','Low']);
 assert.equal(x.summary?.taskCount,2);
}));
