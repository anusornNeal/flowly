import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { LocalStore } from '../../db/src/store.js';
import type { Actor, BrowserStep, Project } from '../../core/src/models.js';
import { DomainError, requireText } from '../../core/src/models.js';
import type { Tasks } from '../../core/src/tasks.js';
import type { Images } from '../../core/src/images.js';
import { applySteps, executableOptions } from './renderer.js';
import { recorderScript } from './recorderScript.js';

type Session={context:BrowserContext;page:Page;recording:boolean;instrumented:boolean;steps:BrowserStep[];screenId:string};
type Recipe={id:string;projectId:string;screenId:string;steps:BrowserStep[];updatedAt:string};
export class BrowserRecorder {
 private sessions=new Map<string,Session>();
 constructor(private store:LocalStore,private tasks:Tasks,private images:Images){}
 private cookieSnapshotPath(projectId:string){return path.join(this.profile(projectId),'session-cookies.json');}
 private async persistCookies(projectId:string,context:BrowserContext){
  const cookies=await context.cookies();
  const destination=this.cookieSnapshotPath(projectId);
  fs.writeFileSync(destination,JSON.stringify(cookies),{mode:0o600});
 }
 private async restoreCookies(projectId:string,context:BrowserContext){
  const location=this.cookieSnapshotPath(projectId);
  if(!fs.existsSync(location))return;
  try{
   const stored=JSON.parse(fs.readFileSync(location,'utf8')) as Awaited<ReturnType<BrowserContext['cookies']>>;
   if(Array.isArray(stored)&&stored.length)await context.addCookies(stored);
  }catch{
   throw new DomainError('CORRUPT_PROJECT_SESSION','Stored project Browser session could not be restored',409);
  }
 }
 private profile(projectId:string){
  const safe=createHash('sha256').update(projectId).digest('hex');
  return path.join(this.store.root,'browser-profiles',safe);
 }
 private url(project:Project,route?:string){
  if(project.platform!=='web')throw new DomainError('WEB_ONLY','Built-in Recorder supports Web targets only');
  if(!project.baseUrl)throw new DomainError('TARGET_URL_REQUIRED','Project localhost base URL required');
  let url:URL;
  try{url=new URL(route||'/',project.baseUrl);}
  catch{throw new DomainError('INVALID_TARGET_URL','Invalid browser target URL');}
  if(!['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname) || !['http:','https:'].includes(url.protocol))
   throw new DomainError('LOCALHOST_REQUIRED','Recorder and Capture support localhost Web targets only');
  return url.toString();
 }
 private async ensureSession(projectId:string,route?:string){
  const project=this.tasks.project(projectId),url=this.url(project,route);
  const existing=this.sessions.get(projectId);
  if(existing)return existing;
  const profile=this.profile(projectId);
  fs.mkdirSync(profile,{recursive:true});
  let context:BrowserContext;
  try{
   context=await chromium.launchPersistentContext(profile,{
    ...executableOptions(),headless:process.env.FLOWLY_BROWSER_HEADLESS==='1',viewport:{width:1280,height:800},args:['--no-first-run']
   });
  }catch(error){throw new DomainError('BROWSER_UNAVAILABLE','Unable to open controlled Browser window. Close another project browser process or install Playwright Chromium.',503,
   {detail:String(error).slice(0,300)});}
  await this.restoreCookies(projectId,context);
  const page=context.pages()[0]||await context.newPage();
  const session:Session={context,page,recording:false,instrumented:false,steps:[],screenId:''};
  this.sessions.set(projectId,session);
  context.on('close',()=>{if(this.sessions.get(projectId)===session)this.sessions.delete(projectId);});
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});
  return session;
 }
 async start(projectId:string,screenId:string,route:string|undefined,actor:Actor){
  requireText(screenId,'screen ID');
  const session=await this.ensureSession(projectId,route);
  if(session.recording)throw new DomainError('RECORDING_ACTIVE','Recorder is already active');
  session.recording=true;session.screenId=screenId;session.steps=[];
  if(!session.instrumented){
  await session.page.exposeBinding('flowlyRecord',(_source,step:BrowserStep)=>{
   if(session.recording&&session.steps.length<200&&step.action&&step.selector)session.steps.push(step);
  }).catch(()=>{});
  await session.page.addInitScript({content:recorderScript});
  await session.page.evaluate(recorderScript);
  session.page.on('framenavigated',frame=>{
   if(!session.recording||frame!==session.page.mainFrame())return;
   try{const u=new URL(frame.url());if(['localhost','127.0.0.1','[::1]'].includes(u.hostname))
    session.steps.push({action:'navigate',url:u.origin+u.pathname});}
   catch{}
  });
  session.instrumented=true;
  }
  this.store.audit({projectId,action:'recorder.start',actor:actor.actor,channel:actor.channel,evidence:{screenId}});
  return {recording:true,projectId,screenId,targetUrl:session.page.url()};
 }
 async stop(projectId:string,actor:Actor){
  const session=this.sessions.get(projectId);
  if(!session||!session.recording)throw new DomainError('NOT_RECORDING','No active Browser recording');
  session.recording=false;
  await this.persistCookies(projectId,session.context);
  const recipe:Recipe={id:'recipe:'+projectId+':'+session.screenId,projectId,screenId:session.screenId,
   steps:session.steps.slice(),updatedAt:new Date().toISOString()};
  this.store.transaction(()=>{this.store.put('recipe',recipe);
   this.store.audit({projectId,action:'recorder.stop',actor:actor.actor,channel:actor.channel,
    evidence:{screenId:recipe.screenId,stepCount:recipe.steps.length}});});
  return recipe;
 }
 recipe(projectId:string,screenId:string):Recipe{
  const item=this.store.get<Recipe>('recipe','recipe:'+projectId+':'+screenId);
  if(!item)throw new DomainError('RECIPE_NOT_FOUND','No saved steps for this screen',404);
  return item;
 }
 recipes(projectId:string){return this.store.list<Recipe>('recipe',{projectId});}
 saveRecipe(projectId:string,screenId:string,steps:BrowserStep[],actor:Actor){
  this.tasks.project(projectId);
  if(!Array.isArray(steps)||steps.length>200)throw new DomainError('INVALID_STEPS','Steps must be an array with at most 200 entries');
  for(const step of steps)if(!['click','fill','press','navigate','select','check'].includes(step.action))
   throw new DomainError('INVALID_STEP','Unsupported replay step action');
  const recipe:Recipe={id:'recipe:'+projectId+':'+requireText(screenId,'screen ID'),projectId,screenId,
   steps:structuredClone(steps),updatedAt:new Date().toISOString()};
  this.store.transaction(()=>{this.store.put('recipe',recipe);
   this.store.audit({projectId,action:'recorder.steps.edit',actor:actor.actor,channel:actor.channel,
    evidence:{screenId,stepCount:steps.length}});});
  return recipe;
 }
 async replay(projectId:string,screenId:string,route:string|undefined,actor:Actor){
  const project=this.tasks.project(projectId),recipe=this.recipe(projectId,screenId);
  const session=await this.ensureSession(projectId,route);
  if(session.recording)throw new DomainError('RECORDING_ACTIVE','Stop recorder before replay');
  await session.page.goto(this.url(project,route),{waitUntil:'domcontentloaded',timeout:20000});
  try{await applySteps(session.page,recipe.steps);}
  catch(error){throw new DomainError('REPLAY_FAILED','Saved browser step replay failed',409,{detail:String(error).slice(0,300)});}
  await this.persistCookies(projectId,session.context);
  this.store.audit({projectId,action:'recorder.replay',actor:actor.actor,channel:actor.channel,
   evidence:{screenId,stepCount:recipe.steps.length}});
  return {replayed:recipe.steps.length,url:session.page.url()};
 }
 async capture(input:{projectId:string;taskId:string;screenId:string;route?:string;stateId?:string;caseId?:string;replay?:boolean},actor:Actor){
  const project=this.tasks.project(input.projectId);
  const session=await this.ensureSession(input.projectId,input.route);
  if(session.recording)throw new DomainError('RECORDING_ACTIVE','Stop recorder before automatic capture');
  if(input.replay!==false)await this.replay(input.projectId,input.screenId,input.route,actor);
  else await session.page.goto(this.url(project,input.route),{waitUntil:'domcontentloaded'});
  const bytes=await session.page.screenshot({type:'png',animations:'disabled'});
  await this.persistCookies(input.projectId,session.context);
  return this.images.ingest({source:'browser',data:bytes,projectId:input.projectId,
   taskId:input.taskId,screenId:input.screenId,stateId:input.stateId,caseId:input.caseId},actor);
 }
 async reset(projectId:string,confirm:boolean,actor:Actor){
  if(confirm!==true)throw new DomainError('CONFIRM_REQUIRED','Reset browser login session requires confirmation');
  this.tasks.project(projectId);
  const existing=this.sessions.get(projectId);
  if(existing)await existing.context.close();
  this.sessions.delete(projectId);
  const dir=this.profile(projectId);
  if(fs.existsSync(dir))fs.rmSync(dir,{recursive:true,force:true});
  this.store.audit({projectId,action:'recorder.session.reset',actor:actor.actor,channel:actor.channel,
   evidence:{onlyProject:projectId,preservedRecipes:true,preservedScreenshots:true}});
  return {reset:true,projectId,recipesPreserved:true};
 }
 async closeAll(){
  for(const [projectId,session] of this.sessions){
   await this.persistCookies(projectId,session.context);
   await session.context.close();
  }
  this.sessions.clear();
 }
}
