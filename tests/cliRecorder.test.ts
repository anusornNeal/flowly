import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync=promisify(execFile);
import { createServer } from '../apps/api/src/server.js';
import { FlowlyApp } from '../packages/core/src/app.js';

test('agent CLI Recorder Start and Stop across separate processes uses persistent local API without Web UI',{timeout:60000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-cli-replay-'));
 const target=http.createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><button id="next">Next</button>');});
 await new Promise<void>(resolve=>target.listen(0,'127.0.0.1',resolve));
 const addr=target.address(); assert.ok(addr&&typeof addr!=='string');
 const projectApp=new FlowlyApp(root);
 const project=projectApp.tasks.createProject({name:'CLI Web',platform:'web',baseUrl:'http://127.0.0.1:'+addr.port}, {actor:'setup',channel:'cli'});
 await projectApp.close();
 const api=await createServer({root});
 try{
  const apiUrl=await api.listen({host:'127.0.0.1',port:0});
  const port=new URL(apiUrl).port;
  const runner=path.resolve('node_modules','tsx','dist','cli.mjs');
  const cli=path.resolve('packages','cli','src','index.ts');
  const env={...process.env,FLOWLY_PORT:port,FLOWLY_DATA_DIR:root,FLOWLY_BROWSER_HEADLESS:'1'};
  const run=async(name:string,...fields:string[])=>{
   const {stdout}=await execFileAsync(process.execPath,[runner,cli,name,...fields],{cwd:process.cwd(),env,encoding:'utf8',timeout:18000,windowsHide:true});
   return JSON.parse(stdout) as {ok:boolean;operation:string;result:any};
  };
  const start=await run('recorder.start','--projectId='+project.id,'--screenId=login');
  assert.equal(start.ok,true);assert.equal(start.result.recording,true);
  // A new CLI process is used for stop, while the API owns the same controlled Browser session.
  const stop=await run('recorder.stop','--projectId='+project.id);
  assert.equal(stop.ok,true);assert.equal(stop.result.screenId,'login');
  const steps=await run('recorder.steps','--projectId='+project.id,'--screenId=login');
  assert.equal(steps.ok,true);assert.equal(Array.isArray(steps.result.steps),true);
  const history=await run('activity','--projectId='+project.id);
  assert.equal(history.result.some((e:{action:string;channel:string})=>e.action==='recorder.stop'&&e.channel==='cli'),true);
 }finally{
  await api.close();
  await new Promise<void>(resolve=>target.close(()=>resolve()));
  fs.rmSync(root,{recursive:true,force:true,maxRetries:4,retryDelay:200});
 }
});
