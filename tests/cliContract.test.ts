import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const cli=path.resolve('node_modules','tsx','dist','cli.mjs');
const entry=path.resolve('packages','cli','src','index.ts');
function invoke(dir:string,operation:string,args:string[]=[],stdin?:string):Promise<{code:number;stdout:any;stderr:any}>{
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[cli,entry,operation,...args],{
   cwd:process.cwd(),windowsHide:true,env:{...process.env,FLOWLY_DATA_DIR:dir},stdio:['pipe','pipe','pipe']
  });
  let stdout='',stderr='';
  child.stdout.on('data',v=>stdout+=String(v));
  child.stderr.on('data',v=>stderr+=String(v));
  child.on('error',reject);
  child.on('close',code=>{
   let out:any,err:any;
   try{out=JSON.parse(stdout);}catch{out=stdout;}
   try{err=JSON.parse(stderr);}catch{err=stderr;}
   resolve({code:code||0,stdout:out,stderr:err});
  });
  child.stdin.end(stdin||'');
 });
}
test('CLI discovery, JSON stdin/file, pagination and dry-run rollback share exact domain validation',{timeout:60000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-cli-contract-'));
 try{
  const describe=await invoke(root,'describe',['task.transition']);
  assert.equal(describe.code,0);
  assert.equal(describe.stdout.result.parameters.to.required,true);
  assert.equal(describe.stdout.result.dryRun,true);
  const project=await invoke(root,'project.create',['--name=CLI Project']);
  assert.equal(project.code,0,JSON.stringify(project.stderr));
  const id=project.stdout.result.id as string;
  assert.equal(project.stdout.schemaVersion,1);
  const dry=await invoke(root,'task.create',['--projectId='+id,'--title=Not persisted','--dry-run']);
  assert.equal(dry.code,0);
  assert.equal(dry.stdout.result.simulation,true);
  assert.equal(dry.stdout.result.committed,false);
  let list=await invoke(root,'task.list',['--projectId='+id]);
  assert.equal(list.stdout.result.length,0,'Dry-run must roll back persisted Task and Audit');
  const input={projectId:id,title:'Via stdin',description:'from piping'};
  const created=await invoke(root,'task.create',['--input=-'],JSON.stringify(input));
  assert.equal(created.code,0,JSON.stringify(created.stderr));
  const context=await invoke(root,'task.context',['--id='+created.stdout.result.id]);
  assert.equal(context.code,0);
  assert.equal(context.stdout.result.task.id,created.stdout.result.id);
  assert.equal(context.stdout.result.task.status,'backlog');
  assert.ok(Array.isArray(context.stdout.result.blockers));
  assert.ok(context.stdout.result.nextActions.includes('task.transition'));
  const pathToInput=path.join(root,'task.json');
  fs.writeFileSync(pathToInput,JSON.stringify({projectId:id,title:'Via file'}));
  const file=await invoke(root,'task.create',['--input=@'+pathToInput]);
  assert.equal(file.code,0,JSON.stringify(file.stderr));
  const third=await invoke(root,'task.create',['--projectId='+id,'--title=Third']);
  assert.equal(third.code,0);
  list=await invoke(root,'task.list',['--projectId='+id,'--limit=2','--offset=1','--output=compact']);
  assert.equal(list.code,0);
  assert.equal(list.stdout.result.total,3);
  assert.equal(list.stdout.result.items.length,2);
  assert.equal(list.stdout.result.hasMore,false);
  const illegal=await invoke(root,'task.create',['--projectId='+id,'--title=bad','--nonsense=abc']);
  assert.equal(illegal.code,2);
  assert.equal(illegal.stderr.code,'UNKNOWN_PARAMETER');
  const badDone=await invoke(root,'task.transition',['--id='+created.stdout.result.id,'--to=done','--dry-run']);
  assert.equal(badDone.code,2);
  assert.equal(badDone.stderr.code,'TRANSITION_BLOCKED');
  const after=await invoke(root,'task.list',['--projectId='+id]);
  assert.equal(after.stdout.result.length,3);
  assert.equal(after.stdout.result.find((x:{id:string})=>x.id===created.stdout.result.id)?.status,'backlog');
  const badExternal=await invoke(root,'recorder.capture',['--projectId='+id,'--taskId=tsk_test','--screenId=home','--dry-run']);
  assert.equal(badExternal.code,2);
  assert.equal(badExternal.stderr.code,'DRY_RUN_UNSUPPORTED');
 }finally{fs.rmSync(root,{recursive:true,force:true,maxRetries:4,retryDelay:200});}
});
