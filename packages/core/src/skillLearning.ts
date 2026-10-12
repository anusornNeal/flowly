import { randomUUID } from 'node:crypto';
import type { LocalStore } from '../../db/src/store.js';
import type { Actor } from './models.js';
import { DomainError } from './models.js';
import { skillHash } from './skillContracts.js';
import type { SkillRegistry } from './skillRegistry.js';

export type SkillProposal = {
 id: string; projectId: string; skillId: string; baseVersion: string; baseSha256: string;
 candidateVersion: string; candidateSha256: string; candidateContent: string;
 explanation: string; evidenceIds: string[]; createdBy: string; createdAt: string;
 status: 'pending'|'approved'|'rejected'|'rolled-back';
 decidedBy?: string; decidedAt?: string; decisionReason?: string;
};
export type SkillProposalSummary = Omit<SkillProposal,'candidateContent'> & { preview: string };
const MAX_PROPOSALS=120;
const indexKey=(projectId:string)=>'skill:learning:'+projectId;
const iso=()=>new Date().toISOString();
const semver=(s:string):number[]|undefined=>{
 const m=s.match(/^(\d+)\.(\d+)\.(\d+)$/);return m?[Number(m[1]),Number(m[2]),Number(m[3])]:undefined;
};
function later(a:string,b:string):boolean{
 const x=semver(a),y=semver(b);
 if(!x||!y)return false;
 for(let i=0;i<3;i++){if(x[i]!>y[i]!)return true;if(x[i]!<y[i]!)return false;}
 return false;
}
function requireProject(store:LocalStore,projectId:string){
 if(!projectId||!store.get('project',projectId))throw new DomainError('NOT_FOUND','Project does not exist',404);
}
function safeEvidence(ids:string[]):string[]{
 if(!Array.isArray(ids)||ids.length>12||ids.some(x=>typeof x!=='string'||!/^[-_a-zA-Z0-9]{1,90}$/.test(x)))
  throw new DomainError('INVALID_LEARNING_EVIDENCE','Use bounded evidence IDs, not confidential content');
 return [...new Set(ids)];
}
function metadata(content:string):{name:string;description:string}{
 if(typeof content!=='string'||content.length<50||content.length>100_000)
  throw new DomainError('INVALID_SKILL_CONTENT','Candidate SKILL.md content must be 50..100000 characters');
 const m=content.match(/^---\r?\nname: ([a-z][a-z0-9-]*)\r?\ndescription: ([^\r\n]+)\r?\n---(?:\r?\n|$)/);
 if(!m)throw new DomainError('INVALID_SKILL_FRONTMATTER','Candidate SKILL.md must contain stable YAML name and description');
 return {name:m[1]!,description:m[2]!};
}
/**
 * No automatic runtime self-editing: proposals require a distinct reviewer and
 * exact candidate hash confirmation. A rejected or pending proposal never
 * alters trusted/current Skill revisions.
 */
