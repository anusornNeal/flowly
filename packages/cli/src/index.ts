#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FlowlyApp, execute, capabilities } from '../../core/src/app.js';
import { DomainError } from '../../core/src/models.js';

const PERSISTENT_BROWSER_OPERATIONS=new Set(['recorder.start','recorder.stop','recorder.replay','recorder.capture','recorder.session.reset']);
async function callPersistentBrowser(operation:string,data:Record<string,unknown>,actor:string) {
 const base='http://127.0.0.1:'+(process.env.FLOWLY_PORT||'3210');
 const health=async()=>{
  try{
   const res=await fetch(base+'/api/health',{signal:AbortSignal.timeout(900)});
   if(!res.ok)return false;
   const payload=await res.json() as {name?:string};
   if(payload.name!=='flowly')throw new DomainError('PORT_IN_USE','Loopback port is used by another application',409);
   return true;
  }catch(error){
   if(error instanceof DomainError)throw error;
   return false;
  }
 };
 if(!await health()){
  const root=path.resolve(fileURLToPath(new URL('../../../',import.meta.url)));
  const runner=path.join(root,'node_modules','tsx','dist','cli.mjs');
  if(!fs.existsSync(runner))throw new DomainError('RUNTIME_MISSING','Install dependencies with npm install first',503);
  const child=spawn(process.execPath,[runner,path.join(root,'apps','api','src','main.ts')],{
   cwd:root,detached:true,windowsHide:true,stdio:'ignore',env:process.env
  });
  child.unref();
  let ready=false;
  for(let attempt=0;attempt<40;attempt++){
   if(await health()){ready=true;break;}
   await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(!ready)throw new DomainError('SERVER_UNAVAILABLE','Local Flowly API could not start. Try npm start.',503);
 }
 const response=await fetch(base+'/api/operations/'+encodeURIComponent(operation),{
  method:'POST',headers:{'Content-Type':'application/json','X-Flowly-Actor':actor,'X-Flowly-Channel':'cli'},
  body:JSON.stringify(data),signal:AbortSignal.timeout(90000)
 });
 const result=await response.json() as {ok:boolean;code?:string;message?:string;details?:Record<string,unknown>;result?:unknown};
 if(!response.ok||!result.ok)throw new DomainError(result.code||'OPERATION_FAILED',result.message||'Recorder operation failed',response.status,result.details);
 return result.result;
}
function parseValue(value:string):unknown{
 if(value.startsWith('@'))return JSON.parse(fs.readFileSync(value.slice(1),'utf8'));
 if(value==='true')return true;
 if(value==='false')return false;
 if(value==='null')return null;
 if(/^-?\d+(\.\d+)?$/.test(value))return Number(value);
 if(value[0]==='{'||value[0]==='[')try{return JSON.parse(value);}catch{}
 return value;
}
async function main(){
 const args=process.argv.slice(2);
 if(!args.length || ['help','--help','-h'].includes(args[0]!)){
  console.log(JSON.stringify({ok:true,usage:'flowly <area> <action> [--id=...] [--projectId=...] [--input=@file.json] [--actor=agent]',...capabilities()},null,2));
  return;
 }
 let operation=args.shift()!;
 if(operation==='capabilities'){console.log(JSON.stringify({ok:true,result:capabilities()},null,2));return;}
 if(!operation.includes('.') && args[0]&&!args[0].startsWith('-'))operation+='.'+args.shift();
 const data:Record<string,unknown>={};
 for(let i=0;i<args.length;i++){
  const arg=args[i]!;
  if(!arg.startsWith('--'))throw new DomainError('INVALID_ARGUMENT','Only named --field=value parameters are accepted');
  const idx=arg.indexOf('=');
  const key=idx<0?arg.slice(2):arg.slice(2,idx);
  let raw=idx<0?undefined:arg.slice(idx+1);
  if(raw===undefined&&i+1<args.length&&!args[i+1]!.startsWith('--'))raw=args[++i];
  if(raw===undefined)raw='true';
  if(key==='input'){
   const file=raw.startsWith('@')?raw.slice(1):raw;
   Object.assign(data,JSON.parse(fs.readFileSync(file,'utf8')));
  }else data[key]=parseValue(raw);
 }
 const actor={actor:String(data.actor||'agent'),channel:'cli' as const};
 delete data.actor;
 const root=typeof data.dataDir==='string'?data.dataDir:undefined;
 delete data.dataDir;
 if(PERSISTENT_BROWSER_OPERATIONS.has(operation)){
  if(root)throw new DomainError('SERVICE_DATA_DIR','Set FLOWLY_DATA_DIR environment variable to select Recorder service storage',400);
  const result=await callPersistentBrowser(operation,data,actor.actor);
  console.log(JSON.stringify({ok:true,operation,result},null,2));
  return;
 }
 const app=new FlowlyApp(root);
 try{
  const result=await execute(app,operation,data,actor);
  console.log(JSON.stringify({ok:true,operation,result},null,2));
 }finally{await app.close();}
}
main().catch((error:unknown)=>{
 const known=error instanceof DomainError;
 const result={ok:false,code:known?error.code:'INTERNAL_ERROR',message:known?error.message:String(error).slice(0,250),
  ...(known&&error.details?{details:error.details}:{})};
 console.error(JSON.stringify(result));process.exitCode=1;
});
