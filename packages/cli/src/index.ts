#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FlowlyApp, execute, capabilities } from '../../core/src/app.js';
import { describeOperation, allContracts } from '../../core/src/contracts.js';
import { simulateOperation } from '../../core/src/dryRun.js';
import { DomainError } from '../../core/src/models.js';

const VERSION=1;
const PERSISTENT_BROWSER_OPERATIONS=new Set(['recorder.start','recorder.stop','recorder.replay','recorder.capture','recorder.session.reset','job.start','job.status','job.list','job.retry','job.cancel']);
const HELP='flowly <operation> [--field=value] [--input=@file.json|-] [--dry-run] [--limit=N --offset=N] [--actor=agent]';
function output(data:unknown,compact=false){console.log(JSON.stringify(data,null,compact?0:2));}
function validObject(value:unknown,label:string):Record<string,unknown>{
 if(value===null||typeof value!=='object'||Array.isArray(value))
  throw new DomainError('INVALID_INPUT',label+' must be a JSON object');
 return value as Record<string,unknown>;
}
function jsonFromFile(value:string){
 const contents=value==='-'?fs.readFileSync(0,'utf8'):fs.readFileSync(value.replace(/^@/,''),'utf8');
 try{return validObject(JSON.parse(contents),'Input JSON');}
 catch(error){
  if(error instanceof DomainError)throw error;
  throw new DomainError('INVALID_JSON','Could not parse input JSON from file/stdin');
 }
}
function parseValue(value:string):unknown{
 if(value.startsWith('@')){
  try{return JSON.parse(fs.readFileSync(value.slice(1),'utf8'));}
  catch{throw new DomainError('INVALID_JSON','Could not read or parse structured JSON file');}
 }
 if(value==='true')return true;
 if(value==='false')return false;
 if(value==='null')return null;
 if(/^-?\d+(\.\d+)?$/.test(value))return Number(value);
 if(value[0]==='{'||value[0]==='['){try{return JSON.parse(value);}catch{throw new DomainError('INVALID_JSON','Invalid structured JSON argument');}}
 return value;
}
async function ensureApi(){
 const base='http://127.0.0.1:'+(process.env.FLOWLY_PORT||'3210');
 const health=async()=>{
  try{
   const res=await fetch(base+'/api/health',{signal:AbortSignal.timeout(900)});
   if(!res.ok)return false;
   const payload=await res.json() as {name?:string};
   if(payload.name!=='flowly')throw new DomainError('PORT_IN_USE','Loopback port belongs to another application',409);
   return true;
  }catch(error){if(error instanceof DomainError)throw error;return false;}
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
  if(!ready)throw new DomainError('SERVER_UNAVAILABLE','Local Flowly service could not start. Try npm start.',503);
 }
 return base;
}
async function callPersistent(operation:string,data:Record<string,unknown>,actor:string){
 const base=await ensureApi();
 const response=await fetch(base+'/api/operations/'+encodeURIComponent(operation),{
  method:'POST',headers:{'Content-Type':'application/json','X-Flowly-Actor':actor,'X-Flowly-Channel':'cli'},
  body:JSON.stringify(data),signal:AbortSignal.timeout(90000)
 });
 const result=await response.json() as {ok:boolean;code?:string;message?:string;details?:Record<string,unknown>;result?:unknown};
 if(!response.ok||!result.ok)
  throw new DomainError(result.code||'OPERATION_FAILED',result.message||'Local service rejected the operation',response.status,result.details);
 return result.result;
}
function parseArgs(args:string[]){
 const data:Record<string,unknown>={},controls:Record<string,unknown>={};
 for(let i=0;i<args.length;i++){
  const arg=args[i]!;
  if(!arg.startsWith('--'))throw new DomainError('INVALID_ARGUMENT','Only named --field=value options are accepted');
  const index=arg.indexOf('='),key=index<0?arg.slice(2):arg.slice(2,index);
  if(!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(key))throw new DomainError('INVALID_FLAG','Malformed CLI option');
  let raw=index<0?undefined:arg.slice(index+1);
  if(raw===undefined&&i+1<args.length&&!args[i+1]!.startsWith('--'))raw=args[++i];
  if(raw===undefined)raw='true';
  if(key==='input'||key==='stdin'){
   const parsed=jsonFromFile(key==='stdin'?'-':raw);
   Object.assign(data,parsed);continue;
  }
  const value=parseValue(raw);
  if(['actor','dataDir','dry-run','dryRun','limit','offset','output','async','jobKey'].includes(key))controls[key]=value;
  else data[key]=value;
 }
 return {data,controls};
}
function validateInputs(operation:string,data:Record<string,unknown>){
 const contract=describeOperation(operation);
 for(const [name,rule] of Object.entries(contract.parameters)){
  if(rule.required && (data[name]===undefined||data[name]===null||data[name]===''))
   throw new DomainError('MISSING_PARAMETER','Operation '+operation+' requires --'+name,400,{operation,parameter:name});
 }
 const unexpected=Object.keys(data).filter(k=>!Object.hasOwn(contract.parameters,k));
 if(unexpected.length)throw new DomainError('UNKNOWN_PARAMETER','Unsupported parameter '+unexpected.join(', ')+' for '+operation,400,{allowed:Object.keys(contract.parameters)});
}
function pageResult(result:unknown,limitRaw:unknown,offsetRaw:unknown){
 if(limitRaw===undefined&&offsetRaw===undefined)return {result};
 if(!Array.isArray(result))throw new DomainError('PAGINATION_UNSUPPORTED','--limit/--offset require an operation returning a list');
 const limit=limitRaw===undefined?50:Number(limitRaw),offset=offsetRaw===undefined?0:Number(offsetRaw);
 if(!Number.isInteger(limit)||limit<1||limit>500||!Number.isInteger(offset)||offset<0)
  throw new DomainError('INVALID_PAGINATION','limit must be 1..500 and offset must be >=0');
 return {result:{items:result.slice(offset,offset+limit),total:result.length,limit,offset,hasMore:offset+limit<result.length}};
}
async function main(){
 const args=process.argv.slice(2);
 if(!args.length||['help','--help','-h'].includes(args[0]!)){
  output({schemaVersion:VERSION,ok:true,usage:HELP,globalFlags:['--input=@file.json','--input=-','--stdin','--dry-run',
   '--limit=50','--offset=0','--actor=agent','--async','--jobKey=my-id','--output=compact'],operations:capabilities().operations});return;
 }
 let operation=args.shift()!;
 if(operation==='capabilities'){
  output({schemaVersion:VERSION,ok:true,result:{...capabilities(),contracts:allContracts()}});
  return;
 }
 if(operation==='describe'){
  const name=args.shift();
  if(!name)throw new DomainError('OPERATION_REQUIRED','Usage: flowly describe task.transition');
  output({schemaVersion:VERSION,ok:true,result:describeOperation(name)});return;
 }
 if(!operation.includes('.') && args[0]&&!args[0].startsWith('-'))operation+='.'+args.shift();
 const {data,controls}=parseArgs(args);
 if(operation==='job.list'){
  if(controls.limit!==undefined){data.limit=controls.limit;delete controls.limit;}
  if(controls.offset!==undefined){data.offset=controls.offset;delete controls.offset;}
 }
 validateInputs(operation,data);
 const actor={actor:String(controls.actor||'agent'),channel:'cli' as const};
 const root=typeof controls.dataDir==='string'?controls.dataDir:undefined;
 const dryRun=controls['dry-run']===true||controls.dryRun===true;
 const useJob=controls.async===true;
 if(useJob && !['recorder.replay','recorder.capture','preview.quality','screenshot.compare'].includes(operation))
  throw new DomainError('ASYNC_OPERATION_UNSUPPORTED','--async is only supported for replay, capture, preview quality and screenshot comparison');
 if(dryRun&&PERSISTENT_BROWSER_OPERATIONS.has(operation))
  throw new DomainError('DRY_RUN_UNSUPPORTED','Controlled Browser side effects cannot be simulated');
 let result:unknown;
 if(useJob){
  if(dryRun)throw new DomainError('DRY_RUN_UNSUPPORTED','Async Job and dry-run cannot be combined');
  if(root)throw new DomainError('SERVICE_DATA_DIR','Use FLOWLY_DATA_DIR for the persistent Job service');
  const projectId=typeof data.projectId==='string'?data.projectId:undefined;
  if(!projectId)throw new DomainError('PROJECT_REQUIRED','Async operation needs --projectId');
  result=await callPersistent('job.start',{projectId,operation,input:data,idempotencyKey:typeof controls.jobKey==='string'?controls.jobKey:undefined},actor.actor);
 }else if(PERSISTENT_BROWSER_OPERATIONS.has(operation)){
  if(root)throw new DomainError('SERVICE_DATA_DIR','Set FLOWLY_DATA_DIR before starting the Recorder service');
  result=await callPersistent(operation,data,actor.actor);
 }else{
  const app=new FlowlyApp(root);
  try{result=dryRun?simulateOperation(app,operation,data,actor):await execute(app,operation,data,actor);}
  finally{await app.close();}
 }
 const paged=pageResult(result,controls.limit,controls.offset);
 output({schemaVersion:VERSION,ok:true,operation,...paged},controls.output==='compact');
}
main().catch((error:unknown)=>{
 const known=error instanceof DomainError;
 const result={schemaVersion:VERSION,ok:false,code:known?error.code:'INTERNAL_ERROR',
  message:known?error.message:'Unexpected Flowly CLI error',
  ...(known&&error.details?{details:error.details}:{})};
 console.error(JSON.stringify(result));
 process.exitCode=known?(error.httpStatus>=500?3:2):1;
});