export class SkillLearning {
 constructor(private readonly store:LocalStore,private readonly registry:SkillRegistry){}
 private read(projectId:string):SkillProposal[]{
  const value=this.store.setting(indexKey(projectId));if(!value)return [];
  let data:unknown;
  try{data=JSON.parse(value);}catch{throw new DomainError('CORRUPT_PROPOSAL_INDEX','Invalid proposal JSON');}
  if(!Array.isArray(data)||data.length>MAX_PROPOSALS ||
    data.some(x=>!x||typeof x!=='object'||typeof x.id!=='string'||typeof x.projectId!=='string'||typeof x.status!=='string'))
   throw new DomainError('CORRUPT_PROPOSAL_INDEX','Invalid stored proposal collection');
  return data as SkillProposal[];
 }
 private put(projectId:string,list:SkillProposal[]):void{
  this.store.setSetting(indexKey(projectId),JSON.stringify(list));
 }
 list(projectId:string,includeClosed=false):SkillProposalSummary[]{
  requireProject(this.store,projectId);
  return this.read(projectId).filter(p=>includeClosed||p.status==='pending')
   .map(p=>this.summary(p)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
 }
 get(projectId:string,id:string):SkillProposalSummary{
  requireProject(this.store,projectId);
  const found=this.read(projectId).find(p=>p.id===id);
  if(!found)throw new DomainError('PROPOSAL_NOT_FOUND','Skill proposal does not exist',404);
  return this.summary(found);
 }
 private summary(p:SkillProposal):SkillProposalSummary{
  const {candidateContent,...fields}=p;
  return {...fields,preview:candidateContent.slice(0,420)};
 }
 propose(input:{projectId:string;skillId:string;candidateVersion:string;candidateContent:string;explanation:string;evidenceIds?:string[]},actor:Actor):SkillProposalSummary{
  const {projectId,skillId,candidateVersion,candidateContent}=input;
  requireProject(this.store,projectId);
  const current=this.registry.get({id:skillId,projectId});
  if(current.manifest.source!=='project'||current.manifest.projectId!==projectId)
   throw new DomainError('LEARNING_SCOPE_DENIED','Built-in Skills require a reviewed source change, not runtime self-modification',403);
  const yaml=metadata(candidateContent);
  if(yaml.name!==skillId)throw new DomainError('SKILL_ID_MISMATCH','Proposed Skill ID cannot change');
  if(!later(candidateVersion,current.manifest.version))
   throw new DomainError('INVALID_LEARNING_VERSION','Candidate version must be greater than current revision');
  if(typeof input.explanation!=='string'||input.explanation.trim().length<12||input.explanation.length>800)
   throw new DomainError('LEARNING_RATIONALE_REQUIRED','Provide concise reason grounded in a correction or failure');
  const evidenceIds=safeEvidence(input.evidenceIds||[]),candidateSha256=skillHash(candidateContent);
  return this.store.transactionImmediate(()=>{
   const list=this.read(projectId);
   const same=list.find(p=>p.skillId===skillId&&p.baseSha256===current.manifest.sha256
     &&p.candidateSha256===candidateSha256&&p.candidateVersion===candidateVersion);
   if(same)return this.summary(same);
   if(list.length>=MAX_PROPOSALS)throw new DomainError('PROPOSAL_LIMIT','Project proposal limit reached');
   const p:SkillProposal={id:'proposal_'+randomUUID(),projectId,skillId,
    baseVersion:current.manifest.version,baseSha256:current.manifest.sha256,
    candidateVersion,candidateSha256,candidateContent,
    explanation:input.explanation.trim(),evidenceIds,createdBy:actor.actor,createdAt:iso(),status:'pending'};
   this.put(projectId,[...list,p]);
   this.store.audit({projectId,actor:actor.actor,channel:actor.channel,action:'skill.learning.propose',
    evidence:{id:p.id,skillId,baseVersion:p.baseVersion,candidateVersion,candidateSha256,evidenceIds}});
   return this.summary(p);
  });
 }
 decide(input:{projectId:string;id:string;verdict:'approve'|'reject';confirm?:string;reason:string},actor:Actor):SkillProposalSummary{
  requireProject(this.store,input.projectId);
  if(!['approve','reject'].includes(input.verdict))
   throw new DomainError('INVALID_PROPOSAL_VERDICT','Approve or reject explicitly');
  if(typeof input.reason!=='string'||input.reason.trim().length<8)
   throw new DomainError('LEARNING_DECISION_REASON_REQUIRED','Explain the decision');
  return this.store.transactionImmediate(()=>{
   const list=this.read(input.projectId),proposal=list.find(p=>p.id===input.id);
   if(!proposal)throw new DomainError('PROPOSAL_NOT_FOUND','Proposal not found',404);
   if(proposal.status!=='pending')throw new DomainError('PROPOSAL_ALREADY_DECIDED','Proposal already decided',409);
   if(actor.actor===proposal.createdBy)
    throw new DomainError('INDEPENDENT_REVIEW_REQUIRED','A separate actor must explicitly review the proposed change',403);
   if(input.verdict==='approve'){
    if(input.confirm!=='APPLY:'+proposal.candidateSha256.slice(0,12))
     throw new DomainError('CONFIRM_CANDIDATE_HASH','Approver must confirm exact proposed revision hash');
    const current=this.registry.get({projectId:input.projectId,id:proposal.skillId});
    if(current.manifest.sha256!==proposal.baseSha256)
     throw new DomainError('STALE_LEARNING_BASE','Another Skill revision superseded the proposal',409);
    this.registry.importProject({projectId:input.projectId,version:proposal.candidateVersion,
      content:proposal.candidateContent},actor);
   }
   const next={...proposal,status:(input.verdict==='approve'?'approved':'rejected') as SkillProposal['status'],
    decidedBy:actor.actor,decidedAt:iso(),decisionReason:input.reason.trim()};
   this.put(input.projectId,list.map(p=>p.id===proposal.id?next:p));
   this.store.audit({projectId:input.projectId,actor:actor.actor,channel:actor.channel,
    action:'skill.learning.'+input.verdict,evidence:{id:proposal.id,skillId:proposal.skillId,
      candidateVersion:proposal.candidateVersion,candidateSha256:proposal.candidateSha256,reason:input.reason.trim().slice(0,220)}});
   return this.summary(next);
  });
 }
 rollback(input:{projectId:string;id:string;confirm:string;reason:string},actor:Actor):SkillProposalSummary{
  requireProject(this.store,input.projectId);
  if(typeof input.reason!=='string'||input.reason.trim().length<8)
   throw new DomainError('LEARNING_DECISION_REASON_REQUIRED','Explain why rollback is necessary');
  return this.store.transactionImmediate(()=>{
   const list=this.read(input.projectId),p=list.find(x=>x.id===input.id);
   if(!p)throw new DomainError('PROPOSAL_NOT_FOUND','Proposal not found',404);
   if(p.status!=='approved')throw new DomainError('PROPOSAL_NOT_APPROVED','Only an approved proposal can be rolled back',409);
   if(input.confirm!=='ROLLBACK:'+p.id)
    throw new DomainError('ROLLBACK_CONFIRMATION_REQUIRED','Confirm the specific proposal to rollback');
   const current=this.registry.get({projectId:input.projectId,id:p.skillId,version:p.candidateVersion});
   if(current.manifest.sha256!==p.candidateSha256)
    throw new DomainError('SKILL_REVISION_MISMATCH','Approved revision hash has changed',409);
   this.registry.setEnabled({projectId:input.projectId,id:p.skillId,version:p.candidateVersion,enabled:false},actor);
   this.registry.setEnabled({projectId:input.projectId,id:p.skillId,version:p.baseVersion,enabled:true},actor);
   const next={...p,status:'rolled-back' as const,decidedBy:actor.actor,decidedAt:iso(),decisionReason:input.reason.trim()};
   this.put(input.projectId,list.map(x=>x.id===p.id?next:x));
   this.store.audit({projectId:input.projectId,actor:actor.actor,channel:actor.channel,
    action:'skill.learning.rollback',evidence:{id:p.id,skillId:p.skillId,candidateVersion:p.candidateVersion}});
   return this.summary(next);
  });
 }
}
