import { randomUUID } from 'node:crypto';
import type { LocalStore } from '../../db/src/store.js';
import type { Actor, TaskRecord } from './models.js';
import { DomainError } from './models.js';
import { engineeringBlockers } from './engineering.js';

export type SkillLease = {
 id: string; projectId: string; taskId: string; streamId: string;
 sessionId: string; actor: string; paths: string[]; state: 'active' | 'released';
 createdAt: string; updatedAt: string; expiresAt: string; releasedAt?: string;
};
export type LeaseView = SkillLease & { availability: 'active' | 'expired' | 'released' };
export type LeaseRequest = { projectId: string; taskId: string; streamId: string; sessionId: string; ttlSeconds?: number };
export type LeaseRenewal = { projectId: string; id: string; sessionId: string; ttlSeconds?: number };
export type LeaseRelease = { projectId: string; id: string; sessionId: string };
const MAX_LEASES=300,DEFAULT_TTL=600;
const indexKey=(projectId:string)=>'skill:leases:'+projectId;
function required(value: unknown,label:string,max=200):string {
 if(typeof value!=='string'||!value.trim()||value.length>max||value.trim()!==value)
  throw new DomainError('INVALID_SESSION_FIELD',label+' must be an exact nonempty identifier');
 return value;
}
function ttl(value:number|undefined):number{
 if(value===undefined)return DEFAULT_TTL;
 if(!Number.isInteger(value)||value<60||value>3600)
  throw new DomainError('INVALID_LEASE_TTL','ttlSeconds must be between 60 and 3600');
 return value;
}
function normalizedPath(input:string):string{
 if(typeof input!=='string'||!input.trim())throw new DomainError('INVALID_OWNED_PATH','Path must be nonempty');
 const slash=input.replaceAll('\\','/').replace(/\/+$/,'');
 if(slash.startsWith('/')||/^[a-z]:/i.test(slash)||slash.split('/').some(p=>!p||p==='.'||p==='..'))
  throw new DomainError('INVALID_OWNED_PATH','Workstream ownership paths must be relative and safe');
 return slash.toLowerCase();
}
const overlap=(a:string,b:string)=>a===b||a.startsWith(b+'/')||b.startsWith(a+'/');
function expiry(now:Date,seconds:number):string{return new Date(now.getTime()+seconds*1000).toISOString();}
export class SkillSessions {
 constructor(private readonly store:LocalStore,private readonly clock:()=>Date=()=>new Date()){}
 private read(projectId:string):SkillLease[]{
  const serialized=this.store.setting(indexKey(projectId));
  if(!serialized)return [];
  let data:unknown;try{data=JSON.parse(serialized);}catch{throw new DomainError('CORRUPT_LEASE_INDEX','Corrupt persisted leases');}
  if(!Array.isArray(data)||data.length>MAX_LEASES || data.some(x=>
    !x||typeof x!=='object'||typeof x.id!=='string'||typeof x.projectId!=='string'||typeof x.sessionId!=='string'||!Array.isArray(x.paths)))
   throw new DomainError('CORRUPT_LEASE_INDEX','Invalid lease index');
  return data as SkillLease[];
 }
 private save(projectId:string,leases:SkillLease[]):void{
  this.store.setSetting(indexKey(projectId),JSON.stringify(leases));
 }
 private project(projectId:string):void{
  if(!this.store.get('project',projectId))throw new DomainError('NOT_FOUND','Project does not exist',404);
 }
 private view(lease:SkillLease):LeaseView{
  return {...lease,paths:[...lease.paths],availability:lease.state==='released'?'released':
   Date.parse(lease.expiresAt)<=this.clock().getTime()?'expired':'active'};
 }
 list(projectId:string,options:{includeReleased?:boolean;taskId?:string}={}):LeaseView[]{
  required(projectId,'projectId');this.project(projectId);
  return this.read(projectId).filter(x=>(options.includeReleased||x.state==='active')&&(!options.taskId||x.taskId===options.taskId))
   .map(x=>this.view(x)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
 }
 claim(input:LeaseRequest,actor:Actor):LeaseView{
  const projectId=required(input.projectId,'projectId'),taskId=required(input.taskId,'taskId'),
   streamId=required(input.streamId,'streamId'),sessionId=required(input.sessionId,'sessionId');
  const seconds=ttl(input.ttlSeconds);
  return this.store.transactionImmediate(()=>{
   this.project(projectId);
   const task=this.store.get<TaskRecord>('task',taskId);
   if(!task)throw new DomainError('NOT_FOUND','Task not found',404);
   if(task.projectId!==projectId)throw new DomainError('PROJECT_MISMATCH','Cross-project lease forbidden',409);
   if(task.status!=='in-progress'||engineeringBlockers(task).length)
    throw new DomainError('TASK_NOT_READY','Approved in-progress Task with a valid plan required',409);
   const stream=task.engineering?.plan?.workstreams.find(w=>w.id===streamId);
   if(!stream||stream.status!=='in-progress')
    throw new DomainError('WORKSTREAM_NOT_ACTIVE','Stream must be explicitly started',409);
   const paths=stream.ownedPaths.map(normalizedPath);
   const leases=this.read(projectId),now=this.clock(),at=now.toISOString();
   const prior=leases.find(l=>l.taskId===taskId&&l.streamId===streamId&&l.state==='active');
   if(prior){
    if(prior.actor!==actor.actor||prior.sessionId!==sessionId)
     throw new DomainError('LEASE_CONFLICT','Workstream belongs to another session',409,{claimId:prior.id,expired:this.view(prior).availability==='expired'});
    const renewed={...prior,updatedAt:at,expiresAt:expiry(now,seconds)};
    this.save(projectId,leases.map(l=>l.id===prior.id?renewed:l));
    return this.view(renewed);
   }
   for(const lease of leases.filter(l=>l.state==='active')){
    if(lease.paths.some(a=>paths.some(b=>overlap(a,b))))
     throw new DomainError('LEASE_PATH_CONFLICT','Another session owns overlapping worktree paths',409,{claimId:lease.id,expired:this.view(lease).availability==='expired'});
   }
   if(leases.length>=MAX_LEASES)throw new DomainError('LEASE_LIMIT','Too many durable leases');
   const record:SkillLease={id:'lease_'+randomUUID(),projectId,taskId,streamId,sessionId,actor:actor.actor,
    paths,state:'active',createdAt:at,updatedAt:at,expiresAt:expiry(now,seconds)};
   this.save(projectId,[...leases,record]);
   this.store.audit({projectId,taskId,actor:actor.actor,channel:actor.channel,
    action:'skill.session.claim',evidence:{id:record.id,streamId,sessionId,paths}});
   return this.view(record);
  });
 }
 renew(input:LeaseRenewal,actor:Actor):LeaseView{
  const projectId=required(input.projectId,'projectId'),id=required(input.id,'id'),
   sessionId=required(input.sessionId,'sessionId'),seconds=ttl(input.ttlSeconds);
  return this.store.transactionImmediate(()=>{
   this.project(projectId);const leases=this.read(projectId);
   const existing=leases.find(l=>l.id===id);
   if(!existing)throw new DomainError('LEASE_NOT_FOUND','Claim does not exist',404);
   if(existing.state!=='active')throw new DomainError('LEASE_RELEASED','Released claim cannot be renewed',409);
   if(existing.actor!==actor.actor||existing.sessionId!==sessionId)
    throw new DomainError('LEASE_OWNER_MISMATCH','Only same actor/session may renew a claim',403);
   const now=this.clock(),next={...existing,expiresAt:expiry(now,seconds),updatedAt:now.toISOString()};
   this.save(projectId,leases.map(l=>l.id===id?next:l));
   return this.view(next);
  });
 }
 release(input:LeaseRelease,actor:Actor):LeaseView{
  const projectId=required(input.projectId,'projectId'),id=required(input.id,'id'),
    sessionId=required(input.sessionId,'sessionId');
  return this.store.transactionImmediate(()=>{
   this.project(projectId);const leases=this.read(projectId),prior=leases.find(l=>l.id===id);
   if(!prior)throw new DomainError('LEASE_NOT_FOUND','Claim does not exist',404);
   if(prior.actor!==actor.actor||prior.sessionId!==sessionId)
    throw new DomainError('LEASE_OWNER_MISMATCH','Only owning actor/session can release',403);
   if(prior.state==='released')return this.view(prior);
   const now=this.clock().toISOString();
   const released:SkillLease={...prior,state:'released',releasedAt:now,updatedAt:now};
   this.save(projectId,leases.map(l=>l.id===id?released:l));
   this.store.audit({projectId,taskId:prior.taskId,actor:actor.actor,channel:actor.channel,
    action:'skill.session.release',evidence:{id,sessionId,streamId:prior.streamId}});
   return this.view(released);
  });
 }
}
