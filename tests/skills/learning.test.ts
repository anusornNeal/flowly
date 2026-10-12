import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FlowlyApp} from '../../packages/core/src/app.js';
import {SkillLearning} from '../../packages/core/src/skillLearning.js';
const author={actor:'implementer',channel:'cli' as const};
const reviewer={actor:'independent-reviewer',channel:'cli' as const};
const original='---\nname: custom-safety\ndescription: Enforce explicit review before local project changes.\n---\n# Custom Safety\nWait for actual evidence before approving.';
const revised='---\nname: custom-safety\ndescription: Enforce explicit review before local project changes.\n---\n# Custom Safety\nRequire real test evidence, task ID and current revision before approving.';
async function fixture(fn:(app:FlowlyApp,learning:SkillLearning,projectId:string)=>void|Promise<void>){
 const root=mkdtempSync(join(tmpdir(),'flowly-learning-')),app=new FlowlyApp(root);
 try {
  const project=app.tasks.createProject({name:'Flowly'},author);
  app.skills.importProject({projectId:project.id,content:original},author);
  await fn(app,new SkillLearning(app.store,app.skills),project.id);
 }finally{await app.close();rmSync(root,{recursive:true,force:true});}
}
test('corrections are proposals only, deduplicated and never auto-applied',()=>fixture((app,learning,projectId)=>{
 const input={projectId,skillId:'custom-safety',candidateVersion:'1.1.0',
  candidateContent:revised,explanation:'A missed QA verification requires more precise evidence checks',
  evidenceIds:['qa_001']};
 const proposal=learning.propose(input,author),again=learning.propose(input,author);
 assert.equal(proposal.id,again.id);
 assert.equal(proposal.status,'pending');
 assert.equal(learning.list(projectId).length,1);
 assert.equal(app.skills.list({projectId}).filter(x=>x.id==='custom-safety').length,1);
 assert.ok(!JSON.stringify(app.tasks.activity(projectId)).includes('Require real test evidence'));
}));
test('separate reviewer must confirm exact candidate hash before import',()=>fixture((app,learning,projectId)=>{
 const p=learning.propose({projectId,skillId:'custom-safety',candidateVersion:'1.1.0',
  candidateContent:revised,explanation:'User rejected previous review with missing revision'},author);
 const args={projectId,id:p.id,verdict:'approve' as const,reason:'Verified improvement preserves review gate'};
 assert.throws(()=>learning.decide({...args,confirm:'APPLY:'+p.candidateSha256.slice(0,12)},author),{code:'INDEPENDENT_REVIEW_REQUIRED'});
 assert.throws(()=>learning.decide({...args,confirm:'APPLY:wrong'},reviewer),{code:'CONFIRM_CANDIDATE_HASH'});
 const approved=learning.decide({...args,confirm:'APPLY:'+p.candidateSha256.slice(0,12)},reviewer);
 assert.equal(approved.status,'approved');
 assert.equal(app.skills.get({projectId,id:'custom-safety',version:'1.1.0'}).content,revised);
 assert.throws(()=>learning.decide({...args,confirm:'APPLY:'+p.candidateSha256.slice(0,12)},reviewer),{code:'PROPOSAL_ALREADY_DECIDED'});
}));
test('explicit rollback disables newly imported version without deleting base revision',()=>fixture((app,learning,projectId)=>{
 const p=learning.propose({projectId,skillId:'custom-safety',candidateVersion:'1.1.0',
  candidateContent:revised,explanation:'Richer guidance for revised QA process'},author);
 learning.decide({projectId,id:p.id,verdict:'approve',confirm:'APPLY:'+p.candidateSha256.slice(0,12),
  reason:'Versioned change reviewed by different actor'},reviewer);
 assert.throws(()=>learning.rollback({projectId,id:p.id,confirm:'ROLLBACK:wrong',reason:'Revert quality regression'},reviewer),
  {code:'ROLLBACK_CONFIRMATION_REQUIRED'});
 const rolled=learning.rollback({projectId,id:p.id,confirm:'ROLLBACK:'+p.id,reason:'Revert quality regression'},reviewer);
 assert.equal(rolled.status,'rolled-back');
 assert.equal(app.skills.get({projectId,id:'custom-safety',version:'1.1.0'}).manifest.enabled,false);
 assert.equal(app.skills.get({projectId,id:'custom-safety',version:'1.0.0'}).manifest.enabled,true);
 assert.equal(learning.list(projectId).length,0);
 assert.equal(learning.list(projectId,true)[0]?.status,'rolled-back');
}));
test('rejection and stale proposals preserve current immutable Skill',()=>fixture((app,learning,projectId)=>{
 const p=learning.propose({projectId,skillId:'custom-safety',candidateVersion:'1.1.0',
  candidateContent:revised,explanation:'Suggested change from previous agent correction'},author);
 learning.decide({projectId,id:p.id,verdict:'reject',reason:'No adequate evidence supplied'},reviewer);
 assert.equal(app.skills.get({projectId,id:'custom-safety'}).content,original);
 assert.equal(learning.list(projectId).length,0);
 const newer=learning.propose({projectId,skillId:'custom-safety',candidateVersion:'2.0.0',
  candidateContent:revised,explanation:'Candidate revision before competing update'},author);
 app.skills.importProject({projectId,version:'1.2.0',content:original+'\n# Verified maintenance\n'},reviewer);
 assert.throws(()=>learning.decide({projectId,id:newer.id,verdict:'approve',
  confirm:'APPLY:'+newer.candidateSha256.slice(0,12),reason:'Review approved'},reviewer),{code:'STALE_LEARNING_BASE'});
}));
test('builtin modifications and sensitive evidence are rejected',()=>fixture((app,learning,projectId)=>{
 assert.throws(()=>learning.propose({projectId,skillId:'review',candidateVersion:'9.0.0',
  candidateContent:revised.replace('custom-safety','review'),
  explanation:'Try to override builtin review rules'},author),{code:'LEARNING_SCOPE_DENIED'});
 assert.throws(()=>learning.propose({projectId,skillId:'custom-safety',candidateVersion:'1.1.0',
  candidateContent:revised,explanation:'Need revised QA rules',evidenceIds:['secret bearer content']},author),
  {code:'INVALID_LEARNING_EVIDENCE'});
 assert.equal(learning.list(projectId).length,0);
}));
